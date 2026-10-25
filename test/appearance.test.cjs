'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSettings, saveAppearance } = require('../src/appearance.cjs');

test('existing startup preferences survive appearance migration and System is the default', () => {
  assert.deepEqual(normalizeSettings({ autoRepair: true }), { autoRepair: true, appearance: 'system' });
  assert.deepEqual(normalizeSettings({ autoRepair: true, appearance: 'dark' }), { autoRepair: true, appearance: 'dark' });
  assert.equal(normalizeSettings({ appearance: 'invalid' }).appearance, 'system');
  assert.equal(normalizeSettings(null).appearance, 'system');
});

test('appearance saves preserve startup settings and failed saves do not change the current theme', async () => {
  const settings = normalizeSettings({ autoRepair: true });
  const nativeTheme = { themeSource: 'system' }; let saved;
  await saveAppearance('dark', { settings, nativeTheme, persist: async value => { saved = structuredClone(value); } });
  assert.deepEqual(saved, { autoRepair: true, appearance: 'dark' });
  assert.deepEqual(normalizeSettings(saved), settings);
  assert.equal(nativeTheme.themeSource, 'dark');
  await assert.rejects(saveAppearance('light', { settings, nativeTheme, persist: async () => { throw new Error('Disk unavailable'); } }), /Disk unavailable/);
  assert.equal(settings.appearance, 'dark'); assert.equal(nativeTheme.themeSource, 'dark');
  await assert.rejects(saveAppearance('invalid', { settings, nativeTheme, persist: async () => assert.fail('Must reject before saving') }), /Choose/);
});
