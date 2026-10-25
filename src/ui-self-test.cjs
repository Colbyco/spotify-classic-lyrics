'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { BrowserWindow, ipcMain } = require('electron');
const { Reports } = require('./reporting.cjs');

// Runs only inside --self-test on build machines. Uses the shipped renderer and
// preload, synthetic state and a stub transport. Never calls Spotify or uploads.
async function run(screenshotDirectory) {
  let uploads = 0, status = { kind: 'needs-fix', message: 'Put lyrics back beside your library and playback controls.', canUndo: false, canReport: false, autoRepair: false };
  const reports = new Reports(async (_url, options) => {
    uploads++;
    const body = JSON.parse(options.body); assert.equal(body.consent, true);
    return { ok: true, json: async () => ({ accepted: true, id: body.id }) };
  });
  const example = { schema: 1, appVersion: require('../package.json').version, platform: process.platform, osVersion: '1.0', architecture: process.arch, spotifyVersion: null, installation: 'desktop', spotifyRunning: false, storageState: 'fixed', flagValues: ['CONTROL'], readErrors: [], lastFix: 'saved', lastError: 'none', automaticRepair: false, issue: 'lyrics-still-fullscreen' };
  const commands = [];
  ipcMain.handle('command', async (_event, name, argument) => {
    commands.push(name);
    switch (name) {
      case 'status': return status;
      case 'fix': status = { ...status, kind: 'fixed', canUndo: true, canReport: true, message: 'The lyrics setting is saved.' }; return status;
      case 'report': return reports.prepare(example);
      case 'report-issue': return reports.update(argument.id, argument.issue);
      case 'send-report': return reports.submit(argument);
      case 'report-close': reports.current = null; return;
      default: throw new Error(`Unexpected test action: ${name}`);
    }
  });
  const makeWindow = (width, height) => new BrowserWindow({ width, height, show: !!screenshotDirectory, focusable: false, skipTaskbar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  let win = makeWindow(440, 365);
  try {
    await win.loadFile(path.join(__dirname, 'index.html'));
    if (screenshotDirectory) win.showInactive();
    const evaluate = source => win.webContents.executeJavaScript(source);
    const capture = async name => {
      if (!screenshotDirectory) return;
      await fs.mkdir(screenshotDirectory, { recursive: true });
      let frameTimeout;
      try {
        await Promise.race([
          evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'),
          new Promise((_resolve, reject) => { frameTimeout = setTimeout(() => reject(new Error('App compositor did not settle.')), 10000); })
        ]);
      } finally { clearTimeout(frameTimeout); }
      const png = await new Promise((resolve, reject) => {
        let frames = 0;
        const finish = (error, image) => {
          clearTimeout(timeout);
          win.webContents.removeListener('paint', onPaint);
          if (error) reject(error); else resolve(image.toPNG());
        };
        const onPaint = (_event, _dirty, image) => {
          if (image.isEmpty()) return;
          // Force a second frame so a pending resize or DOM update is included.
          if (++frames < 2) win.webContents.invalidate();
          else finish(null, image);
        };
        const timeout = setTimeout(() => finish(new Error('App screenshot did not render.')), 10000);
        win.webContents.on('paint', onPaint);
        win.webContents.startPainting();
        win.webContents.invalidate();
      });
      await fs.writeFile(path.join(screenshotDirectory, `${name}.png`), png);
    };
    const waitFor = async expression => {
      for (let n = 0; n < 400; n++) {
        if (await evaluate(`Boolean(${expression})`)) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error(`Renderer did not reach: ${expression}`);
    };
    await waitFor('!document.getElementById("fix").disabled');
    assert.equal(await evaluate('document.getElementById("report").hidden'), true);
    const bounds = await evaluate('({width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight})');
    assert.ok(bounds.scrollWidth <= bounds.width && bounds.scrollHeight <= bounds.height, 'Compact view must fit its window');
    await capture('app');
    await evaluate('document.getElementById("fix").click()');
    await waitFor('!document.getElementById("report").hidden && !document.getElementById("report").disabled');
    assert.equal(await evaluate('document.getElementById("fix").textContent'), 'Fixed');
    if (screenshotDirectory) {
      // A fresh offscreen surface avoids Windows retaining the old clip bounds
      // when a software-rendered window is resized for the report screen.
      const previous = win;
      win = makeWindow(460, 690);
      await win.loadFile(path.join(__dirname, 'index.html'));
      win.showInactive();
      previous.destroy();
      await waitFor('!document.getElementById("report").hidden && !document.getElementById("report").disabled');
    }
    await evaluate('document.getElementById("report").click()');
    await waitFor('!document.getElementById("report-view").hidden && !document.getElementById("issue").disabled');
    assert.equal(await evaluate('document.getElementById("send").disabled'), true);
    assert.equal(await evaluate('document.getElementById("consent").checked'), false);
    assert.equal(uploads, 0);
    win.setSize(460, 690);
    if (screenshotDirectory) await waitFor('innerWidth === 460 && innerHeight === 690');
    await capture('report');
    await evaluate('document.getElementById("consent").click()');
    assert.equal(await evaluate('document.getElementById("send").disabled'), false);
    await evaluate('document.getElementById("issue").value="automatic-repair-failed"; document.getElementById("issue").dispatchEvent(new Event("change"))');
    await waitFor('!document.getElementById("issue").disabled');
    assert.equal(await evaluate('document.getElementById("consent").checked'), false, 'Changing the reviewed report must clear consent');
    assert.equal(await evaluate('document.getElementById("send").disabled'), true);
    assert.equal(uploads, 0);
    win.setSize(460, 690);
    await evaluate('document.getElementById("consent").click(); document.getElementById("send").click()');
    await waitFor('document.getElementById("send").textContent === "Sent" && !document.getElementById("back").disabled');
    assert.equal(uploads, 1);
    assert.equal(await evaluate('document.getElementById("send").disabled'), true);
    await evaluate('document.getElementById("back").click()');
    await waitFor('!document.getElementById("home").hidden');
    assert.ok(commands.includes('report-issue') && commands.includes('send-report'));
    return ['compact renderer fits window', 'report appears after fix', 'review is local', 'report edits clear consent', 'consent-gated send through preload', 'receipt and back navigation'];
  } finally { win.destroy(); ipcMain.removeHandler('command'); }
}
module.exports = { run };
