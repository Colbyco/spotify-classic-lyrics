export const ISSUES = ['lyrics-still-fullscreen', 'fix-failed', 'automatic-repair-failed', 'other'];
export const ERRORS = ['none', 'locked', 'access-denied', 'storage-format', 'profile-not-found', 'spotify-restarted', 'other'];
const fields = ['schema', 'appVersion', 'platform', 'osVersion', 'architecture', 'spotifyVersion', 'installation', 'spotifyRunning', 'storageState', 'flagValues', 'readErrors', 'lastFix', 'lastError', 'automaticRepair', 'issue'];
const version = value => typeof value === 'string' && /^\d{1,5}(\.\d{1,6}){1,4}$/.test(value);
const oneOf = (value, values) => values.includes(value);

// A closed schema, shared by the app and receiver. No paths, names, raw errors,
// free text, arbitrary flag values, or additional properties can be uploaded.
export function validateReport(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).length !== fields.length || fields.some(k => !Object.hasOwn(r, k))) throw new Error('Invalid report fields.');
  if (r.schema !== 1 || !version(r.appVersion) || !oneOf(r.platform, ['win32', 'darwin']) || !version(r.osVersion) || !oneOf(r.architecture, ['x64', 'arm64']) || !(r.spotifyVersion === null || version(r.spotifyVersion)) ||
      !oneOf(r.installation, ['desktop', 'store', 'mixed', 'not-found']) || ![true, false, null].includes(r.spotifyRunning) ||
      !oneOf(r.storageState, ['fixed', 'needs-fix', 'no-profile', 'unreadable', 'not-found']) ||
      !Array.isArray(r.flagValues) || r.flagValues.length > 5 || r.flagValues.some(v => !oneOf(v, ['CONTROL', 'PERSISTENT_UNLIMITED', 'ALWAYS_VISIBLE', 'OTHER', 'MISSING'])) ||
      !Array.isArray(r.readErrors) || r.readErrors.length > ERRORS.length || r.readErrors.some(v => !ERRORS.includes(v)) ||
      !oneOf(r.lastFix, ['not-attempted', 'saved', 'failed', 'cancelled']) || !ERRORS.includes(r.lastError) ||
      typeof r.automaticRepair !== 'boolean' || !ISSUES.includes(r.issue)) throw new Error('Invalid report value.');
  return r;
}

export function analyze(r) {
  validateReport(r);
  const findings = [];
  const add = (code, text) => findings.push({ code, text });
  if (r.lastError === 'locked' || r.readErrors.includes('locked')) add('database-locked', 'Spotify was still using its settings. Quit Spotify completely, then try the fix again.');
  if (r.lastError === 'access-denied' || r.readErrors.includes('access-denied')) add('access-denied', 'The settings could not be accessed. Try running the tool from your own Windows or macOS account.');
  if (r.lastError === 'storage-format' || r.readErrors.includes('storage-format')) add('storage-format-changed', 'The settings format was not recognized. This Spotify version may need a tool update.');
  if (r.lastError === 'spotify-restarted') add('spotify-restarted', 'Spotify reopened before the setting could be saved. Quit it completely and retry.');
  if (r.storageState === 'not-found' || r.storageState === 'no-profile') add('profile-not-found', 'No usable signed-in profile was found. Open Spotify, sign in, play a song, then check again.');
  if (r.storageState === 'unreadable' && !findings.length) add('settings-unreadable', 'The Spotify settings could not be read. Quit Spotify and check again.');
  if (r.storageState === 'needs-fix') add(r.lastFix === 'saved' ? 'preference-reset' : 'preference-not-saved', r.lastFix === 'saved' ? 'The setting has reset since the last successful fix.' : 'The classic layout setting is not saved yet.');
  if (r.storageState === 'fixed') add('preference-saved', 'The setting is saved. If lyrics still cover the window after restarting Spotify, this Spotify version may no longer use it.');
  if (r.issue === 'automatic-repair-failed' && !r.automaticRepair) add('automatic-repair-off', 'Automatic repair is turned off.');
  if (r.issue === 'automatic-repair-failed' && r.automaticRepair && r.spotifyRunning) add('waiting-for-spotify-exit', 'Automatic repair waits until Spotify fully closes. Closing its window may leave it running.');
  if (!findings.length) add('more-investigation-needed', 'The checks did not identify the cause. A report can help investigate this version.');
  return findings;
}
