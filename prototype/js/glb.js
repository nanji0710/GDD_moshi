'use strict';
// 极简 glTF 2.0 二进制（.glb）解析器：只取 POSITION / NORMAL / COLOR_0 / indices。
// 资产由 tools/export-glb.cjs 生成：运行时只读内嵌的 assets/models-data.js（base64，file:// 可直接用），
// .glb 源文件在仓库 models/glb/（供导出/第三方查看，不进部署目录、不进首屏）。
// 首屏不引 models-data.js：只有 3D 视图需要它，由 GLB.ensure() 动态插 classic <script> 异步加载。
// #7：进关不再预取（main.js 不再调 ensure）；首次切 3D 才加载；10s 超时；脚本立即 onerror（404/缺失/损坏）
//     自动重试 1 次；error 不粘（再次 ensure 会重新发起且保留 waiters）；#asset-loading 由本文件单点管理，
//     失败态文案「模型加载失败，点此重试」且可点/可键盘触发重试。
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

  // #asset-loading 的唯一管理者（index.html 里只有空壳元素 + 关键样式）
  const PILL_LOADING = '模型资源加载中…';
  const PILL_FAILED = '模型加载失败，点此重试';

  function pillEl() { return document.getElementById('asset-loading'); }
  function showPill(text, bad) {
    const el = pillEl();
    if (!el) return;
    if (text) el.textContent = text;
    el.classList.remove('hidden');
    el.classList.toggle('bad', !!bad);
    el.setAttribute('role', bad ? 'button' : 'status');
    el.tabIndex = bad ? 0 : -1;
  }
  function hidePill() {
    const el = pillEl();
    if (!el) return;
    el.classList.add('hidden');
    el.classList.remove('bad');
    el.setAttribute('role', 'status');
    el.tabIndex = -1;
  }

  const GLB = Z.GLB = {
    ready: false,          // models-data.js 已加载且 GLB_ASSETS 非空
    error: null,           // 加载失败原因（重试会清掉，但不会因此阻止重试）
    loading: false,
    _waiters: [],
    _intent3D: false,      // 用户点 3D 被拦下的意图：加载成功后由 UI.finishPending3D 直接完成切换
    _fails: 0,             // 本次加载连续 onerror 次数：第 1 次自动重试，第 2 次转终态
    TIMEOUT_MS: 10000,

    // 异步加载模型数据（幂等；回调 (err)）。file:// 下唯一可靠的方式是 classic script，
    // fetch()/动态 import() 在 origin=null 时会被 CORS 拒掉。
    ensure: function (cb) {
      if (typeof cb === 'function') {
        if (this.ready) { cb(null); return; }
        this._waiters.push(cb);          // error 置位时也先登记：重试成功后统一 flush，不丢回调
      }
      if (this.ready || this.loading) return;
      this._begin();
    },

    // 用户点 #asset-loading（仅失败态绑定有效）：重新发起加载
    retry: function () {
      if (this.loading) return;
      this._intent3D = this._intent3D || !!(Z.World3D && !Z.World3D.on);
      this.ensure();
    },

    _begin: function () {
      this.loading = true;
      this.error = null;
      this._fails = 0;
      this._bindPill();
      showPill(PILL_LOADING, false);
      this._attempt();
    },

    _attempt: function () {
      const self = this;
      const el = document.createElement('script');
      el.src = 'assets/models-data.js';
      el.async = true;
      let settled = false;
      const timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        // D1：10s 超时是终态，不自动重试（否则「12s 挂起」永远看不到失败态）
        self._fail(new Error('models-data.js 加载超时（' + Math.round(self.TIMEOUT_MS / 1000) + 's）'));
      }, this.TIMEOUT_MS);

      el.onload = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        self.loading = false;
        self._fails = 0;
        if (!(Z.GLB_ASSETS && Object.keys(Z.GLB_ASSETS).length)) {
          self._fail(new Error('models-data.js 已加载但没有 GLB_ASSETS'));
          return;
        }
        self.ready = true;
        hidePill();
        console.info('[GLB] 模型数据就绪（异步）：' + Object.keys(Z.GLB_ASSETS).length + ' 个模型');
        self._flush();
        if (self._intent3D) {
          self._intent3D = false;
          if (Z.UI && Z.UI.finishPending3D) Z.UI.finishPending3D();
        }
      };

      el.onerror = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        self._fails++;
        if (self._fails < 2) {
          // D2：自动重试恰 1 次，仅限脚本立即 onerror（404/缺失/损坏），间隔 400ms；超时不重试
          console.warn('[GLB] 脚本加载失败，400ms 后自动重试（第 ' + (self._fails + 1) + ' 次）');
          setTimeout(function () {
            if (!self.loading) return;
            self._attempt();
          }, 400);
          return;
        }
        self._fail(new Error('models-data.js 加载失败'));
      };

      console.info('[GLB] 开始异步加载模型数据 assets/models-data.js');
      document.head.appendChild(el);
    },

    _fail: function (err) {
      this.loading = false;
      this.error = err;
      this._fails = 0;
      console.warn('[GLB] ' + err.message + '（点 #asset-loading 可重试）');
      showPill(PILL_FAILED, true);
      this._flush();
    },

    _flush: function () {
      const list = this._waiters;
      this._waiters = [];
      for (const cb of list) { try { cb(this.error) } catch (e) { console.error('GLB.ensure callback', e) } }
    },

    _bindPill: function () {
      const el = pillEl();
      if (!el || el.__glbRetry) return;
      el.__glbRetry = true;
      const self = this;
      el.addEventListener('click', function () {
        if (self.loading) return;
        if (self.ready && !self.error) return;
        self.retry();
      });
      el.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if (!self.loading && (!self.ready || self.error)) self.retry();
      });
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
