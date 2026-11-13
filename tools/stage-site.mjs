#!/usr/bin/env node
/**
 * 部署目录装配（唯一实现）：把 prototype/ 里「运行时白名单」的文件复制到 _site/
 * 并写入 version.json（commit / branch / builtAt / 文件数 / 字节数）。
 *
 * 为什么要有它：
 *   - 之前 CI 直接 `wrangler pages deploy prototype`，会把已跟踪的 prototype/tools/*
 *     （smoke/shoot/perf/probe/export 脚本，以及 11.7MB 的 shots-ux 截图）一起发到线上；
 *     本地 tools/deploy-cloudflare.ps1 却自己写了一份「tools/* 不进站点」的过滤 ——
 *     两份实现必然漂移。
 *   - 现在两个 GitHub workflow 与本地脚本都只调本文件，白名单只在
 *     tools/release-manifest.mjs 定义一次。
 *
 * 用法：
 *   node tools/stage-site.mjs [--out <dir>] [--commit <sha>] [--branch <name>] [--quiet]
 *   环境变量兜底：GITHUB_SHA / GITHUB_REF_NAME
 *
 * 退出码：0 = 装配完成且审计通过；1 = 参数/目录/白名单审计失败。
 */
import { mkdir, rm, copyFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSiteFiles, auditRels } from './release-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'prototype');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf('--' + name);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : fallback;
};
const OUT = path.resolve(ROOT, arg('out', '_site'));
const COMMIT = arg('commit', process.env.GITHUB_SHA || '');
const BRANCH = arg('branch', process.env.GITHUB_REF_NAME || '');
const QUIET = args.includes('--quiet');

if (OUT === ROOT || OUT === SRC || SRC.startsWith(OUT + path.sep)) {
  console.error(`[stage-site] 拒绝装配到 ${OUT}：不能是仓库根、prototype/ 或它的父目录`);
  process.exit(1);
}

const { files, skipped } = await listSiteFiles(SRC);
if (!files.length) {
  console.error(`[stage-site] ${SRC} 里没有白名单文件，拒绝生成空站点`);
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const staged = [];
let bytes = 0;
for (const f of files) {
  const dest = path.join(OUT, f.rel.replace(/\//g, path.sep));
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(f.from, dest);
  const size = (await stat(dest)).size;
  staged.push({ rel: f.rel, size });
  bytes += size;
}

const version = {
  commit: COMMIT || 'unknown',
  branch: BRANCH || 'unknown',
  builtAt: new Date().toISOString(),
  files: staged.length + 1,
  bytes: bytes,
};
await writeFile(path.join(OUT, 'version.json'), JSON.stringify(version) + '\n', 'utf8');

// ---- 审计：部署目录里不允许出现工具、截图、日志 ----
const { files: outFiles } = await listSiteFiles(OUT);
const bad = auditRels(outFiles.map((f) => f.rel));
if (bad.length) {
  console.error('[stage-site] 白名单审计失败，以下文件不应进入部署目录：\n  ' + bad.join('\n  '));
  process.exit(1);
}
const versionBytes = Buffer.byteLength(JSON.stringify(version) + '\n');
const total = bytes + versionBytes;

if (!QUIET) {
  console.log('== 部署目录装配 ==');
  console.log(`  源：${SRC}`);
  console.log(`  出：${OUT}`);
  for (const f of staged) console.log(`  ${f.rel.padEnd(34)} ${String(f.size).padStart(9)} B`);
  console.log(`  version.json                       ${String(versionBytes).padStart(9)} B  ${JSON.stringify(version)}`);
  console.log(`  合计 ${outFiles.length + 1} 个文件 / ${total} B（${(total / 1024).toFixed(1)} KiB）`);
  if (skipped.length) console.log(`  跳过资产（不进部署）：${skipped.join(', ')}`);
  console.log('  白名单审计：无 tools/ · 无 screenshots · 无日志 ✓');
}
