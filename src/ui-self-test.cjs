'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { BrowserWindow, ipcMain } = require('electron');
const { Reports } = require('./reporting.cjs');

// Runs only inside --self-test on build machines. Uses the shipped renderer and
// preload, synthetic state and a stub transport. Never calls Spotify or uploads.
async function run() {
  let uploads = 0, status = { kind: 'needs-fix', message: 'Put lyrics back beside your library and playback controls.', canUndo: false, canReport: false, autoRepair: false };
  const reports = new Reports(async (_url, options) => {
    uploads++;
    const body = JSON.parse(options.body); assert.equal(body.consent, true);
    return { ok: true, json: async () => ({ accepted: true, id: body.id }) };
  });
  const example = { schema: 1, appVersion: '1.0.1', platform: process.platform, osVersion: '1.0', architecture: process.arch, spotifyVersion: null, installation: 'desktop', spotifyRunning: false, storageState: 'fixed', flagValues: ['CONTROL'], readErrors: [], lastFix: 'saved', lastError: 'none', automaticRepair: false, issue: 'lyrics-still-fullscreen' };
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
  const win = new BrowserWindow({ width: 440, height: 365, show: false, focusable: false, skipTaskbar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true } });
  try {
    await win.loadFile(path.join(__dirname, 'index.html'));
    const evaluate = source => win.webContents.executeJavaScript(source);
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
    await evaluate('document.getElementById("fix").click()');
    await waitFor('!document.getElementById("report").hidden && !document.getElementById("report").disabled');
    assert.equal(await evaluate('document.getElementById("fix").textContent'), 'Fixed');
    await evaluate('document.getElementById("report").click()');
    await waitFor('!document.getElementById("report-view").hidden && !document.getElementById("issue").disabled');
    assert.equal(await evaluate('document.getElementById("send").disabled'), true);
    assert.equal(await evaluate('document.getElementById("consent").checked'), false);
    assert.equal(uploads, 0);
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
