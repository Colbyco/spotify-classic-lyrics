'use strict';
async function watchOnce({ enabled, inspect, repair }) {
  const status = await inspect();
  if (enabled && status.kind === 'needs-fix' && status.running === false) return repair();
  return status;
}
async function runAtStartup({ enabled, background, inspect, repair, openWindow, quit }) {
  if (!background || !enabled) openWindow();
  const status = await watchOnce({ enabled, inspect, repair });
  if (background && enabled) quit();
  return status;
}
module.exports = { watchOnce, runAtStartup };
