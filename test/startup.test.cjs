'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runAtStartup } = require('../src/watcher.cjs');

test('sign-in startup checks once, finishes an allowed repair, then exits without opening a window', async () => {
  const events = [];
  const result = await runAtStartup({ enabled: true, background: true,
    inspect: async () => { events.push('inspect'); return { kind: 'needs-fix', running: false }; },
    repair: async () => { await Promise.resolve(); events.push('repair-complete'); return { kind: 'fixed' }; },
    openWindow: () => events.push('window'), quit: () => events.push('quit') });
  assert.equal(result.kind, 'fixed');
  assert.deepEqual(events, ['inspect', 'repair-complete', 'quit']);
});

test('startup with Spotify open or its running state unknown exits without attempting a repair', async () => {
  for (const running of [true, null]) {
    const events = [];
    await runAtStartup({ enabled: true, background: true,
      inspect: async () => { events.push('inspect'); return { kind: 'needs-fix', running }; },
      repair: async () => events.push('repair'), openWindow: () => events.push('window'), quit: () => events.push('quit') });
    assert.deepEqual(events, ['inspect', 'quit']);
  }
});

test('manual launch with automatic repair off opens the controls, checks once, and leaves Spotify unchanged', async () => {
  const events = [];
  await runAtStartup({ enabled: false, background: false,
    inspect: async () => { events.push('inspect'); return { kind: 'needs-fix', running: false }; },
    repair: async () => events.push('repair'), openWindow: () => events.push('window'), quit: () => events.push('quit') });
  assert.deepEqual(events, ['window', 'inspect']);
});
