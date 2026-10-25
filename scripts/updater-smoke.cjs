'use strict';

// Installs only a temporary, uniquely named fixture on a disposable CI runner.
// This script deliberately refuses normal developer machines.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

if (process.platform !== 'win32' || process.env.CI !== 'true') {
  console.error('Updater smoke test requires Windows and CI=true on a disposable CI runner. No installation performed.');
  process.exit(1);
}

const repo = path.resolve(__dirname, '..');
const oldVersion = '0.0.1', newVersion = '0.0.2';
const settings = { autoRepair: true, appearance: 'dark', fixtureValue: crypto.randomUUID() };
let root, server;
const children = new Set();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function run(file, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: 'inherit', ...options });
    children.add(child);
    child.once('error', reject);
    child.once('exit', (code, signal) => { children.delete(child); code === 0 ? resolve() : reject(new Error(`${path.basename(file)} exited ${code ?? signal}`)); });
  });
}
function launch(file) {
  const child = spawn(file, [], { windowsHide: true, stdio: 'inherit' });
  children.add(child);
  child.once('error', error => { console.error(error); });
  child.once('exit', () => children.delete(child));
  return child;
}
async function waitFor(name, timeout = 120_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (fs.existsSync(path.join(root, 'failure.json'))) throw new Error(await fsp.readFile(path.join(root, 'failure.json'), 'utf8'));
    try { return JSON.parse(await fsp.readFile(path.join(root, name), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${name}. Logs: ${root}`);
}
async function waitForExit(child) {
  const until = Date.now() + 15_000;
  while (children.has(child) && Date.now() < until) await delay(100);
  assert.equal(children.has(child), false, 'Fixture did not exit');
}
function assertOwned(target) {
  const relative = path.relative(root, path.resolve(target));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `Not a fixture-owned path: ${target}`);
}

async function main() {
  root = await fsp.mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'classic-lyrics-updater-smoke-'));
  console.log(`Updater smoke-test diagnostics: ${root}`);
  const suffix = crypto.randomBytes(5).toString('hex');
  const productName = `LyricsUpdaterSmoke-${suffix}`;
  const executable = path.join(root, 'installed', `${productName}.exe`);
  const feedDir = path.join(root, 'new');
  const requests = [];
  let corrupt = false;
  server = http.createServer(async (req, res) => {
    try {
      const name = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).slice(1);
      if (!name || name !== path.basename(name)) { res.writeHead(404).end(); return; }
      const file = path.join(feedDir, name);
      let bytes = await fsp.readFile(file);
      if (name === 'latest.yml' && corrupt) {
        bytes = Buffer.from(bytes.toString('utf8').replace(/sha512:\s*\S+/g, `sha512: ${Buffer.alloc(64).toString('base64')}`));
      }
      requests.push({ name, bytes: bytes.length, corrupt });
      res.writeHead(200, { 'Content-Length': bytes.length, 'Content-Type': name.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream' });
      res.end(bytes);
    } catch (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 500).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const feed = `http://127.0.0.1:${server.address().port}/`;
  const { build, Platform, Arch } = require('electron-builder');
  const metadata = { marker: 'classic-lyrics-ci-updater-fixture', root, feed, executable, oldVersion, newVersion, settings };
  for (const [folder, version] of [['old', oldVersion], ['new', newVersion]]) {
    await build({ projectDir: repo, targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never', config: {
      appId: `com.colbyco.classiclyrics.updater-smoke.${suffix}`,
      productName,
      extraMetadata: { name: `lyrics-updater-smoke-${suffix}`, version, main: 'scripts/updater-smoke-harness.cjs', updaterSmoke: metadata },
      directories: { output: path.join(root, folder) },
      files: ['scripts/updater-smoke-harness.cjs', 'src/updates.cjs', 'package.json'],
      asar: true,
      npmRebuild: false,
      win: { target: ['nsis'], executableName: productName, artifactName: '${productName}-${version}.${ext}', signAndEditExecutable: false },
      nsis: { oneClick: true, perMachine: false, allowElevation: false, runAfterFinish: false, createDesktopShortcut: false, createStartMenuShortcut: false, artifactName: '${productName}-${version}.${ext}', deleteAppDataOnUninstall: false },
      // An array replaces the production GitHub publish object rather than
      // deep-merging its owner/repo fields into this test-only generic feed.
      publish: [{ provider: 'generic', url: feed }]
    } });
  }
  const manifest = require('js-yaml').load(await fsp.readFile(path.join(feedDir, 'latest.yml'), 'utf8'));
  assert.equal(manifest.version, newVersion);
  const payload = manifest.files.find(file => file.url.endsWith('.exe'));
  assert.ok(payload, 'No NSIS payload in builder metadata');
  const payloadBytes = await fsp.readFile(path.join(feedDir, payload.url));
  assert.equal(crypto.createHash('sha512').update(payloadBytes).digest('base64'), payload.sha512);
  const installer = path.join(root, 'old', `${productName}-${oldVersion}.exe`);
  assertOwned(installer);
  assertOwned(path.dirname(executable));
  await run(installer, ['/S', `/D=${path.dirname(executable)}`]);
  assert.ok(fs.existsSync(executable), 'Fixture did not install to its isolated directory');
  await fsp.mkdir(path.join(root, 'user-data'), { recursive: true });
  await fsp.writeFile(path.join(root, 'user-data', 'settings.json'), JSON.stringify(settings));
  const control = async value => {
    const temporary = path.join(root, 'control.tmp');
    await fsp.writeFile(temporary, JSON.stringify(value));
    await fsp.rename(temporary, path.join(root, 'control.json'));
  };

  await control({ phase: 'background', allowInstall: false });
  const background = launch(executable);
  assert.equal((await waitFor('background.json')).updaterCreated, false);
  await waitForExit(background);
  assert.equal(requests.length, 0, 'Background startup queried the update feed');

  corrupt = true;
  await control({ phase: 'corrupt', allowInstall: false });
  const corruptApp = launch(executable);
  assert.equal((await waitFor('corrupt.json')).checksumRejected, true);
  await waitForExit(corruptApp);
  assert.ok(requests.some(req => req.name === payload.url && req.corrupt && req.bytes === payloadBytes.length), 'Corrupt checksum phase did not download the actual installer');

  corrupt = false;
  await control({ phase: 'update', allowInstall: false });
  const updatingApp = launch(executable);
  assert.equal((await waitFor('ready.json')).version, newVersion);
  await delay(2000);
  assert.equal(children.has(updatingApp), true, 'Fixture exited before installation permission');
  assert.equal(fs.existsSync(path.join(root, 'restarted.json')), false, 'Update installed before permission');
  const eventsBefore = await fsp.readFile(path.join(root, 'events.jsonl'), 'utf8');
  assert.equal(eventsBefore.includes('"event":"install-requested"'), false, 'Install called before permission');
  assert.ok(requests.some(req => req.name === payload.url && !req.corrupt && req.bytes === payloadBytes.length), 'Successful phase did not download the actual installer');
  await control({ phase: 'update', allowInstall: true });
  const result = await waitFor('restarted.json');
  assert.equal(result.version, newVersion);
  assert.equal(result.settingsPreserved, true);
  await waitForExit(updatingApp);
  await delay(1500);
  const events = (await fsp.readFile(path.join(root, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events.filter(event => event.event === 'install-requested').length, 1);
  const report = { passed: true, oldVersion, newVersion, checksumRejected: true, explicitInstallGate: true, restarted: true, settingsPreserved: true, backgroundRequests: 0, requests, root };
  const uninstallerName = (await fsp.readdir(path.dirname(executable))).find(name => /^Uninstall.*\.exe$/i.test(name));
  assert.ok(uninstallerName, 'Fixture uninstaller missing');
  const uninstaller = path.join(path.dirname(executable), uninstallerName);
  assertOwned(uninstaller);
  await run(uninstaller, ['/S']);
  const uninstallDeadline = Date.now() + 30_000;
  while (fs.existsSync(executable) && Date.now() < uninstallDeadline) await delay(100);
  assert.equal(fs.existsSync(executable), false, 'Fixture did not uninstall');
  await fsp.writeFile(path.join(root, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const child of children) child.kill();
  server?.closeAllConnections();
  server?.close();
});
