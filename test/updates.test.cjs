'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { supportsUpdates, createUpdates } = require('../src/updates.cjs');

function fixture(check, canInstall) {
  const updater = new EventEmitter(), states = [], installs = [];
  updater.checkForUpdates = () => check(updater);
  updater.quitAndInstall = (...args) => installs.push(args);
  const updates = createUpdates({ updater, onChange: value => states.push(value), canInstall });
  return { updater, updates, states, installs };
}
test('updates only run in the installed Windows foreground app', () => {
  const installed = { packaged: true, platform: 'win32', portable: false, background: false, selfTest: false };
  assert.equal(supportsUpdates(installed), true);
  for (const patch of [{ packaged: false }, { platform: 'darwin' }, { portable: true }, { background: true }, { selfTest: true }]) assert.equal(supportsUpdates({ ...installed, ...patch }), false);
});
test('one download at a time, explicit restart, stable releases and no install on quit', async () => {
  let calls = 0, done;
  const f = fixture(async updater => {
    calls++; updater.emit('update-available', { version: '1.0.5' });
    return { downloadPromise: new Promise(resolve => { done = resolve; }) };
  });
  assert.equal(f.updater.autoDownload, true);
  assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal(f.updater.allowDowngrade, false);
  assert.equal(f.updater.allowPrerelease, false);
  assert.equal(f.updater.disableWebInstaller, true);
  await Promise.all([f.updates.check(), f.updates.check()]); assert.equal(calls, 1);
  assert.throws(() => f.updates.install(), /not finished/);
  f.updater.emit('download-progress', { percent: 48.9 });
  assert.equal(f.updates.state.message, 'Downloading update… 48%');
  f.updater.emit('update-downloaded', { version: '1.0.5' }); done();
  await f.updates.check(); assert.equal(calls, 1); assert.deepEqual(f.installs, []);
  f.updates.install(); assert.deepEqual(f.installs, [[false, true]]);
});
test('offline checks and download failures are recoverable and reveal no raw URLs or logs', async () => {
  let calls = 0;
  const f = fixture(async updater => {
    if (++calls === 1) throw new Error('private/path?token=secret');
    if (calls === 2) { updater.emit('update-available', { version: '1.0.5' }); return { downloadPromise: Promise.reject(new Error('download failed')) }; }
    updater.emit('update-not-available'); return {};
  });
  await f.updates.check(); assert.equal(f.updates.state.kind, 'error');
  assert.ok(!JSON.stringify(f.states).includes('secret'));
  await f.updates.check(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.updates.state.kind, 'error');
  await f.updates.check(); assert.equal(f.updates.state.kind, 'current'); assert.deepEqual(f.installs, []);
});
test('restart is blocked while a fix or report is in progress', async () => {
  let allowed = false;
  const f = fixture(async () => ({}), () => allowed);
  f.updater.emit('update-downloaded', { version: '1.0.5' });
  assert.throws(() => f.updates.install(), /finish/); assert.equal(f.updates.state.kind, 'ready');
  allowed = true; f.updates.install(); assert.equal(f.installs.length, 1);
});
