'use strict';
const $ = id => document.getElementById(id);
let pending = false;
function render(state) {
  const titles = { fixed: 'Classic layout is active', 'needs-fix': 'Ready to restore the classic layout', 'not-found': 'Spotify settings not found', unavailable: 'Spotify settings are unavailable', checking: 'Checking Spotify…', working: 'Applying your preference…', error: 'Something needs attention' };
  $('title').textContent = titles[state.kind] || 'Classic Lyrics';
  $('message').textContent = state.message;
  $('dot').className = state.kind;
  $('auto').checked = state.autoRepair;
  $('fix').textContent = state.kind === 'fixed' ? 'Classic layout is active ✓' : 'Restore classic lyrics';
  $('fix').disabled = pending || state.kind !== 'needs-fix';
  $('undo').disabled = pending || !state.canUndo;
  $('check').disabled = pending || state.kind === 'working';
  $('auto').disabled = pending || state.kind === 'working';
}
async function act(command, value) {
  if (pending) return;
  pending = true; $('error').hidden = true;
  try { const result = await window.classicLyrics.command(command, value); if (result) render(result); }
  catch (error) { $('error').textContent = error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); $('error').hidden = false; }
  finally { pending = false; render(await window.classicLyrics.command('status')); }
}
for (const id of ['fix', 'undo', 'check', 'spotify', 'source', 'quit']) $(id).addEventListener('click', () => act(id));
$('auto').addEventListener('change', event => act('auto', event.target.checked));
window.classicLyrics.onStatus(render);
window.classicLyrics.command('status').then(render);
