'use strict';
async function watchOnce({ enabled, inspect, repair }) {
  const status = await inspect();
  if (enabled && status.kind === 'needs-fix' && status.running === false) return repair();
  return status;
}
module.exports = { watchOnce };
