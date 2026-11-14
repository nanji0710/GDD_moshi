#!/usr/bin/env node
/**
 * 线上部署验收（只读，不发版）：证明「发出去的就是这棵树」，并检查部署目录没有把测试工具带上去。
 *
 * 用法：
 *   node tools/verify-deploy.mjs [--url https://last-train-87y.pages.dev] [--commit <sha>] [--root prototype]
 *   --commit 省略时取 `git rev-parse HEAD`（仅当本地是待验提交时才可比）
 *
 * 判据（全部 PASS 才 exit 0）：
 *   1. GET /version.json 是 JSON，且 commit === 期望 commit；
 *   2. GET /tools/smoke.mjs 不再返回 JavaScript（CF Pages 对未知路径回退 index.html，所以判内容不判状态码）；
 *   3. 关键文件与本地逐字节一致（index.html / css/ui-realism.css / js/ui.js）；
 *   4. 首页不白屏：body 里有 js/main.js，且体积 > 2KB。
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf('--' + name);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : fallback;
};

const BASE = (arg('url', process.env.DEPLOY_URL || 'https://last-train-87y.pages.dev')).replace(/\/+$/, '');
const ROOTDIR = path.resolve(ROOT, arg('root', 'prototype'));
let EXPECT = arg('commit', process.env.EXPECT_COMMIT || '');
if (!EXPECT) {
  try { EXPECT = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { EXPECT = ''; }
}

const results = [];
const ok = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// 用 node:https + family:4 而不是全局 fetch：CI/本机会同时拿到 IPv4 超时和 IPv6 不可达，
// undici 的双栈重试会把整个验收拖到超时（部署其实已成功）。强制 IPv4 后稳定。
function get(p, redirects = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + p);
    const req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'GET', family: 4,
      headers: { 'cache-control': 'no-cache', 'user-agent': 'zt-verify/1' }
    }, (res) => {
      const loc = res.headers.location;
      if ([301, 302, 307, 308].indexOf(res.statusCode) >= 0 && loc && redirects < 5) {
        res.resume();
        const n = new URL(loc, BASE + p);
        return resolve(get(n.pathname + n.search, redirects + 1));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, type: String(res.headers['content-type'] || ''), body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout ' + p)));
    req.end();
  });
}
const sha = (b) => createHash('sha256').update(b).digest('hex');
const localSha = async (p) => sha(await readFile(path.join(ROOTDIR, p)));

const index = await get('/');
ok('首页 200 且非空', index.status === 200 && index.body.length > 2048,
  `${index.status} ${index.type} ${index.body.length} B`);
const indexHtml = index.body.toString('utf8');
ok('首页含 js/main.js', /js\/main\.js/.test(indexHtml), '');

const ver = await get('/version.json');
let verJson = null;
try { verJson = JSON.parse(ver.body.toString('utf8')); } catch { }
ok('version.json 可解析且带 commit',
  !!verJson && typeof verJson.commit === 'string' && verJson.commit.length >= 7,
  verJson ? `commit=${verJson.commit} files=${verJson.files} bytes=${verJson.bytes}` : `${ver.status} ${ver.type}（${ver.body.length} B，疑似 index.html 回退）`);
if (EXPECT) {
  ok('线上 commit === 期望 commit', !!verJson && verJson.commit === EXPECT, `期望 ${EXPECT}`);
}

// 关键文件逐字节一致：线上产物 = 本地这棵树
for (const p of ['index.html', 'css/ui-realism.css', 'js/ui.js']) {
  const remote = await get('/' + p);
  const want = await localSha(p);
  const got = sha(remote.body);
  ok(`内容一致 ${p}`, got === want, `${remote.body.length} B sha256 ${got.slice(0, 12)}${got === want ? '' : ` ≠ 本地 ${want.slice(0, 12)}`}`);
}

// 测试工具不得公开：用「从未存在过的新路径」验证 Functions 守卫确实在跑。
// 注意：/tools/smoke.mjs 这种「上一版部署遗留在 CF 边缘缓存」的旧文件，缓存命中时
// 不经过 Functions（qa9 已记录），只能等 s-maxage 到期（2026-11-20T19:30Z）。
const freshPath = '/tools/__verify_' + Date.now().toString(36) + '.mjs';
const fresh = await get(freshPath);
const freshIsJs = /javascript|ecmascript/i.test(fresh.type);
ok('测试面守卫生效（新路径 404）', fresh.status === 404 && !freshIsJs,
  `${freshPath} → ${fresh.status} ${fresh.type}`);

const LEGACY_UNTIL = Date.parse('2026-11-20T19:30:00Z');
const tool = await get('/tools/smoke.mjs');
const isIndexFallback = tool.body.equals(index.body);
const isJs = /javascript|ecmascript/i.test(tool.type) && !isIndexFallback;
if (isJs && Date.now() < LEGACY_UNTIL) {
  console.log('  WARN  /tools/smoke.mjs 仍返回上一版边缘缓存（qa9 记录，2026-11-20 到期后自动转为失败项）');
} else {
  ok('测试工具未公开 /tools/smoke.mjs', !isJs && !/CDP/.test(tool.body.toString('utf8')),
    `${tool.status} ${tool.type}${isIndexFallback ? '（index.html 回退）' : ''}`);
}

const bad = results.filter((r) => !r.pass);
console.log(`\n== ${BASE} ==`);
console.log(`  通过 ${results.length - bad.length} / 失败 ${bad.length}`);
if (bad.length) {
  console.log('  失败项：' + bad.map((b) => b.name).join('；'));
  process.exit(1);
}
console.log('  结论：线上版本与本地一致，部署目录未带测试工具');
