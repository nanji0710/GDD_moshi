#!/usr/bin/env node
/**
 * 发布包打包（零依赖、可重复）：把「站点白名单」里的运行时文件打成
 * release/last-train-prototype.zip，并打印 项数 / 字节 / sha256。
 *
 * 白名单不在本文件里：与 tools/stage-site.mjs（CI 上传）、tools/check-release.mjs（门禁）
 * 共用 tools/release-manifest.mjs 的 listSiteFiles()，禁止第二份清单。
 *
 * 可重复的实现要点：
 *   - 条目按路径字典序写；
 *   - ZIP 内时间戳固定为 1980-01-01 00:00（不随检出时间变化）；
 *   - deflate 固定 level 9；同一 Node 版本下同一输入逐字节一致。
 *
 * 用法：
 *   node tools/package-release.mjs [--src prototype] [--out release/last-train-prototype.zip] [--quiet]
 *
 * 退出码：0 = 打包成功；1 = 源目录为空 / 写盘失败。
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSiteFiles } from './release-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf('--' + name);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : fallback;
};
const SRC = path.resolve(ROOT, arg('src', 'prototype'));
const OUT = path.resolve(ROOT, arg('out', 'release/last-train-prototype.zip'));
const QUIET = args.includes('--quiet');

// DOS 时间戳固定：1980-01-01 00:00:00（ZIP 纪元起点），保证重复打包逐字节一致
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const { files } = await listSiteFiles(SRC);
if (!files.length) {
  console.error(`[package-release] ${SRC} 里没有白名单文件，拒绝生成空发布包`);
  process.exit(1);
}

const entries = [];
for (const f of files) {
  const data = await readFile(f.from);
  const name = Buffer.from(f.rel, 'utf8');
  const deflated = deflateRawSync(data, { level: 9 });
  entries.push({ name, data, deflated, crc: crc32(data) });
}

// ---- 写 ZIP（local headers → data → central directory → EOCD）----
const chunks = [];
const central = [];
let offset = 0;
for (const e of entries) {
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);            // version needed
  local.writeUInt16LE(0x0800, 6);        // flags: UTF-8 名称
  local.writeUInt16LE(8, 8);             // method: deflate
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(e.crc, 14);
  local.writeUInt32LE(e.deflated.length, 18);
  local.writeUInt32LE(e.data.length, 22);
  local.writeUInt16LE(e.name.length, 26);
  local.writeUInt16LE(0, 28);
  chunks.push(local, e.name, e.deflated);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);               // version made by
  cd.writeUInt16LE(20, 6);               // version needed
  cd.writeUInt16LE(0x0800, 8);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt16LE(DOS_TIME, 12);
  cd.writeUInt16LE(DOS_DATE, 14);
  cd.writeUInt32LE(e.crc, 16);
  cd.writeUInt32LE(e.deflated.length, 20);
  cd.writeUInt32LE(e.data.length, 24);
  cd.writeUInt16LE(e.name.length, 28);
  cd.writeUInt16LE(0, 30);               // extra len
  cd.writeUInt16LE(0, 32);               // comment len
  cd.writeUInt16LE(0, 34);               // disk
  cd.writeUInt16LE(0, 36);               // internal attrs
  cd.writeUInt32LE(0, 38);               // external attrs
  cd.writeUInt32LE(offset, 42);          // local header offset
  central.push(cd, e.name);

  offset += 30 + e.name.length + e.deflated.length;
}
const centralBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(entries.length, 8);
eocd.writeUInt16LE(entries.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

const zip = Buffer.concat([...chunks, centralBuf, eocd]);
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, zip);

const raw = entries.reduce((n, e) => n + e.data.length, 0);
const sha = createHash('sha256').update(zip).digest('hex');
if (!QUIET) {
  console.log('== 发布包 ==');
  console.log(`  源：${SRC}`);
  console.log(`  出：${OUT}`);
  for (const e of entries) console.log(`  ${e.name.toString('utf8').padEnd(34)} ${String(e.data.length).padStart(9)} B`);
  console.log(`  未压缩 ${raw} B → zip ${zip.length} B（${(zip.length / 1024).toFixed(1)} KiB）`);
}
console.log(JSON.stringify({ items: entries.length, bytes: zip.length, sha256: sha, out: OUT }));
