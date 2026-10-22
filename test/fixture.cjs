'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ClassicLevel } = require('classic-level');
const { FLAG, ORIGIN, PREFIX, encodeString, varint } = require('../src/storage.cjs');
const username = 'synthetic-test-profile';
const key = name => Buffer.concat([PREFIX, encodeString(`${username}:${name}`, 1)]);
const overrideKey = key('remote-config-overrides');
const metaKey = Buffer.from(`META:${ORIGIN}`);
async function fixture({ missing = false, utf16 = false, corrupt = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-lyrics-test-'));
  const directory = path.join(root, 'leveldb'), backup = path.join(root, 'backup.json');
  const db = new ClassicLevel(directory, { keyEncoding: 'buffer', valueEncoding: 'buffer' }); await db.open();
  const entries = [{ key: key('canvasVideosEnabled'), value: encodeString('true', 1) }];
  if (!missing) entries.push({ key: overrideKey, value: encodeString(JSON.stringify(corrupt ? [] : { [FLAG]: 'PERSISTENT_UNLIMITED', unrelated: 'keep me', unicode: '音楽' }), utf16 ? 0 : 1) });
  const size = entries.reduce((sum, r) => sum + r.key.length - PREFIX.length + r.value.length, 0);
  await db.batch([...entries.map(r => ({ type: 'put', ...r })), { type: 'put', key: metaKey, value: Buffer.concat([Buffer.from([8]), varint(12345), Buffer.from([16]), varint(size)]) }]); await db.close();
  return { root, directory, backup, candidate: { directory, username }, cleanup: async () => {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('classic-lyrics-test-')) throw new Error('Invalid test directory');
    await fs.rm(root, { recursive: true, force: true });
  } };
}
async function open(directory) { const db = new ClassicLevel(directory, { keyEncoding: 'buffer', valueEncoding: 'buffer', createIfMissing: false }); await db.open(); return db; }
module.exports = { fixture, open, key, overrideKey, metaKey, username };
