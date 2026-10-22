'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { ClassicLevel } = require('classic-level');

const FLAG = 'enableLyricsVariationsInNPV';
const TARGET = 'CONTROL';
const ORIGIN = 'https://xpui.app.spotify.com';
const SUFFIX = 'remote-config-overrides';
const PREFIX = Buffer.from(`_${ORIGIN}\0`);

function decodeString(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1) throw new Error('Empty storage string.');
  if (buffer[0] === 1) return buffer.subarray(1).toString('latin1');
  if (buffer[0] === 0 && buffer.length % 2 === 1) return buffer.subarray(1).toString('utf16le');
  throw new Error('Spotify uses an unrecognized storage format. No changes were made.');
}
function encodeString(text, encoding) {
  const latin = encoding !== 0 && [...text].every(c => c.charCodeAt(0) <= 255);
  return Buffer.concat([Buffer.from([latin ? 1 : 0]), Buffer.from(text, latin ? 'latin1' : 'utf16le')]);
}
function localName(key) {
  if (!key.subarray(0, PREFIX.length).equals(PREFIX)) return null;
  return decodeString(key.subarray(PREFIX.length));
}
function parseObject(value) {
  if (value.length > 4 * 1024 * 1024) throw new Error('Spotify preference is unexpectedly large.');
  const parsed = JSON.parse(decodeString(value));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Spotify preference is not an object.');
  return parsed;
}

// Preserve unknown protobuf fields in Chromium's origin metadata.
function readVarint(buffer, offset) {
  let value = 0n;
  for (let n = 0; n < 10 && offset < buffer.length; n++) {
    const b = buffer[offset++]; value |= BigInt(b & 127) << BigInt(n * 7);
    if (!(b & 128)) return { value, offset };
  }
  throw new Error('Invalid storage metadata. No changes were made.');
}
function varint(value) {
  value = BigInt(value); const bytes = [];
  do { let b = Number(value & 127n); value >>= 7n; bytes.push(value ? b | 128 : b); } while (value);
  return Buffer.from(bytes);
}
function updateMetadata(buffer, size) {
  const pieces = []; let offset = 0, found = false;
  while (offset < buffer.length) {
    const start = offset; const tag = readVarint(buffer, offset); offset = tag.offset;
    const wire = Number(tag.value & 7n), field = Number(tag.value >> 3n);
    if (wire === 0) {
      const data = readVarint(buffer, offset); offset = data.offset;
      if (field === 2) { pieces.push(Buffer.concat([varint(tag.value), varint(size)])); found = true; continue; }
    } else if (wire === 1) offset += 8;
    else if (wire === 2) { const length = readVarint(buffer, offset); offset = length.offset + Number(length.value); }
    else if (wire === 5) offset += 4;
    else throw new Error('Unknown storage metadata format. No changes were made.');
    if (offset > buffer.length) throw new Error('Incomplete storage metadata.');
    pieces.push(buffer.subarray(start, offset));
  }
  if (!found) throw new Error('Storage size metadata is missing. No changes were made.');
  return Buffer.concat(pieces);
}

async function openDb(directory) {
  const db = new ClassicLevel(directory, { keyEncoding: 'buffer', valueEncoding: 'buffer', createIfMissing: false });
  try { await db.open(); return db; }
  catch (error) {
    if (/lockfile|already held|being used by another process|lock.*already/i.test(`${error.message} ${error.cause?.message || ''}`)) {
      throw Object.assign(new Error('Spotify is using its settings database.', { cause: error }), { code: 'LEVEL_LOCKED' });
    }
    throw error;
  }
}
async function records(db, username) {
  const result = [], all = [];
  for await (const [key, value] of db.iterator({ gte: PREFIX, lt: Buffer.concat([PREFIX, Buffer.from([255])]) })) {
    const name = localName(key); all.push({ key, value, name });
    if (name === SUFFIX || name.endsWith(`:${SUFFIX}`)) {
      result.push({ key, value, object: parseObject(value), existed: true });
    }
  }
  // New stock installs may have no override record yet. Use the logged-in
  // canonical username, and require an existing key in that same namespace.
  if (username && !result.some(r => localName(r.key) === `${username}:${SUFFIX}`)) {
    const sibling = all.find(r => r.name.startsWith(`${username}:`));
    if (sibling) result.push({ key: Buffer.concat([PREFIX, encodeString(`${username}:${SUFFIX}`, sibling.key[PREFIX.length])]), value: null, object: {}, existed: false });
  }
  return { result, all };
}
async function readUsername(prefs) {
  if (!prefs) return null;
  try {
    const text = await fs.readFile(prefs, 'utf8');
    const line = text.split(/\r?\n/).find(l => l.startsWith('autologin.canonical_username='));
    if (!line) return null;
    const username = JSON.parse(line.slice(line.indexOf('=') + 1));
    return typeof username === 'string' && /^[\w.@+-]{1,160}$/.test(username) ? username : null;
  } catch { return null; }
}
async function inspectDirect(candidate) {
  const db = await openDb(candidate.directory);
  try {
    const { result } = await records(db, candidate.username);
    return { directory: candidate.directory, profiles: result.length, fixed: result.length > 0 && result.every(r => r.object[FLAG] === TARGET), values: result.map(r => r.object[FLAG] ?? null) };
  } finally { await db.close(); }
}
async function inspectSnapshot(candidate) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-lyrics-read-'));
  try {
    const copy = path.join(temp, 'leveldb');
    await fs.cp(candidate.directory, copy, { recursive: true, filter: source => !['LOCK', 'LOG', 'LOG.old'].includes(path.basename(source)) });
    const status = await inspectDirect({ ...candidate, directory: copy });
    return { ...status, directory: candidate.directory };
  } finally {
    if (path.dirname(temp) !== os.tmpdir() || !path.basename(temp).startsWith('classic-lyrics-read-')) throw new Error('Invalid temporary directory.');
    await fs.rm(temp, { recursive: true, force: true });
  }
}
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(temp, file);
}

