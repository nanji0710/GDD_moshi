'use strict';
// 把程序化模型导出成标准 glTF 2.0 二进制（.glb），供任何 3D 引擎/建模软件直接打开。
// 用法：node tools/export-glb.cjs
const fs = require('fs');
const path = require('path');
const Models = require('../js/models.js');

const OUT = path.join(__dirname, '..', 'assets', 'models');
fs.mkdirSync(OUT, { recursive: true });

const pad4 = n => (4 - (n % 4)) % 4;

function writeGLB(file, name, m) {
  const idxIs32 = m.idx instanceof Uint32Array;
  const parts = [];
  let offset = 0;
  const views = [];
  const add = (typed, target) => {
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = pad4(buf.length);
    views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target: target });
    parts.push(buf);
    if (pad) parts.push(Buffer.alloc(pad));
    offset += buf.length + pad;
    return views.length - 1;
  };

  const posView = add(m.pos, 34962);
  const norView = add(m.nor, 34962);
  const colView = add(m.col, 34962);
  const idxView = add(m.idx, 34963);

  // POSITION 的 min/max 是 glTF 规范要求的
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = m.pos[i + k];
      if (v < mn[k]) mn[k] = v;
      if (v > mx[k]) mx[k] = v;
    }
  }
  const verts = m.pos.length / 3;
  const json = {
    asset: { version: '2.0', generator: '末世列车 · 程序化模型导出' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: name }],
    meshes: [{
      name: name,
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 },
        indices: 3,
        material: 0,
        mode: 4
      }]
    }],
    materials: [{
      name: 'wasteland_steel',
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0.55,
        roughnessFactor: 0.62
      },
      doubleSided: true
    }],
    buffers: [{ byteLength: offset }],
    bufferViews: views,
    accessors: [
      { bufferView: posView, componentType: 5126, count: verts, type: 'VEC3', min: mn, max: mx },
      { bufferView: norView, componentType: 5126, count: verts, type: 'VEC3' },
      { bufferView: colView, componentType: 5126, count: verts, type: 'VEC3' },
      { bufferView: idxView, componentType: idxIs32 ? 5125 : 5123, count: m.idx.length, type: 'SCALAR' }
    ]
  };

  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = pad4(jsonBuf.length);
  if (jsonPad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);

  const bin = Buffer.concat(parts);
  const total = 12 + 8 + jsonBuf.length + 8 + bin.length;
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546C67, 0);   // 'glTF'
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);

  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonBuf.length, 0);
  jsonHead.writeUInt32LE(0x4E4F534A, 4); // 'JSON'

  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(bin.length, 0);
  binHead.writeUInt32LE(0x004E4942, 4); // 'BIN'

  const out = Buffer.concat([head, jsonHead, jsonBuf, binHead, bin]);
  fs.writeFileSync(file, out);
  return out.length;
}

let totalBytes = 0;
for (const name of Models.names) {
  const m = Models.build(name);
  if (!m) continue;
  const file = path.join(OUT, name + '.glb');
  const size = writeGLB(file, name, m);
  totalBytes += size;
  console.log('  ' + name.padEnd(10) + (m.count / 3 | 0).toString().padStart(5) + ' 三角形   ' +
    (size / 1024).toFixed(1).padStart(6) + ' KB');
}
// 额外吐一份 JS 资产包：file:// 下不能 fetch 本地文件，游戏内直接读 base64
{
  const bundle = {};
  for (const name of Models.names) {
    const p = path.join(OUT, name + '.glb');
    if (fs.existsSync(p)) bundle[name] = fs.readFileSync(p).toString('base64');
  }
  const js = '/* 自动生成：不要手改。源在 js/models.js，由 tools/export-glb.cjs 导出 */\n' +
    'window.ZT = window.ZT || {};\nwindow.ZT.GLB_ASSETS = ' + JSON.stringify(bundle) + ';\n';
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'models-data.js'), js);
  console.log('内嵌资产包 models-data.js  ' + (js.length / 1024).toFixed(1) + ' KB');
}
console.log('导出完成 → ' + OUT);
console.log('合计 ' + (totalBytes / 1024).toFixed(1) + ' KB');
