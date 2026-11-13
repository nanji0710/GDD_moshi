'use strict';
// 3D 模型：程序化几何 → 顶点数组（pos/nor/col/emi/idx）。
// 同一份代码既供游戏内 WebGL 视图渲染，也供 tools/export-glb.mjs 导出 .glb 资产。
(function (root) {
  const NS = root.ZT = root.ZT || {};

  function Builder() { this.pos = []; this.nor = []; this.col = []; this.emi = []; this.idx = []; this.n = 0; }
  Builder.prototype.vtx = function (p, n, c, e) {
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]);
    this.col.push(c[0], c[1], c[2]); this.emi.push(e || 0);
    return this.n++;
  };
  const hex = h => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
  const shade = (c, k) => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];

  Builder.prototype.box = function (cx, cy, cz, sx, sy, sz, color, opt) {
    opt = opt || {};
    const e = opt.emit || 0;
    const c = typeof color === 'string' ? hex(color) : color;
    const cc = shade(c, opt.k == null ? 1 : opt.k);
    const hl = shade(cc, 1.25);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const P = (x, y, z) => [cx + x, cy + y, cz + z];
    let a, b, c2, d;
    // +Y
    a = this.vtx(P(-hx, hy, -hz), [0, 1, 0], hl, e); b = this.vtx(P(hx, hy, -hz), [0, 1, 0], hl, e);
    c2 = this.vtx(P(hx, hy, hz), [0, 1, 0], hl, e); d = this.vtx(P(-hx, hy, hz), [0, 1, 0], hl, e);
    this.idx.push(a, b, c2, a, c2, d);
    // -Y
    const dk = shade(cc, 0.55);
    a = this.vtx(P(-hx, -hy, -hz), [0, -1, 0], dk, e); b = this.vtx(P(-hx, -hy, hz), [0, -1, 0], dk, e);
    c2 = this.vtx(P(hx, -hy, hz), [0, -1, 0], dk, e); d = this.vtx(P(hx, -hy, -hz), [0, -1, 0], dk, e);
    this.idx.push(a, b, c2, a, c2, d);
    // +Z
    const fz = shade(cc, 1.06);
    a = this.vtx(P(-hx, -hy, hz), [0, 0, 1], fz, e); b = this.vtx(P(hx, -hy, hz), [0, 0, 1], fz, e);
    c2 = this.vtx(P(hx, hy, hz), [0, 0, 1], fz, e); d = this.vtx(P(-hx, hy, hz), [0, 0, 1], fz, e);
    this.idx.push(a, b, c2, a, c2, d);
    // -Z
    a = this.vtx(P(hx, -hy, -hz), [0, 0, -1], shade(cc, 0.9), e); b = this.vtx(P(-hx, -hy, -hz), [0, 0, -1], shade(cc, 0.9), e);
    c2 = this.vtx(P(-hx, hy, -hz), [0, 0, -1], shade(cc, 0.9), e); d = this.vtx(P(hx, hy, -hz), [0, 0, -1], shade(cc, 0.9), e);
    this.idx.push(a, b, c2, a, c2, d);
    // +X
    a = this.vtx(P(hx, -hy, hz), [1, 0, 0], shade(cc, 1.02), e); b = this.vtx(P(hx, -hy, -hz), [1, 0, 0], shade(cc, 1.02), e);
    c2 = this.vtx(P(hx, hy, -hz), [1, 0, 0], shade(cc, 1.02), e); d = this.vtx(P(hx, hy, hz), [1, 0, 0], shade(cc, 1.02), e);
    this.idx.push(a, b, c2, a, c2, d);
    // -X
    a = this.vtx(P(-hx, -hy, -hz), [-1, 0, 0], shade(cc, 0.94), e); b = this.vtx(P(-hx, -hy, hz), [-1, 0, 0], shade(cc, 0.94), e);
    c2 = this.vtx(P(-hx, hy, hz), [-1, 0, 0], shade(cc, 0.94), e); d = this.vtx(P(-hx, hy, -hz), [-1, 0, 0], shade(cc, 0.94), e);
    this.idx.push(a, b, c2, a, c2, d);
    return this;
  };

  Builder.prototype.cyl = function (cx, cy, cz, r, h, seg, color, opt) {
    opt = opt || {};
    const e = opt.emit || 0;
    const c0 = typeof color === 'string' ? hex(color) : color;
    const cc = shade(c0, opt.k == null ? 1 : opt.k);
    const hy = h / 2, base = this.n;
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      this.vtx([cx + ca * r, cy + hy, cz + sa * r], [ca, 0, sa], cc, e);
      this.vtx([cx + ca * r, cy - hy, cz + sa * r], [ca, 0, sa], shade(cc, 0.82), e);
    }
    for (let i = 0; i < seg; i++) {
      const b = base + i * 2;
      this.idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    const tc = shade(cc, 1.2);
    const top = this.vtx([cx, cy + hy, cz], [0, 1, 0], tc, e);
    const ring = [];
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2;
      ring.push(this.vtx([cx + Math.cos(a) * r, cy + hy, cz + Math.sin(a) * r], [0, 1, 0], tc, e));
    }
    for (let i = 0; i < seg; i++) this.idx.push(top, ring[i + 1], ring[i]);
    return this;
  };

  const C = {
    hull: '#5b6875', hullD: '#3d4753', hullL: '#78879a',
    dark: '#22262b', steel: '#8b98a6', accent: '#ffb347',
    glass: '#2b3a4a', rubber: '#1a1c1f'
  };

  function bogie(b, x) {
    b.box(x, 0.55, 0, 3.4, 0.5, 2.6, C.dark);
    for (const dx of [-1.0, 1.0]) for (const dz of [-1.05, 1.05]) {
      b.cyl(x + dx, 0.62, dz, 0.55, 0.42, 14, C.rubber).cyl(x + dx, 0.62, dz + 0.01, 0.24, 0.46, 10, C.steel);
    }
    b.box(x, 0.95, 0, 3.0, 0.28, 2.2, C.hullD);
  }

  function buildLoco() {
    const b = new Builder();
    const L = 22, W = 3.3;
    bogie(b, -6.5); bogie(b, 6.5);
    b.box(0, 2.05, 0, L - 3.2, 2.0, W, C.hull);
    b.box(0, 1.15, 0, L - 2.6, 0.5, W + 0.08, C.hullD);
    b.box(0, 3.15, 0, L - 3.0, 0.22, W - 0.1, C.hullL);
    b.box(L / 2 - 2.4, 3.5, 0, 4.4, 1.5, W + 0.06, C.hull);
    b.box(L / 2 - 2.4, 3.85, 0, 4.0, 0.7, W + 0.12, C.glass, { emit: 0.22, k: 1.2 });
    b.box(L / 2 - 2.4, 4.28, 0, 4.6, 0.16, W + 0.1, C.hullD);
    for (let i = 0; i < 7; i++) b.box(-1.0 + i * 1.15, 3.36, 0, 0.14, 0.34, W - 0.6, C.dark);
    b.cyl(-4.6, 4.15, 0, 0.42, 1.5, 14, C.dark);
    b.cyl(-4.6, 4.95, 0, 0.52, 0.18, 14, C.hullD);
    b.box(-1.4, 3.55, 0, 1.8, 0.5, 1.5, C.hullD);
    b.cyl(2.2, 3.45, 0, 0.34, 0.5, 12, C.steel);
    b.box(4.6, 3.4, 0, 1.2, 0.35, 1.2, C.dark);
    b.box(L / 2 - 0.35, 1.55, 0, 0.7, 0.9, W - 0.4, C.accent, { k: 0.85 });
    b.box(L / 2 - 0.05, 2.55, 0, 0.3, 0.5, 1.6, C.accent, { emit: 0.75 });
    b.cyl(L / 2 + 0.12, 2.55, -0.9, 0.26, 0.24, 12, '#fff3c8', { emit: 1.2 });
    b.cyl(L / 2 + 0.12, 2.55, 0.9, 0.26, 0.24, 12, '#fff3c8', { emit: 1.2 });
    for (const dz of [-W / 2 - 0.02, W / 2 + 0.02]) b.box(0, 2.42, dz, L - 3.4, 0.34, 0.06, '#c9a24a', { k: 1.05 });
    for (const dz of [-W / 2 - 0.06, W / 2 + 0.06]) {
      b.box(0, 2.9, dz, L - 3.4, 0.09, 0.09, C.steel);
      b.box(0, 1.7, dz, L - 3.4, 0.09, 0.09, C.steel);
      for (let i = -4; i <= 4; i++) b.box(i * 2.2, 2.3, dz, 0.08, 1.2, 0.08, C.steel);
    }
    for (const s of [-1, 1]) b.box(s * (L / 2 + 0.5), 1.5, 0, 1.0, 0.34, 0.5, C.dark);
    return b;
  }

  function buildCargo() {
    const b = new Builder();
    const L = 20, W = 3.3;
    bogie(b, -6.0); bogie(b, 6.0);
    b.box(0, 1.35, 0, L - 2.4, 0.5, W, C.hullD);
    b.box(0, 3.0, 0, L - 3.0, 2.6, W - 0.2, '#7a6a4a');
    for (let i = 0; i < 18; i++) {
      const x = -((L - 3.4) / 2) + i * ((L - 3.4) / 17);
      b.box(x, 3.0, W / 2 - 0.12, 0.16, 2.4, 0.12, '#8a7a58', { k: 1.05 });
      b.box(x, 3.0, -W / 2 + 0.12, 0.16, 2.4, 0.12, '#8a7a58', { k: 1.05 });
    }
    for (let i = 0; i < 5; i++) b.box(-6 + i * 3, 4.34, 0, 0.24, 0.12, W - 0.5, '#5f5340');
    b.box(0, 3.0, W / 2 - 0.02, 0.5, 1.6, 0.1, '#3e372b');
    for (const s of [-1, 1]) b.box(s * (L / 2 + 0.45), 1.5, 0, 0.9, 0.3, 0.45, C.dark);
    return b;
  }

  function buildWeapon() {
    const b = new Builder();
    const L = 20, W = 3.3;
    bogie(b, -6.0); bogie(b, 6.0);
    b.box(0, 1.4, 0, L - 2.0, 0.4, W, C.hullD);
    b.box(0, 1.75, 0, L - 3.0, 0.3, W - 0.3, C.hull);
    b.cyl(0, 2.05, 0, 1.7, 0.35, 20, C.hullD);
    b.box(0, 2.55, 0, 3.2, 1.0, 2.8, C.hull);
    b.box(0.35, 2.9, 0, 2.2, 0.5, 2.2, C.hullL);
    b.box(-1.2, 2.7, 0, 0.8, 0.7, 1.6, C.dark);
    for (const dz of [-0.55, 0.55]) {
      b.box(2.6, 2.75, dz, 3.4, 0.26, 0.26, C.dark);
      b.box(4.35, 2.75, dz, 0.4, 0.34, 0.34, C.steel);
    }
    b.box(-3.4, 2.1, 1.0, 1.1, 0.7, 0.8, '#5a4a2a');
    b.box(-3.4, 2.1, -1.0, 1.1, 0.7, 0.8, '#5a4a2a');
    b.box(1.75, 2.85, 0, 0.2, 1.4, 2.4, C.hullL);
    for (const s of [-1, 1]) b.box(s * (L / 2 + 0.45), 1.5, 0, 0.9, 0.3, 0.45, C.dark);
    return b;
  }

  function buildZombie() {
    const b = new Builder();
    const skin = '#7c8a6a', cloth = '#4e5a49', dark = '#2f382e';
    b.box(-0.22, 0.45, 0, 0.26, 0.9, 0.28, dark);
    b.box(0.22, 0.45, 0, 0.26, 0.9, 0.28, dark);
    b.box(-0.22, 0.05, 0.06, 0.3, 0.14, 0.42, '#25231f');
    b.box(0.22, 0.05, 0.06, 0.3, 0.14, 0.42, '#25231f');
    b.box(0, 1.12, 0, 0.72, 0.5, 0.42, cloth);
    b.box(0, 1.5, 0, 0.8, 0.34, 0.46, cloth);
    b.box(-0.44, 1.42, 0.26, 0.22, 0.22, 0.9, skin);
    b.box(0.44, 1.42, 0.26, 0.22, 0.22, 0.9, skin);
    b.box(-0.44, 1.42, 0.72, 0.2, 0.2, 0.22, skin);
    b.box(0.44, 1.42, 0.72, 0.2, 0.2, 0.22, skin);
    b.box(0, 1.86, 0.02, 0.42, 0.42, 0.4, skin);
    b.box(0, 1.92, 0.21, 0.3, 0.12, 0.04, '#1a1410');
    b.box(-0.1, 1.9, 0.22, 0.07, 0.07, 0.03, '#e8564a', { emit: 1.0 });
    b.box(0.1, 1.9, 0.22, 0.07, 0.07, 0.03, '#e8564a', { emit: 1.0 });
    b.box(0, 1.05, 0, 0.84, 0.18, 0.5, '#3d4739');
    return b;
  }

  function buildBuilding() {
    const b = new Builder();
    const W = 14, D = 11, H = 16;
    b.box(0, H / 2, 0, W, H, D, '#4a5158');
    b.box(0, H + 0.35, 0, W + 0.6, 0.7, D + 0.6, '#565e66');
    b.box(0, H + 0.75, 0, W - 0.8, 0.12, D - 0.8, '#3b4249');
    for (let fy = 0; fy < 5; fy++) for (let fx = 0; fx < 4; fx++) {
      const lit = ((fx * 7 + fy * 13) % 10) > 6;
      const col = lit ? '#ffd479' : '#1e2a33';
      b.box(-W / 2 + 2.6 + fx * 3.0, 2.6 + fy * 2.8, D / 2 + 0.06, 1.5, 1.3, 0.12, col, { emit: lit ? 0.9 : 0 });
      b.box(W / 2 + 0.06, 2.6 + fy * 2.8, -D / 2 + 2.2 + fx * 2.4, 0.12, 1.3, 1.5, lit ? '#ffd479' : '#1e2a33', { emit: lit ? 0.9 : 0 });
    }
    b.box(0, 1.4, D / 2 + 0.08, 2.2, 2.8, 0.16, '#2a2119');
    b.box(-3.2, H + 1.6, -2.0, 2.4, 1.0, 1.8, '#3d444b');
    b.cyl(3.4, H + 1.9, 1.6, 1.0, 1.4, 16, '#5a626a');
    b.cyl(3.4, H + 2.6, 1.6, 0.8, 0.2, 16, '#8b949c');
    b.box(0, 0.4, 0, W + 0.1, 0.8, D + 0.1, '#33383c');
    return b;
  }

  const builders = {
    loco: buildLoco, cargo: buildCargo, weapon: buildWeapon,
    zombie: buildZombie, building: buildBuilding
  };

  NS.Models = {
    names: Object.keys(builders),
    build: function (key) {
      const b = builders[key];
      if (!b) return null;
      const r = b();
      return {
        pos: new Float32Array(r.pos), nor: new Float32Array(r.nor),
        col: new Float32Array(r.col), emi: new Float32Array(r.emi),
        idx: (r.n > 65535 ? new Uint32Array(r.idx) : new Uint16Array(r.idx)),
        count: r.idx.length, verts: r.n
      };
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.Models;
})(typeof window !== 'undefined' ? window : globalThis);
