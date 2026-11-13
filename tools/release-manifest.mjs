/**
 * 站点白名单唯一实现（单一来源）。
 *
 * 三个入口共用这一份清单，禁止任何第二份“哪些文件能上线”的规则：
 *   1. tools/stage-site.mjs       装配 _site/（两个 GitHub workflow 与本地 pwsh 部署脚本调用）
 *   2. tools/package-release.mjs  打 release/last-train-prototype.zip（发布本体）
 *   3. tools/check-release.mjs    发版门禁（同步引用/首屏字节/白名单存在性）
 *
 * 规则：
 *   - 只允许 SITE_TOP 里的条目；其余（tools/、shots/、*.log、*.mjs）一律不发。
 *   - assets/ 下只发运行时模型数据 models-data.js；.glb/.gltf/.bin 源资产留在仓库 models/glb/。
 *   - 产物目录里若仍出现 FORBIDDEN 命中的文件，装配/门禁直接失败（exit 1）。
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/** 站点根允许出现的条目（文件或目录） */
export const SITE_TOP = [
  'index.html',
  '404.html',
  '_headers',
  '_redirects',
  'css',
  'js',
  'assets',
];

/** assets/ 里不进部署的源资产后缀（运行时只读 models-data.js） */
export const ASSET_SKIP = /\.(glb|gltf|bin)$/i;

/** 部署目录里绝不允许出现的条目：工具、截图、日志、sourcemap、脚本源码 */
export const FORBIDDEN = /(^|\/)(tools|shots[^/]*)(\/|$)|\.(png|jpe?g|webp|gif|log|map|mjs|cjs)$/i;

async function walk(dir, rel = '', out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) await walk(path.join(dir, e.name), r, out);
    else out.push(r);
  }
  return out;
}

/**
 * 按白名单列出站点文件（相对站点的 posix 路径 + 源绝对路径）。纯函数，不写盘。
 * @param {string} srcDir 站点源目录（通常是 prototype/）
 * @returns {Promise<{files: Array<{rel: string, from: string}>, skipped: string[]}>}
 */
export async function listSiteFiles(srcDir) {
  const files = [];
  const skipped = [];
  for (const top of SITE_TOP) {
    const src = path.join(srcDir, top);
    let info;
    try {
      info = await stat(src);
    } catch {
      continue; // 该条目不存在（如尚未引入 _headers / 404.html）就跳过
    }
    if (info.isDirectory()) {
      for (const f of await walk(src)) {
        const rel = `${top}/${f}`;
        if (rel.startsWith('assets/') && ASSET_SKIP.test(rel)) {
          skipped.push(rel);
          continue;
        }
        files.push({ rel, from: path.join(src, f) });
      }
    } else {
      files.push({ rel: top, from: src });
    }
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { files, skipped };
}

/** 审计一组相对路径，返回违规项（空数组 = 通过） */
export function auditRels(rels) {
  return rels.map((r) => r.replace(/\\/g, '/')).filter((r) => FORBIDDEN.test(r));
}
