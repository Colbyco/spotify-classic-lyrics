'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Reports } = require('../src/reporting.cjs');
const { collect, errorCategory } = require('../src/diagnostics.cjs');
const { fixture, open, overrideKey } = require('./fixture.cjs');
const storage = require('../src/storage.cjs');
const example = () => ({ schema: 1, appVersion: '1.0.1', platform: 'win32', osVersion: '10.0.26100', architecture: 'x64', spotifyVersion: '1.3.6.1921', installation: 'desktop', spotifyRunning: true, storageState: 'fixed', flagValues: ['CONTROL'], readErrors: [], lastFix: 'saved', lastError: 'none', automaticRepair: false, issue: 'lyrics-still-fullscreen' });

test('diagnostics produce a closed report without usernames, paths, unrelated preferences, or unknown flag strings', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const prefs = path.join(path.dirname(f.directory), 'private-prefs');
  await fs.writeFile(prefs, 'app.last-launched-version="1.3.6.1921.gsecret"\nautologin.canonical_username="private-person"\nprivate="token-secret"');
  const db = await open(f.directory);
  await db.put(overrideKey, storage.encodeString(JSON.stringify({ [storage.FLAG]: 'private-person@example.com', unrelated: 'token-secret' }), 1)); await db.close();
  const report = await collect({ appVersion: '1.0.1', automaticRepair: false, lastFix: 'failed', lastError: 'other' }, { platform: { discover: async () => [{ ...f.candidate, prefs }], locations: () => [], isSpotifyRunning: async () => true } });
  assert.equal(report.spotifyVersion, '1.3.6.1921');
  assert.deepEqual(report.flagValues, ['OTHER']);
  const text = JSON.stringify(report);
  for (const secret of ['private-person', 'token-secret', 'gsecret', f.directory, 'username', 'unrelated']) assert.ok(!text.includes(secret));
});

test('receiver schema rejects extra fields and personally identifying strings', async () => {
  const { validateReport } = await import('../src/report-schema.mjs');
  assert.equal(validateReport(example()).schema, 1);
  assert.throws(() => validateReport({ ...example(), username: 'someone' }), /fields/);
  assert.throws(() => validateReport({ ...example(), spotifyVersion: 'someone@example.com' }), /value/);
  assert.throws(() => validateReport({ ...example(), flagValues: ['a-private-path'] }), /value/);
  assert.equal(errorCategory(Object.assign(new Error('C:/private-user/settings'), { code: 'EACCES' })), 'access-denied');
});

test('analysis distinguishes a reset, Spotify being open, and a saved preference without claiming the visible layout is verified', async () => {
  const { analyze } = await import('../src/report-schema.mjs');
  assert.equal(analyze(example())[0].code, 'preference-saved');
  const reset = analyze({ ...example(), storageState: 'needs-fix', automaticRepair: true, issue: 'automatic-repair-failed' });
  assert.ok(reset.some(f => f.code === 'preference-reset'));
  assert.ok(reset.some(f => f.code === 'spotify-is-open'));
});

test('preparing and reviewing never sends; explicit consent and a current reviewed ID are required', async () => {
  let calls = 0;
  const reports = new Reports(async (_url, options) => {
    calls++; const input = JSON.parse(options.body);
    assert.equal(input.consent, true); assert.deepEqual(input.report, example());
    return { ok: true, json: async () => ({ accepted: true, id: input.id }) };
  });
  const review = await reports.prepare(example());
  await assert.rejects(reports.submit({ id: review.id, consent: false }), /permission/);
  await assert.rejects(reports.submit({ id: 'wrong-id', consent: true }), /again/);
  assert.equal(calls, 0);
  assert.deepEqual(await reports.submit({ id: review.id, consent: true }), { sent: true, id: review.id });
  await reports.submit({ id: review.id, consent: true }); assert.equal(calls, 1);
});

test('failed sends are not queued or retried automatically, and a user retry reuses the receipt ID', async () => {
  const ids = [];
  const reports = new Reports(async (_url, options) => { ids.push(JSON.parse(options.body).id); throw new Error('Offline at /private-user'); });
  const review = await reports.prepare(example());
  await assert.rejects(reports.submit({ id: review.id, consent: true }), /connection/);
  assert.equal(ids.length, 1); assert.equal(reports.current.sent, false);
  await assert.rejects(reports.submit({ id: review.id, consent: true }), /connection/);
  assert.deepEqual(ids, [review.id, review.id]);
  reports.current.created = 0;
  await assert.rejects(reports.submit({ id: review.id, consent: true }), /again/);
  assert.equal(ids.length, 2);
});

test('a send cannot silently change to a different report while a request is in flight', async () => {
  let finish;
  const reports = new Reports((_url, options) => new Promise(resolve => { finish = () => resolve({ ok: true, json: async () => ({ accepted: true, id: JSON.parse(options.body).id }) }); }));
  const review = await reports.prepare(example());
  const sending = reports.submit({ id: review.id, consent: true });
  await assert.rejects(reports.submit({ id: review.id, consent: true }), /already/);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(reports.prepare(example()), /Wait/);
  await assert.rejects(reports.update(review.id, 'fix-failed'), /again/);
  finish(); await sending;
});