async function change(candidate, backupFile, undo = false) {
  // LevelDB takes an exclusive OS lock. We never bypass Spotify's lock.
  const db = await openDb(candidate.directory);
  try {
    const { result, all } = await records(db, candidate.username);
    if (!result.length) throw new Error('No signed-in Spotify profile found. Open Spotify, sign in, then quit it and retry.');
    const backup = await readJson(backupFile, { version: 1, records: [] });
    if (backup.version !== 1 || !Array.isArray(backup.records)) throw new Error('Unrecognized backup format.');
    const operations = [], planned = new Map(all.map(r => [r.key.toString('hex'), r]));
    let changed = 0;
    for (const record of result) {
      const key64 = record.key.toString('base64');
      let saved = backup.records.find(r => r.directory === candidate.directory && r.key === key64);
      const object = { ...record.object };
      if (undo) {
        if (!saved) continue;
        if (saved.hadFlag) object[FLAG] = saved.previous; else delete object[FLAG];
      } else {
        if (object[FLAG] === TARGET) continue;
        if (!saved) {
          saved = { directory: candidate.directory, key: key64, hadFlag: Object.hasOwn(object, FLAG), previous: object[FLAG] ?? null, existed: record.existed };
          backup.records.push(saved);
        }
        object[FLAG] = TARGET;
      }
      const hex = record.key.toString('hex');
      if (undo && !saved.existed && Object.keys(object).length === 0) {
        operations.push({ type: 'del', key: record.key }); planned.delete(hex);
      } else {
        const value = encodeString(JSON.stringify(object), record.value?.[0] ?? 1);
        if (record.value?.equals(value)) continue;
        operations.push({ type: 'put', key: record.key, value }); planned.set(hex, { key: record.key, value });
      }
      changed++;
    }
    if (!operations.length) {
      if (undo) { backup.records = backup.records.filter(r => r.directory !== candidate.directory); await writeJson(backupFile, backup); }
      return { changed: 0 };
    }
    const metaKey = Buffer.from(`META:${ORIGIN}`), metadata = await db.get(metaKey);
    if (!metadata) throw new Error('Spotify origin metadata is missing. No changes were made.');
    const size = [...planned.values()].reduce((sum, r) => sum + r.key.length - PREFIX.length + r.value.length, 0);
    operations.push({ type: 'put', key: metaKey, value: updateMetadata(metadata, size) });
    // Save the previous flag before committing, never a whole profile or credentials.
    await writeJson(backupFile, backup);
    await db.batch(operations, { sync: true });
    for (const op of operations) {
      const actual = await db.get(op.key);
      if (op.type === 'del' ? actual !== undefined : !actual?.equals(op.value)) throw new Error('Preference verification failed.');
    }
    if (undo) {
      backup.records = backup.records.filter(r => r.directory !== candidate.directory);
      await writeJson(backupFile, backup);
    }
    return { changed };
  } finally { await db.close(); }
}

module.exports = { FLAG, TARGET, ORIGIN, PREFIX, decodeString, encodeString, updateMetadata, readVarint, varint, inspectDirect, inspectSnapshot, readUsername, change, readJson, writeJson };
