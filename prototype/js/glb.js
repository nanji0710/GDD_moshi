'use strict';
// 极简 glTF 2.0 二进制（.glb）解析器：只取 POSITION / NORMAL / COLOR_0 / indices。
// 资产由 tools/export-glb.cjs 生成：运行时只读内嵌的 assets/models-data.js（base64，file:// 可直接用），
// .glb 源文件在仓库 models/glb/（供导出/第三方查看，不进部署目录、不进首屏）。
// 首屏不引 models-data.js：只有 3D 视图需要它，由 GLB.ensure() 动态插 classic <script> 异步加载。
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

  // 加载态提示：首屏不显示；只有真正开始拉模型数据时才出现（#asset-loading 在 index.html 里）
  function showPill(on, text) {
    const el = document.getElementById('asset-loading');
    if (!el) return;
    if (text) el.textContent = text;
    el.classList.toggle('hidden', !on);
  }

  const GLB = Z.GLB = {
    ready: false,          // models-data.js 已加载且 GLB_ASSETS 非空
    error: null,           // 加载失败原因（重试会清掉）
    loading: false,
    _waiters: [],

    // 异步加载模型数据（幂等；回调 (err)）。file:// 下唯一可靠的方式是 classic script，
    // fetch()/动态 import() 在 origin=null 时会被 CORS 拒掉。
    ensure: function (cb) {
      if (typeof cb === 'function') {
        if (this.ready) { cb(null); return; }
        if (this.error) { cb(this.error); return; }
        this._waiters.push(cb);
      }
      if (this.ready || this.loading) return;
      this.loading = true;
      this.error = null;
      const self = this;
      const el = document.createElement('script');
      el.src = 'assets/models-data.js';
      el.async = true;
      el.onload = function () {
        self.loading = false;
        self.ready = !!(Z.GLB_ASSETS && Object.keys(Z.GLB_ASSETS).length);
        if (!self.ready) self.error = new Error('models-data.js 已加载但没有 GLB_ASSETS');
        console.info('[GLB] 模型数据就绪（异步）：' + Object.keys(Z.GLB_ASSETS || {}).length + ' 个模型');
        showPill(false);
        self._flush();
      };
      el.onerror = function () {
        self.loading = false;
        self.error = new Error('models-data.js 加载失败');
        console.warn('[GLB] 模型数据加载失败（file:// 下检查 assets/models-data.js 是否存在）');
        showPill(false);
        if (Z.UI && Z.UI.toast) Z.UI.toast('模型资源加载失败，3D 视图暂不可用', 'bad');
        self._flush();
      };
      console.info('[GLB] 开始异步加载模型数据 assets/models-data.js');
      showPill(true, '模型资源加载中…');
      document.head.appendChild(el);
    },
    _flush: function () {
      const list = this._waiters; this._waiters = [];
      for (const cb of list) { try { cb(this.error) } catch (e) { console.error('GLB.ensure callback', e) } }
    },

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
