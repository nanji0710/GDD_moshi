#!/usr/bin/env node
/**
 * 部署目录装配（唯一实现）：把 prototype/ 里「运行时白名单」的文件复制到 _site/，
 * 并写入 version.json（commit / branch / builtAt / 文件数 / 字节数）。
 *
 * 为什么要有它：
 *   - 之前 CI 直接 `wrangler pages deploy prototype`，会把已跟踪的 prototype/tools/*
 *     （smoke/shoot/perf/probe/export 脚本，以及 11.7MB 的 shots-ux 截图）一起发到线上；
 *     本地 tools/deploy-cloudflare.ps1 却自己写了一份「tools/* 不进站点」的过滤 —— 两份实现必然漂移。
 *   - 现在两个 GitHub workflow 与本地脚本都只调本文件，白名单只在这里定义一次。
 *
 * 用法：
 *   node tools/stage-site.mjs [--out <dir>] [--commit <sha>] [--branch <name>] [--quiet]
 *   环境变量兜底：GITHUB_SHA / GITHUB_REF_NAME
 *
 * 退出码：0 = 装配完成且审计通过；1 = 参数/目录/白名单审计失败。
 */
import { mkdir, rm, readdir, copyFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'prototype');

/** 站点根允许出现的条目：只认这些，其余一律不发。 */
const ALLOW_TOP = new Set(['index.html', '404.html', '_headers', '_redirects', 'css', 'js', 'assets']);
/** assets/ 里只发运行时模型数据；.glb 源资产留在 models/glb/，不进部署目录（#4 单一来源）。 */
const SKIP_ASSET = /\.(glb|gltf|bin)$/i;
/** 审计：部署目录里出现这些就说明白名单漏了。 */
const FORBIDDEN = /(^|\/)(tools|shots[^/]*)(\/|$)|\.(png|jpe?g|webp|gif|log|map|mjs|cjs)$/i;

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

async function walk(dir, rel = '', out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) await walk(path.join(dir, e.name), r, out);
    else out.push(r);
  }
  return out;
}

const staged = [];
const skipped = [];

for (const top of ALLOW_TOP) {
  const src = path.join(SRC, top);
  let info;
  try {
    info = await stat(src);
  } catch {
    continue; // 该条目不存在（如 _headers / 404.html）就跳过
  }
  const files = info.isDirectory() ? await walk(src) : [''];
  for (const f of files) {
    const rel = f ? `${top}/${f}` : top;
    if (rel.startsWith('assets/') && SKIP_ASSET.test(rel)) {
      skipped.push(rel);
      continue;
    }
    staged.push({ rel, from: path.join(src, f) });
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

let bytes = 0;
for (const f of staged.sort((a, b) => a.rel.localeCompare(b.rel))) {
  const dest = path.join(OUT, f.rel.replace(/\//g, path.sep));
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(f.from, dest);
  f.size = (await stat(dest)).size;
  bytes += f.size;
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
const audit = await walk(OUT);
const bad = audit.filter((f) => FORBIDDEN.test(f.replace(/\\/g, '/')));
if (bad.length) {
  console.error('[stage-site] 白名单审计失败，以下文件不应进入部署目录：\n  ' + bad.join('\n  '));
  process.exit(1);
}
const total = bytes + Buffer.byteLength(JSON.stringify(version) + '\n');

if (!QUIET) {
  console.log('== 部署目录装配 ==');
  console.log(`  源：${SRC}`);
  console.log(`  出：${OUT}`);
  for (const f of staged) console.log(`  ${f.rel.padEnd(34)} ${String(f.size).padStart(9)} B`);
  console.log(`  version.json                       ${String(total - bytes).padStart(9)} B  ${JSON.stringify(version)}`);
  console.log(`  合计 ${audit.length} 个文件 / ${total} B（${(total / 1024).toFixed(1)} KiB）`);
  if (skipped.length) console.log(`  跳过资产（不进部署）：${skipped.join(', ')}`);
  console.log('  白名单审计：无 tools/ · 无 screenshots · 无日志 ✓');
}
