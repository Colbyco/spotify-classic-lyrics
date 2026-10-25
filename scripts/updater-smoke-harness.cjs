'use strict';

// Test-only entry point. Packaged by updater-smoke.cjs with an isolated identity;
// never included in the production app's files list.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { supportsUpdates, createUpdates } = require('../src/updates.cjs');
const metadata = require(path.join(app.getAppPath(), 'package.json'));
const fixture = metadata.updaterSmoke;
if (!fixture || fixture.marker !== 'classic-lyrics-ci-updater-fixture' || process.platform !== 'win32') app.exit(1);
const root = fixture.root;
const controlPath = path.join(root, 'control.json');
const settingsPath = path.join(root, 'user-data', 'settings.json');
fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
app.setPath('userData', path.dirname(settingsPath));
app.setName(metadata.name);
const control = () => JSON.parse(fs.readFileSync(controlPath, 'utf8'));
const record = (event, detail = {}) => fs.appendFileSync(path.join(root, 'events.jsonl'), JSON.stringify({ event, version: app.getVersion(), ...detail }) + '\n');
let finished = false;
function finish(phase, detail) {
  if (finished) return;
  finished = true;
  fs.writeFileSync(path.join(root, `${phase}.json`), JSON.stringify({ passed: true, ...detail }));
  app.quit();
}
function fail(error) {
  fs.writeFileSync(path.join(root, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack }));
  app.exit(1);
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

app.whenReady().then(async () => {
  const phase = control().phase;
  record('started', { phase, executable: process.execPath });
  assert.equal(app.isPackaged, true);
  assert.equal(path.resolve(process.execPath).toLowerCase(), path.resolve(fixture.executable).toLowerCase());
  if (phase === 'restarted') {
    assert.equal(app.getVersion(), fixture.newVersion);
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), fixture.settings);
    finish('restarted', { version: app.getVersion(), settingsPreserved: true, executable: process.execPath });
    return;
  }
  assert.equal(app.getVersion(), fixture.oldVersion);
  const background = phase === 'background';
  const eligible = supportsUpdates({ packaged: app.isPackaged, platform: process.platform, portable: false, background, selfTest: false });
  if (background) {
    assert.equal(eligible, false);
    // This mirrors the production entry point's eligibility guard: no updater
    // is constructed and no feed is queried for a sign-in/background repair.
    finish('background', { updaterCreated: false });
    return;
  }
  assert.equal(eligible, true);
  const { NsisUpdater } = require('electron-updater');
  const updater = new NsisUpdater({ provider: 'generic', url: fixture.feed });
  // Full-body downloads make both the checksum failure and success observable.
  updater.disableDifferentialDownload = true;
  let lastError;
  updater.on('error', error => { lastError = error; record('updater-error', { code: error.code, message: error.message }); });
  let canInstall = false;
  const realInstall = updater.quitAndInstall.bind(updater);
  updater.quitAndInstall = (...args) => {
    assert.deepEqual(args, [false, true]);
    assert.equal(control().allowInstall, true);
    record('install-requested', { args });
    fs.writeFileSync(controlPath, JSON.stringify({ phase: 'restarted', allowInstall: false }));
    realInstall(...args);
  };
  const updates = createUpdates({ updater, canInstall: () => canInstall, onChange: state => {
    record('state', state);
    if (state.kind === 'error') {
      assert.equal(phase, 'corrupt');
      assert.equal(lastError?.code, 'ERR_CHECKSUM_MISMATCH');
      finish('corrupt', { checksumRejected: true, code: lastError.code });
    }
    if (state.kind === 'ready') {
      assert.equal(phase, 'update');
      assert.equal(state.version, fixture.newVersion);
      assert.equal(updater.autoInstallOnAppQuit, false);
      assert.throws(() => updates.install(), /Wait for/);
      assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), fixture.settings);
      fs.writeFileSync(path.join(root, 'ready.json'), JSON.stringify({ version: state.version }));
      const timer = setInterval(() => {
        if (!control().allowInstall) return;
        clearInterval(timer);
        canInstall = true;
        updates.install();
      }, 100);
    }
  } });
  assert.throws(() => updates.install(), /not finished/);
  await updates.check();
}).catch(fail);
