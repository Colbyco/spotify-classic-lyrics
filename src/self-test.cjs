'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ClassicLevel } = require('classic-level');
const s = require('./storage.cjs');
async function run(report) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-lyrics-smoke-'));
  try {
    const directory = path.join(root, 'leveldb'), backup = path.join(root, 'backup.json');
    const key = Buffer.concat([s.PREFIX, s.encodeString('test:remote-config-overrides', 1)]);
    const value = s.encodeString(JSON.stringify({ [s.FLAG]: 'ALWAYS_VISIBLE', keep: true }), 1);
    const db = new ClassicLevel(directory, { keyEncoding: 'buffer', valueEncoding: 'buffer' }); await db.open();
    await db.batch([{ type: 'put', key, value }, { type: 'put', key: Buffer.from(`META:${s.ORIGIN}`), value: Buffer.concat([Buffer.from([8, 1, 16]), s.varint(key.length - s.PREFIX.length + value.length)]) }]); await db.close();
    const candidate = { directory };
    await s.change(candidate, backup); assert.equal((await s.inspectSnapshot(candidate)).fixed, true);
    await s.change(candidate, backup, true); assert.equal((await s.inspectSnapshot(candidate)).values[0], 'ALWAYS_VISIBLE');
    const result = JSON.stringify({ passed: true, platform: process.platform, arch: process.arch, checks: ['packaged native LevelDB', 'repair', 'snapshot inspection', 'undo'] });
    if (report) await fs.writeFile(report, result); console.log(result);
  } finally {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('classic-lyrics-smoke-')) throw new Error('Invalid test cleanup path');
    await fs.rm(root, { recursive: true, force: true });
  }
}
module.exports = { run };
