'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const storage = require('./storage.cjs');
const platform = require('./platform.cjs');
const { watchOnce } = require('./watcher.cjs');
const REPOSITORY = 'https://github.com/Colbyco/spotify-classic-lyrics';
let window, tray, settings, state = { kind: 'checking', message: 'Looking for Spotify…', autoRepair: false }, checking = false, busy = false, quitting = false;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const backupFile = () => path.join(app.getPath('userData'), 'lyrics-backup.json');
const indexUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;

function emit(patch) {
  state = { ...state, ...patch, autoRepair: settings?.autoRepair || false, version: app.getVersion() };
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
    const fixed = statuses.length > 0 && statuses.every(s => s.fixed);
    return emit({ kind: fixed ? 'fixed' : statuses.length ? 'needs-fix' : candidates.length ? 'unavailable' : 'not-found',
      message: fixed ? 'Lyrics, your library, and playback controls stay together.' : statuses.length ? (settings.autoRepair && running ? 'A reset was detected. Repair is queued for when Spotify closes.' : 'Restore the classic lyrics layout with one click.') : candidates.length ? 'Quit Spotify and try again. If you just installed it, sign in and play a song first.' : 'Open the Spotify desktop app, sign in, and play a song. Then check again.',
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
  emit({ message: enabled ? 'Automatic repair is on. Spotify is never interrupted in the background.' : 'Automatic repair is off.' });
  await check();
  return state;
}
async function repair({ undo = false, background = false } = {}) {
  if (busy || checking) return state;
  const wasRunning = await platform.isSpotifyRunning();
  if (background && wasRunning) return state;
  if (wasRunning) {
    const { response } = await dialog.showMessageBox(window, { type: 'question', title: undo ? 'Undo the lyrics fix' : 'Restore classic lyrics', message: 'Spotify needs to close briefly.', detail: 'Playback will pause. Spotify will reopen after its lyrics setting is saved.', buttons: [undo ? 'Close Spotify and undo' : 'Close Spotify and repair', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true });
    if (response !== 0) return state;
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
  if (error) emit({ kind: 'error', message: friendly(error) });
  else if (undo) emit({ message: 'Your previous lyrics preference was restored. Automatic repair is off.' });
  else emit({ message: background ? 'The lyrics preference was repaired automatically while Spotify was closed.' : 'The classic lyrics preference is saved. Open Lyrics in Spotify to see it.' });
  return state;
}
async function tick() {
  await watchOnce({ enabled: settings.autoRepair, inspect: check, repair: () => repair({ background: true }) });
}
function showWindow() {
  if (window && !window.isDestroyed()) { window.show(); window.focus(); return; }
  window = new BrowserWindow({ width: 760, height: 740, minWidth: 620, minHeight: 680, title: 'Classic Lyrics', backgroundColor: '#111315', autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== indexUrl) event.preventDefault(); });
  window.loadFile(path.join(__dirname, 'index.html'));
  window.on('close', event => { if (!quitting && settings.autoRepair) { event.preventDefault(); window.hide(); } });
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
    try { await require('./self-test.cjs').run(process.argv.find(a => a.startsWith('--report='))?.slice(9)); app.exit(0); }
    catch (error) { console.error(error); app.exit(1); }
    return;
  }
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  settings = await storage.readJson(settingsFile(), { autoRepair: false });
  settings = { autoRepair: settings.autoRepair === true };
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ label: 'Classic Lyrics', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  createTray();
  ipcMain.handle('command', async (event, command, argument) => {
    if (event.senderFrame.url !== indexUrl) throw new Error('Untrusted caller.');
    switch (command) {
      case 'status': return state;
      case 'check': return check();
      case 'fix': return repair();
      case 'undo': return repair({ undo: true });
      case 'auto': return setAuto(argument);
      case 'spotify': await platform.openSpotify(shell); return state;
      case 'source': await shell.openExternal(REPOSITORY); return state;
      case 'quit': app.quit(); return;
      default: throw new Error('Unknown action.');
    }
  });
  const background = process.argv.includes('--background') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);
  if (!background || !settings.autoRepair) showWindow();
  await tick();
  setInterval(() => { if (settings.autoRepair || window?.isVisible()) tick().catch(() => {}); }, 15000).unref();
}
app.on('second-instance', showWindow);
app.on('activate', () => { if (settings) showWindow(); });
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (!settings?.autoRepair) app.quit(); });
app.whenReady().then(start).catch(error => { dialog.showErrorBox('Classic Lyrics', friendly(error)); app.quit(); });
