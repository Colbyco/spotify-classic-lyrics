'use strict';
const MODES = ['system', 'dark', 'light'];
function normalizeSettings(value) {
  return { autoRepair: value?.autoRepair === true, appearance: MODES.includes(value?.appearance) ? value.appearance : 'system' };
}
function windowBackground(dark) { return dark ? '#1c1a21' : '#faf8fc'; }
async function saveAppearance(mode, { settings, persist, nativeTheme }) {
  if (!MODES.includes(mode)) throw new Error('Choose System, Dark, or Light.');
  await persist({ ...settings, appearance: mode });
  settings.appearance = mode;
  nativeTheme.themeSource = mode;
}
module.exports = { normalizeSettings, windowBackground, saveAppearance };
