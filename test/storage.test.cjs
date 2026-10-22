'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const s = require('../src/storage.cjs');
const { fixture, open, overrideKey, metaKey } = require('./fixture.cjs');
const { watchOnce } = require('../src/watcher.cjs');
const { locations, selectCurrentProfiles } = require('../src/platform.cjs');

test('repair preserves unrelated data, updates metadata, is idempotent, and undo preserves later edits', async t => {
  const f = await fixture({ utf16: true }); t.after(f.cleanup);
  assert.equal((await s.inspectSnapshot(f.candidate)).fixed, false);
  assert.deepEqual(await s.change(f.candidate, f.backup), { changed: 1 });
  assert.deepEqual(await s.change(f.candidate, f.backup), { changed: 0 });
  let db = await open(f.directory);
  const object = JSON.parse(s.decodeString(await db.get(overrideKey)));
  assert.equal(object.unrelated, 'keep me'); assert.equal(object.unicode, '音楽'); assert.equal(object[s.FLAG], 'CONTROL');
  object.later = 42;
  await db.put(overrideKey, s.encodeString(JSON.stringify(object), 0));
  const metadata = await db.get(metaKey); assert.equal(s.readVarint(metadata, 1).value, 12345n); await db.close();
  const saved = await fs.readFile(f.backup, 'utf8'); assert.ok(!saved.includes('keep me')); assert.ok(!saved.includes('音楽'));
  await s.change(f.candidate, f.backup, true);
  db = await open(f.directory); const restored = JSON.parse(s.decodeString(await db.get(overrideKey))); await db.close();
  assert.equal(restored[s.FLAG], 'PERSISTENT_UNLIMITED'); assert.equal(restored.later, 42);
  assert.equal((await s.readJson(f.backup)).records.length, 0);
});
test('stock profiles without an override record can be repaired and undone', async t => {
  const f = await fixture({ missing: true }); t.after(f.cleanup);
  assert.equal((await s.inspectDirect(f.candidate)).profiles, 1);
  await s.change(f.candidate, f.backup); assert.equal((await s.inspectSnapshot(f.candidate)).fixed, true);
  await s.change(f.candidate, f.backup, true);
  const db = await open(f.directory); assert.equal(await db.get(overrideKey), undefined); await db.close();
});
test('a live database is never force-unlocked; inspection uses a separate copy', async t => {
  const f = await fixture(); t.after(f.cleanup); const db = await open(f.directory);
  try {
    assert.equal((await s.inspectSnapshot(f.candidate)).fixed, false);
    await assert.rejects(s.change(f.candidate, f.backup), error => error.code === 'LEVEL_LOCKED');
    assert.equal(JSON.parse(s.decodeString(await db.get(overrideKey)))[s.FLAG], 'PERSISTENT_UNLIMITED');
  } finally { await db.close(); }
});
test('malformed settings are rejected before any preference is written', async t => {
  const f = await fixture({ corrupt: true }); t.after(f.cleanup);
  await assert.rejects(s.change(f.candidate, f.backup), /not an object/);
  assert.equal(await fs.stat(f.backup).then(() => true, () => false), false);
});
test('automatic repair detects a later reset and defers until Spotify closes', async t => {
  const f = await fixture(); t.after(f.cleanup); let running = true, calls = 0;
  const inspect = async () => ({ kind: (await s.inspectSnapshot(f.candidate)).fixed ? 'fixed' : 'needs-fix', running });
  const repair = async () => { calls++; await s.change(f.candidate, f.backup); return inspect(); };
  await watchOnce({ enabled: true, inspect, repair }); assert.equal(calls, 0);
  running = false; await watchOnce({ enabled: true, inspect, repair }); assert.equal(calls, 1);
  const db = await open(f.directory); const object = JSON.parse(s.decodeString(await db.get(overrideKey))); object[s.FLAG] = 'ALWAYS_VISIBLE'; await db.put(overrideKey, s.encodeString(JSON.stringify(object), 1)); await db.close();
  await watchOnce({ enabled: false, inspect, repair }); assert.equal(calls, 1);
  await watchOnce({ enabled: true, inspect, repair }); assert.equal(calls, 2);
  await s.change(f.candidate, f.backup, true); assert.equal((await s.inspectSnapshot(f.candidate)).values[0], 'PERSISTENT_UNLIMITED');
});
test('unknown metadata is rejected and Chromium encoding is preserved', async t => {
  assert.throws(() => s.decodeString(Buffer.from([9, 1])), /unrecognized/);
  assert.throws(() => s.updateMetadata(Buffer.from([8, 1]), 10), /missing/);
  assert.equal(s.decodeString(s.encodeString('音楽', 0)), '音楽');
  const f = await fixture(); t.after(f.cleanup); const db = await open(f.directory); await db.put(metaKey, Buffer.from([8, 1])); await db.close();
  await assert.rejects(s.change(f.candidate, f.backup), /missing/);
  assert.equal((await s.inspectDirect(f.candidate)).fixed, false);
});
test('platform discovery includes standard Windows and macOS native storage roots', () => {
  assert.ok(locations('darwin', {}, '/Users/example').some(c => c.directory === path.join('/Users/example', 'Library', 'Caches', 'com.spotify.client', 'Browser', 'Local Storage', 'leveldb')));
  assert.ok(locations('win32', { LOCALAPPDATA: 'local', APPDATA: 'roaming' }, 'home').some(c => c.directory === path.join('local', 'Spotify', 'Browser', 'Local Storage', 'leveldb')));
});
test('a stale pre-migration profile cannot override the active Spotify profile status', async t => {
  const old = await fixture(), current = await fixture(); t.after(old.cleanup); t.after(current.cleanup);
  for (const name of await fs.readdir(old.directory)) await fs.utimes(path.join(old.directory, name), new Date(1000), new Date(1000));
  const selected = await selectCurrentProfiles([{ ...old.candidate, installation: 'same-app' }, { ...current.candidate, installation: 'same-app' }]);
  assert.equal(selected.length, 1); assert.equal(selected[0].directory, current.directory);
});
