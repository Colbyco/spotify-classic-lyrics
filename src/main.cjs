'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage, nativeTheme, shell } = require('electron');
if (process.argv.includes('--self-test') && process.argv.some(a => a.startsWith('--screenshots='))) app.disableHardwareAcceleration();
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const storage = require('./storage.cjs');
const platform = require('./platform.cjs');
const { runAtStartup } = require('./watcher.cjs');
const diagnostics = require('./diagnostics.cjs');
const { Reports } = require('./reporting.cjs');
const { normalizeSettings, windowBackground, saveAppearance } = require('./appearance.cjs');
const reports = new Reports();
let lastFix = 'not-attempted', lastError = 'none', attempted = false;
const REPOSITORY = 'https://github.com/Colbyco/spotify-classic-lyrics';
let window, tray, settings, state = { kind: 'checking', message: 'Looking for Spotify…', autoRepair: false }, checking = false, busy = false;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const backupFile = () => path.join(app.getPath('userData'), 'lyrics-backup.json');
const indexUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;

function emit(patch) {
  state = { ...state, ...patch, autoRepair: settings?.autoRepair || false, version: app.getVersion() };
  state.appearance = settings?.appearance || 'system';
  state.canReport = attempted || state.canUndo || ['fixed', 'error', 'not-found', 'unavailable'].includes(state.kind);
  if (window && !window.isDestroyed()) window.webContents.send('status', state);
  if (tray) tray.setToolTip(`Classic Lyrics — ${state.kind === 'fixed' ? 'classic layout is active' : 'open for status'}`);
  return state;
}
async function check() {
  if (checking || busy) return state;
  checking = true;
  try {
    const candidates = await platform.discover();
    const statuses = []; let failures = 0;
    for (const candidate of candidates) {
      try { const status = await storage.inspectSnapshot(candidate); if (status.profiles) statuses.push(status); }
      catch { failures++; }
    }
    const backup = await storage.readJson(backupFile(), { records: [] });
    const running = await platform.isSpotifyRunning();
    const fixed = statuses.length > 0 && !failures && statuses.every(s => s.fixed);
    return emit({ kind: fixed ? 'fixed' : statuses.length ? 'needs-fix' : candidates.length ? 'unavailable' : 'not-found',
      message: fixed ? 'The lyrics setting is saved. Open Lyrics in Spotify to check it.' : statuses.length ? (settings.autoRepair && running ? 'Spotify is open. Use Fix lyrics layout to apply the setting with a restart.' : 'Put lyrics back beside your library and playback controls.') : candidates.length ? 'Quit Spotify and check again. If it is a new install, sign in and play a song first.' : 'Open Spotify, sign in, and play a song. Then check again.',
      running, profiles: statuses.reduce((sum, s) => sum + s.profiles, 0), canUndo: backup.records.length > 0, lastChecked: Date.now(), readErrors: failures });
  } catch (error) { return emit({ kind: 'error', message: friendly(error), lastChecked: Date.now() }); }
  finally { checking = false; }
}
function friendly(error) {
  if (['LEVEL_LOCKED', 'LEVEL_DATABASE_NOT_OPEN'].includes(error.code) || /lock/i.test(error.message)) return 'Spotify is still using its settings. Quit Spotify completely and try again.';
  if (error.code === 'EACCES' || error.code === 'EPERM') return 'Spotify settings are unavailable. Check access to your own Spotify profile and retry.';
  return error.message || 'The setting could not be changed.';
}
async function setAuto(enabled) {
  if (typeof enabled !== 'boolean') throw new Error('Invalid preference.');
  if (enabled && !app.isPackaged) throw new Error('Automatic repair is available in the downloaded app.');
  if (enabled && process.env.PORTABLE_EXECUTABLE_FILE) throw new Error('Use the Windows Setup download to enable automatic repair and startup. The portable app supports Fix now.');
  if (enabled && process.platform === 'darwin' && !app.isInApplicationsFolder()) throw new Error('Move Classic Lyrics to Applications before enabling automatic repair.');
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--background'] });
  settings.autoRepair = enabled;
  await storage.writeJson(settingsFile(), settings);
  emit({ message: enabled ? 'Automatic repair will run when this tool starts, if Spotify is closed.' : 'Automatic repair is off.' });
  await check();
  return state;
}
async function repair({ undo = false, background = false } = {}) {
  if (busy || checking) return state;
  if (!undo && !background) { attempted = true; emit({}); }
  let wasRunning;
  try { wasRunning = await platform.isSpotifyRunning(); }
  catch (error) { if (!undo) { lastFix = 'failed'; lastError = diagnostics.errorCategory(error); } return emit({ kind: 'error', message: friendly(error) }); }
  if (background && wasRunning) return state;
  if (wasRunning) {
    const { response } = await dialog.showMessageBox(window, { type: 'question', title: undo ? 'Undo the lyrics fix' : 'Fix lyrics layout', message: 'Spotify needs to close briefly.', detail: 'Playback will pause. Spotify will reopen after its lyrics setting is saved.', buttons: [undo ? 'Close Spotify and undo' : 'Close Spotify and fix', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true });
    if (response !== 0) { if (!undo) { lastFix = 'cancelled'; lastError = 'none'; } return state; }
  }
  busy = true; emit({ kind: 'working', message: undo ? 'Restoring your previous lyrics preference…' : 'Saving the classic lyrics preference…' });
  let error;
  try {
    if (undo && settings.autoRepair) { settings.autoRepair = false; app.setLoginItemSettings({ openAtLogin: false }); await storage.writeJson(settingsFile(), settings); }
    if (wasRunning) await platform.stopSpotify();
    // Recheck immediately before writing; the database lock closes the remaining race.
    if (await platform.isSpotifyRunning()) throw new Error('Spotify restarted before the repair. Quit it completely and retry.');
    const candidates = await platform.discover();
    let found = 0;
    for (const candidate of candidates) {
      const status = await storage.inspectSnapshot(candidate);
      if (!status.profiles) continue;
      found++;
      await storage.change(candidate, backupFile(), undo);
    }
    if (!found) throw new Error('No signed-in Spotify settings found. Open Spotify, sign in, play a song, then retry.');
  } catch (caught) { error = caught; }
  finally {
    busy = false;
    if (wasRunning) await platform.openSpotify(shell).catch(() => {});
  }
  await check();
  if (!undo && !error && state.kind !== 'fixed') error = new Error('The saved setting could not be confirmed. Check again or report the problem.');
  if (!undo) { lastFix = error ? 'failed' : state.kind === 'fixed' ? 'saved' : 'failed'; lastError = error ? diagnostics.errorCategory(error) : lastFix === 'saved' ? 'none' : 'other'; }
  if (error) emit({ kind: 'error', message: friendly(error) });
  else if (undo) { lastFix = 'not-attempted'; lastError = 'none'; emit({ message: 'Your previous lyrics preference was restored. Automatic repair is off.' }); }
  else emit({ message: background ? 'The lyrics setting was reapplied at startup while Spotify was closed.' : 'The lyrics setting is saved. Open Lyrics in Spotify to check it.' });
  return state;
}
function showWindow() {
  if (window && !window.isDestroyed()) { window.show(); window.focus(); return; }
  window = new BrowserWindow({ width: 440, height: 365, minWidth: 400, minHeight: 340, title: 'Spotify lyrics fix', backgroundColor: windowBackground(nativeTheme.shouldUseDarkColors), autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== indexUrl) event.preventDefault(); });
  window.loadFile(path.join(__dirname, 'index.html'));
  window.on('closed', () => { window = null; });
}
function createTray() {
  let icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Classic Lyrics', click: showWindow },
    { label: 'Check Spotify', click: async () => { showWindow(); await check(); } },
    { type: 'separator' },
    { label: 'Quit Classic Lyrics', click: () => app.quit() }
  ]));
  tray.on('click', showWindow);
}
async function start() {
  if (process.argv.includes('--self-test')) {
    const testReport = process.argv.find(a => a.startsWith('--report='))?.slice(9);
    try { await require('./self-test.cjs').run(testReport, process.argv.find(a => a.startsWith('--screenshots='))?.slice(14)); app.exit(0); }
    catch (error) { if (testReport) await fs.writeFile(testReport, JSON.stringify({ passed: false, error: error.stack })).catch(() => {}); console.error(error); app.exit(1); }
    return;
  }
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  settings = normalizeSettings(await storage.readJson(settingsFile(), {}));
  nativeTheme.themeSource = settings.appearance;
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ label: 'Classic Lyrics', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  ipcMain.handle('command', async (event, command, argument) => {
    if (event.senderFrame.url !== indexUrl) throw new Error('Untrusted caller.');
    switch (command) {
      case 'status': return state;
      case 'check': return check();
      case 'fix': return repair();
      case 'undo': return repair({ undo: true });
      case 'auto': return setAuto(argument);
      case 'appearance':
        await saveAppearance(argument, { settings, persist: value => storage.writeJson(settingsFile(), value), nativeTheme });
        return emit({});
      case 'report': {
        if (busy || checking) throw new Error('Wait for the current check to finish.');
        const report = await diagnostics.collect({ appVersion: app.getVersion(), automaticRepair: settings.autoRepair, lastFix, lastError });
        const reviewed = await reports.prepare(report);
        window?.setSize(460, 690);
        return reviewed;
      }
      case 'report-issue': return reports.update(argument?.id, argument?.issue);
      case 'send-report': return reports.submit(argument);
      case 'save-report': {
        if (!reports.current || argument?.id !== reports.current.id) throw new Error('Run the checks again.');
        const { canceled, filePath } = await dialog.showSaveDialog(window, { title: 'Save diagnostic report', defaultPath: 'spotify-lyrics-report.json', filters: [{ name: 'JSON report', extensions: ['json'] }] });
        if (!canceled && filePath) await fs.writeFile(filePath, JSON.stringify(reports.current.report, null, 2), { mode: 0o600 });
        return { saved: !canceled && !!filePath };
      }
      case 'report-close':
        if (reports.sending) throw new Error('Wait for the report to finish sending.');
        reports.current = null; window?.setSize(440, 365); return;
      case 'spotify': await platform.openSpotify(shell); return state;
      case 'source': await shell.openExternal(REPOSITORY); return state;
      case 'quit': app.quit(); return;
      default: throw new Error('Unknown action.');
    }
  });
  const background = process.argv.includes('--background') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);
  await runAtStartup({ enabled: settings.autoRepair, background, inspect: check,
    repair: () => repair({ background: true }), openWindow: () => { createTray(); showWindow(); }, quit: () => app.quit() });
}
app.on('second-instance', showWindow);
app.on('activate', () => { if (settings) showWindow(); });
app.on('window-all-closed', () => { if (!process.argv.includes('--self-test')) app.quit(); });
nativeTheme.on('updated', () => {
  if (window && !window.isDestroyed()) window.setBackgroundColor(windowBackground(nativeTheme.shouldUseDarkColors));
  if (settings) emit({});
});
app.whenReady().then(start).catch(error => { dialog.showErrorBox('Classic Lyrics', friendly(error)); app.quit(); });
