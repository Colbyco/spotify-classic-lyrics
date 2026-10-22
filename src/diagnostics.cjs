'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const platform = require('./platform.cjs');
const storage = require('./storage.cjs');

function errorCategory(error) {
  const text = `${error?.message || ''} ${error?.cause?.message || ''}`;
  if (error?.code === 'LEVEL_LOCKED' || /lockfile|lock.*held|using its settings|database.*lock/i.test(text)) return 'locked';
  if (['EACCES', 'EPERM'].includes(error?.code)) return 'access-denied';
  if (/format|metadata|not an object|storage string|JSON|preference.*large/i.test(text)) return 'storage-format';
  if (/no signed-in|no.*profile|no.*settings found/i.test(text)) return 'profile-not-found';
  if (/restarted before/i.test(text)) return 'spotify-restarted';
  return 'other';
}
function numericVersion(value) {
  return typeof value === 'string' ? value.match(/^(\d{1,5}(?:\.\d{1,6}){1,4})(?:\.g[a-z0-9]+)?$/i)?.[1] || null : null;
}
async function collect({ appVersion, automaticRepair, lastFix, lastError }, dependencies = {}) {
  const p = dependencies.platform || platform, s = dependencies.storage || storage;
  const candidates = await p.discover().catch(() => []);
  const statuses = [], readErrors = new Set();
  for (const candidate of candidates) {
    try { statuses.push(await s.inspectSnapshot(candidate)); }
    catch (error) { readErrors.add(errorCategory(error)); }
  }
  const spotifyRunning = await p.isSpotifyRunning().catch(() => null);
  let spotifyVersion = null;
  const prefs = [...new Set([...candidates, ...p.locations()].map(c => c.prefs).filter(Boolean))];
  for (const file of prefs) {
    try {
      const text = await fs.readFile(file, 'utf8');
      const match = text.match(/^app\.last-launched-version="([^"]+)"/m);
      if (match && (spotifyVersion = numericVersion(match[1]))) break;
    } catch { /* Version is optional. Never attach the preferences file. */ }
  }
  const kinds = new Set(candidates.map(c => c.installation?.startsWith('store:') ? 'store' : 'desktop'));
  const usable = statuses.filter(s => s.profiles > 0);
  const report = {
    schema: 1, appVersion: numericVersion(appVersion), platform: process.platform,
    osVersion: numericVersion(os.release()), architecture: process.arch, spotifyVersion,
    installation: kinds.size > 1 ? 'mixed' : [...kinds][0] || 'not-found', spotifyRunning,
    storageState: !candidates.length ? 'not-found' : readErrors.size ? 'unreadable' : !usable.length ? 'no-profile' : usable.every(s => s.fixed) ? 'fixed' : 'needs-fix',
    flagValues: [...new Set(usable.flatMap(s => s.values).map(v => v === null || v === undefined ? 'MISSING' : ['CONTROL', 'PERSISTENT_UNLIMITED', 'ALWAYS_VISIBLE'].includes(v) ? v : 'OTHER'))],
    readErrors: [...readErrors], lastFix, lastError, automaticRepair: automaticRepair === true, issue: 'lyrics-still-fullscreen'
  };
  const { validateReport } = await import('./report-schema.mjs');
  return validateReport(report);
}
module.exports = { collect, errorCategory, numericVersion };
