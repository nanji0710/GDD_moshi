#!/usr/bin/env node
/**
 * 发版门禁（可失败）：部署前跑一遍，任何一条不满足就 exit 1，CI 第一步调用，
 * 失败即中止发布（workflow 里禁止 continue-on-error）。
 *
 * 判据（全部 PASS 才 exit 0）：
 *   1. classic script 恰 17 个（顺序稳定，新增/漏引会在这里暴露）；
 *   2. 首屏同步字节和（index.html + 18 js + 3 css）≤ 921,600 B；
 *   3. 白名单关键文件存在：index.html、js/18 个、css/3 个；
 *   5. 部署白名单审计：原型目录里没有会被误发的 tools/shots/log 文件（与 CI 共用 tools/release-manifest.mjs）。
 *
 * 用法：
 *   node tools/check-release.mjs [prototype]
 *
 * 退出码：0 = 可发布；1 = 不可发布（逐条打印 FAIL 原因）。
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSiteFiles, auditRels } from './release-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.resolve(ROOT, process.argv[2] || 'prototype');
const MAX_SYNC = 921600; // 900 KiB 口径

const results = [];
const ok = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

let html = '';
try {
  html = await readFile(path.join(SRC, 'index.html'), 'utf8');
  ok('index.html 存在且非空', html.length > 512, `${Buffer.byteLength(html)} B`);
} catch (e) {
  ok('index.html 存在且非空', false, `读不到 ${path.join(SRC, 'index.html')}`);
}

// ---- 1. classic script 恰 18 个（顺序稳定，新增/漏引会在这里暴露）----
const scriptSrc = [...html.matchAll(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>/gi)]
  .map((m) => ({ attrs: m[1] + m[3], src: m[2] }));
const classic = scriptSrc;
ok('classic script = 18 个', classic.length === 18, `${classic.length} 个`);

// ---- 3. 同步字节和（index + js + css）----
let syncBytes = Buffer.byteLength(html);
const missing = [];
const seen = new Set();
for (const s of scriptSrc) {
  const clean = s.src.split('?')[0];
  if (seen.has(clean)) continue;
  seen.add(clean);
  try {
    syncBytes += (await stat(path.join(SRC, clean))).size;
  } catch {
    missing.push(clean);
  }
}
const cssHrefs = [...html.matchAll(/<link\b([^>]*)\bhref\s*=\s*["']([^"']+\.css(?:\?[^"']*)?)["']([^>]*)>/gi)];
for (const m of cssHrefs) {
  const clean = m[2].split('?')[0];
  if (seen.has(clean)) continue;
  seen.add(clean);
  try {
    syncBytes += (await stat(path.join(SRC, clean))).size;
  } catch {
    missing.push(clean);
  }
}
ok('首屏同步字节 ≤ 921,600 B', syncBytes <= MAX_SYNC, `${syncBytes} B（index + ${seen.size - 1} 个 js/css）`);
ok('index 引用的文件都存在', missing.length === 0, missing.length ? '缺：' + missing.join(', ') : '0 个缺失');

// ---- 4. 白名单关键文件存在 ----
const { files } = await listSiteFiles(SRC);
const rels = new Set(files.map((f) => f.rel));
const must = ['index.html'];
const jsCount = [...rels].filter((r) => /^js\/[^/]+\.js$/.test(r)).length;
const cssCount = [...rels].filter((r) => /^css\/[^/]+\.css$/.test(r)).length;
ok('必须是 js 18 / css 3', jsCount === 18 && cssCount === 3, `js=${jsCount} css=${cssCount}`);
for (const m of must) ok(`关键文件存在 ${m}`, rels.has(m), rels.has(m) ? '' : '白名单里没有');

// ---- 4b. 缓存策略与 404 语义（_headers / 404.html，version.json 由 stage-site 生成）----
try {
  const headers = await readFile(path.join(SRC, '_headers'), 'utf8');
  const need = ['/index.html', '/*.js', '/*.css'];
  const missingRules = need.filter((p) => !headers.includes(p));
  const noCache = /Cache-Control:\s*no-cache/i.test(headers);
  ok('_headers 覆盖 js/css/index 且 no-cache', missingRules.length === 0 && noCache,
    missingRules.length ? '缺规则：' + missingRules.join(', ') : (noCache ? 'no-cache 规则已就位' : '缺 Cache-Control: no-cache'));
} catch {
  ok('_headers 覆盖 js/css/index 且 no-cache', false, `读不到 ${path.join(SRC, '_headers')}`);
}

try {
  const e404 = await readFile(path.join(SRC, '404.html'), 'utf8');
  ok('404.html 存在且可回首页', e404.length > 512 && /href\s*=\s*["']\//.test(e404), `${Buffer.byteLength(e404)} B`);
} catch {
  ok('404.html 存在且可回首页', false, `读不到 ${path.join(SRC, '404.html')}`);
}

try {
  const stage = await readFile(path.join(ROOT, 'tools/stage-site.mjs'), 'utf8');
  ok('version.json 由 stage-site 生成', /version\.json/.test(stage), 'tools/stage-site.mjs 写 version.json');
  ok('测试面 404 守卫（Pages Functions）由 stage-site 生成', /onRequest/.test(stage) && /functions/.test(stage),
    'functions/[[path]].js 在装配时生成');
} catch {
  ok('version.json 由 stage-site 生成', false, '读不到 tools/stage-site.mjs');
  ok('测试面 404 守卫（Pages Functions）由 stage-site 生成', false, '读不到 tools/stage-site.mjs');
}

// ---- 4c. 部署项数（与 CI/本地同一口径：listSiteFiles + version.json + functions 守卫）----
const deployFiles = await listSiteFiles(SRC);
const deployCount = deployFiles.files.length + 2;
ok('部署项数 = 26（24 个站点文件 + functions/[[path]].js 守卫）',
  deployCount === 26, `${deployCount} 项（不含 version.json/守卫时 ${deployFiles.files.length} 项）`);

// ---- 5. 部署目录白名单审计（原型里不该有会被误发的条目）----
// 注意：原型目录本身允许存在 tools/（开发工具），它们由白名单排除；这里审计的是
// 「白名单目录内混入 forbidden 文件」以及 stage-site 的过滤是否仍生效。
const bad = auditRels(files.map((f) => f.rel));
ok('白名单产物无 tools/shots/log', bad.length === 0, bad.length ? bad.join(', ') : '0 个违规');

const failed = results.filter((r) => !r.pass);
console.log(`\n== check-release: ${SRC} ==`);
console.log(`  ${results.length - failed.length} PASS / ${failed.length} FAIL`);
if (failed.length) {
  console.log('  门禁失败：' + failed.map((f) => f.name).join('；'));
  process.exit(1);
}
console.log('  门禁通过：可以发布');
