'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const { readUsername } = require('./storage.cjs');

function locations(platform = process.platform, env = process.env, home = os.homedir()) {
  const roots = [];
  if (platform === 'win32') {
    if (env.LOCALAPPDATA) roots.push({ root: path.join(env.LOCALAPPDATA, 'Spotify'), prefs: path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Spotify', 'prefs') });
  } else if (platform === 'darwin') {
    const prefs = path.join(home, 'Library', 'Application Support', 'Spotify', 'prefs');
    roots.push({ root: path.join(home, 'Library', 'Caches', 'com.spotify.client'), prefs }, { root: path.join(home, 'Library', 'Application Support', 'Spotify', 'PersistentCache'), prefs }, { root: path.join(home, 'Library', 'Application Support', 'Spotify'), prefs });
  }
  return roots.flatMap(({ root, prefs }) => ['Browser', 'Default', ''].map(profile => ({ directory: path.join(root, profile, 'Local Storage', 'leveldb'), prefs, installation: 'spotify-desktop' })));
}
async function selectCurrentProfiles(candidates) {
  const selected = new Map();
  for (const candidate of candidates) {
    const names = (await fs.readdir(candidate.directory)).filter(name => /\.(ldb|log)$/.test(name) || name === 'CURRENT');
    const times = await Promise.all(names.map(name => fs.stat(path.join(candidate.directory, name)).then(s => s.mtimeMs, () => 0)));
    const activity = Math.max(0, ...times), group = candidate.installation || candidate.directory;
    if (!selected.has(group) || activity > selected.get(group).activity) selected.set(group, { ...candidate, activity });
  }
  return [...selected.values()];
}
async function discover() {
  const candidates = locations();
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const packages = path.join(process.env.LOCALAPPDATA, 'Packages');
    for (const name of await fs.readdir(packages).catch(() => [])) {
      if (!/^SpotifyAB\.SpotifyMusic_[\w]+$/.test(name)) continue;
      const cache = path.join(packages, name, 'LocalCache');
      for (const root of [path.join(cache, 'Spotify'), path.join(cache, 'Local', 'Spotify')]) {
        for (const profile of ['Browser', 'Default', '']) candidates.push({ directory: path.join(root, profile, 'Local Storage', 'leveldb'), prefs: path.join(cache, 'Roaming', 'Spotify', 'prefs'), installation: `store:${name}` });
      }
    }
  }
  const existing = [], seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.directory)) continue; seen.add(candidate.directory);
    try {
      await fs.access(path.join(candidate.directory, 'CURRENT'));
      const stat = await fs.lstat(candidate.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      existing.push({ ...candidate, username: await readUsername(candidate.prefs) });
    } catch { /* Missing or unavailable installs are not created. */ }
  }
  return selectCurrentProfiles(existing);
}
async function isSpotifyRunning() {
  if (process.platform === 'win32') {
    const { stdout } = await run('tasklist.exe', ['/FI', 'IMAGENAME eq Spotify.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 10000 });
    return /^"Spotify\.exe"/im.test(stdout);
  }
  if (process.platform === 'darwin') {
    try { await run('/usr/bin/pgrep', ['-x', 'Spotify'], { timeout: 5000 }); return true; }
    catch (error) { if (error.code === 1) return false; throw error; }
  }
  throw new Error('Classic Lyrics supports Windows and macOS.');
}
async function stopSpotify() {
  if (process.platform === 'win32') await run('taskkill.exe', ['/IM', 'Spotify.exe', '/T', '/F'], { windowsHide: true, timeout: 10000 });
  else await run('/usr/bin/killall', ['Spotify'], { timeout: 10000 });
  for (let i = 0; i < 40; i++) { if (!(await isSpotifyRunning())) return; await new Promise(resolve => setTimeout(resolve, 250)); }
  throw new Error('Spotify is still running. Quit it completely and retry.');
}
async function openSpotify(shell) {
  if (process.platform === 'darwin') { await run('/usr/bin/open', ['-a', 'Spotify'], { timeout: 10000 }); return; }
  const executable = path.join(process.env.APPDATA || '', 'Spotify', 'Spotify.exe');
  try {
    await fs.access(executable); const child = spawn(executable, [], { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', () => {}); child.unref();
  } catch { await shell.openExternal('spotify:'); }
}
module.exports = { locations, selectCurrentProfiles, discover, isSpotifyRunning, stopSpotify, openSpotify };
