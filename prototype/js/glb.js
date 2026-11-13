'use strict';
// 极简 glTF 2.0 二进制（.glb）解析器：只取 POSITION / NORMAL / COLOR_0 / indices。
// 资产由 tools/export-glb.cjs 生成，同时以 base64 内嵌在 assets/models-data.js 里（file:// 可直接用）。
window.ZT = window.ZT || {};
(function (Z) {
  function b64ToBuf(b64) {
    const bin = atob(b64);
    const len = bin.length;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  function accessor(json, bin, i) {
    const a = json.accessors[i];
    const bv = json.bufferViews[a.bufferView];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type] || 3;
    const TA = a.componentType === 5126 ? Float32Array
      : a.componentType === 5125 ? Uint32Array
        : a.componentType === 5123 ? Uint16Array
          : Uint8Array;
    // bin 是 Uint8Array 视图，构造 TypedArray 必须传底层的 ArrayBuffer
    return new TA(bin.buffer, bin.byteOffset + off, a.count * comps);
  }

  const GLB = Z.GLB = {
    // 解析 .glb 二进制 → 渲染用的顶点数组
    parse: function (buffer) {
      const dv = new DataView(buffer);
      if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('不是 GLB');
      const total = dv.getUint32(8, true);
      let off = 12, json = null, bin = null;
      while (off < total) {
        const clen = dv.getUint32(off, true);
        const ctype = dv.getUint32(off + 4, true);
        const data = new Uint8Array(buffer, off + 8, clen);
        if (ctype === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(data));
        else if (ctype === 0x004E4942) bin = data;
        off += 8 + clen;
      }
      if (!json || !bin) throw new Error('GLB 缺少数据块');
      const prim = json.meshes[0].primitives[0];
      const pos = accessor(json, bin, prim.attributes.POSITION);
      const nor = accessor(json, bin, prim.attributes.NORMAL);
      const col = accessor(json, bin, prim.attributes.COLOR_0);
      const idx = accessor(json, bin, prim.indices);
      return { pos: pos, nor: nor, col: col, idx: idx, count: idx.length, verts: pos.length / 3, name: json.meshes[0].name };
    },
    // 从内嵌资产包读取
    load: function (name) {
      const a = Z.GLB_ASSETS && Z.GLB_ASSETS[name];
      if (!a) return null;
      return this.parse(b64ToBuf(a));
    },
    names: function () { return Object.keys(Z.GLB_ASSETS || {}); }
  };
})(window.ZT);
