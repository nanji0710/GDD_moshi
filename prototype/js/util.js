'use strict';
// 通用工具：数学、随机、路径采样、格式化、颜色。对应 city-and-metro/js/util.js 的精简版。
window.ZT = window.ZT || {};
(function (Z) {
  const U = Z.U = {};

  U.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.smooth = function (t) { return t <= 0 ? 0 : (t >= 1 ? 1 : t * t * (3 - 2 * t)); };
  U.easeOut = function (t) { return 1 - Math.pow(1 - U.clamp(t, 0, 1), 3); };
  U.sign = function (v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); };
  // 帧率无关的指数趋近：k = 1 - exp(-rate*dt)
  U.approach = function (cur, target, rate, dt) { return cur + (target - cur) * (1 - Math.exp(-rate * dt)); };
  U.angleDiff = function (a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  };
  // 转向：每帧最多转 rate 弧度
  U.turnTo = function (cur, target, rate, dt) {
    const d = U.angleDiff(cur, target), m = rate * dt;
    return Math.abs(d) <= m ? target : cur + U.sign(d) * m;
  };

  // ---- 随机：可复现的 mulberry32 ----
  U.Rng = function (seed) { this.s = (seed | 0) || 1; };
  U.Rng.prototype.next = function () {
    this.s = (this.s + 0x6D2B79F5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  U.Rng.prototype.range = function (a, b) { return a + (b - a) * this.next(); };
  U.Rng.prototype.int = function (a, b) { return Math.floor(this.range(a, b + 1)); };
  U.Rng.prototype.pick = function (arr) { return arr[Math.floor(this.next() * arr.length) % arr.length]; };
  U.Rng.prototype.chance = function (p) { return this.next() < p; };

  // ---- 折线弧长参数化（借鉴 metro.js compile 的 pts / cum 结构）----
  // pts: [{x,y,h}]；cum[i] = 到 pts[i] 的累计弧长（米）
  U.buildPath = function (pts) {
    const cum = new Float64Array(pts.length);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      cum[i] = acc;
    }
    return { pts: pts, cum: cum, len: acc };
  };
  // 二分找 s 所在段：返回 {i, f}
  U.locate = function (cum, s) {
    let lo = 0, hi = cum.length - 1;
    if (s <= 0) return { i: 0, f: 0 };
    if (s >= cum[hi]) return { i: hi - 1, f: 1 };
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    const seg = cum[hi] - cum[lo] || 1;
    return { i: lo, f: (s - cum[lo]) / seg };
  };
  // 取路径上弧长 s 处的位置、朝向与高程
  U.posAt = function (path, s, out) {
    out = out || {};
    const pts = path.pts, cum = path.cum;
    s = U.clamp(s, 0, path.len);
    const L = U.locate(cum, s);
    const a = pts[L.i], b = pts[Math.min(pts.length - 1, L.i + 1)];
    out.x = U.lerp(a.x, b.x, L.f);
    out.y = U.lerp(a.y, b.y, L.f);
    out.h = U.lerp(a.h || 0, b.h || 0, L.f);
    const dx = b.x - a.x, dy = b.y - a.y;
    out.a = Math.atan2(dy, dx);
    out.i = L.i; out.f = L.f;
    return out;
  };

  // ---- Catmull-Rom 平滑：把折线控制点变成采样点 ----
  U.spline = function (ctrl, step, closed) {
    const out = [], n = ctrl.length;
    const get = function (i) {
      if (closed) return ctrl[((i % n) + n) % n];
      return ctrl[U.clamp(i, 0, n - 1)];
    };
    const segs = closed ? n : n - 1;
    for (let k = 0; k < segs; k++) {
      const p0 = get(k - 1), p1 = get(k), p2 = get(k + 1), p3 = get(k + 2);
      const approx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const steps = Math.max(2, Math.ceil(approx / step));
      for (let j = 0; j < steps; j++) {
        const t = j / steps, t2 = t * t, t3 = t2 * t;
        const f = function (a, b, c, d) {
          return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        };
        out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
      }
    }
    const last = closed ? ctrl[0] : ctrl[n - 1];
    out.push({ x: last.x, y: last.y });
    return out;
  };

  // ---- 格式化 ----
  U.fmt = function (n) { return Math.round(n).toLocaleString('zh-CN'); };
  U.fmtKm = function (m) { return (m / 1000).toFixed(1) + ' km'; };
  U.fmtPct = function (v) { return Math.round(v * 100) + '%'; };

  // ---- 颜色 ----
  U.rgba = function (hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  };
  U.mix = function (c1, c2, t) {
    const a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16);
    const r = Math.round(U.lerp((a >> 16) & 255, (b >> 16) & 255, t));
    const g = Math.round(U.lerp((a >> 8) & 255, (b >> 8) & 255, t));
    const bl = Math.round(U.lerp(a & 255, b & 255, t));
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  };

  U.makeCanvas = function (w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  };
  // 迷你 DOM 辅助（借鉴 CM.U.h 的签名：h(tag, props, ...children)）
  U.h = function (tag, props) {
    const el = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) { for (const x of c) if (x != null && x !== false) el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); }
      else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return el;
  };
})(window.ZT);
