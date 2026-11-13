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
    b.box(-3.4, 2.1, 1.0, 1.1, 0.7, 0.8, '#5a4a2a');
    b.box(-3.4, 2.1, -1.0, 1.1, 0.7, 0.8, '#5a4a2a');
    for (const s of [-1, 1]) b.box(s * (L / 2 + 0.45), 1.5, 0, 0.9, 0.3, 0.45, C.dark);
    return b;
  }

  // 炮塔单独成模型：原点在回转中心，炮管指向 +X
  function buildTurret() {
    const b = new Builder();
    b.box(0, 0.35, 0, 3.0, 0.7, 2.6, C.hull);
    b.box(0.3, 0.72, 0, 2.0, 0.34, 2.0, C.hullL);
    b.box(-1.1, 0.55, 0, 0.8, 0.5, 1.5, C.dark);
    for (const dz of [-0.5, 0.5]) {
      b.box(2.2, 0.55, dz, 3.2, 0.24, 0.24, C.dark);
      b.box(3.9, 0.55, dz, 0.38, 0.32, 0.32, C.steel);
    }
    b.box(1.5, 0.6, 0, 0.2, 1.2, 2.2, C.hullL);
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

  // 废墟：破损的上沿、裂缝、外露钢筋、焦黑与火光
  function buildRuin() {
    const b = new Builder();
    const W = 14, D = 11, H = 13;
    // 主体：上部被削掉一截
    b.box(0, H / 2, 0, W, H, D, '#4a5158');
    // 破损的天台：几块高低不一的残墙
    const jag = [[-4.6, 1.1], [-1.4, 2.3], [1.8, 0.7], [4.4, 1.6]];
    for (const [jx, jh] of jag) b.box(jx, H + jh / 2, 0.4, 2.6, jh, D - 1.2, '#3f464d');
    b.box(0, H + 0.12, 0, W - 1.2, 0.24, D - 1.2, '#33383d');
    // 裂缝：贴在墙面上的细长暗条（正/侧各几道）
    const crack = (x, y, z, w, h, d) => b.box(x, y, z, w, h, d, '#141719', { k: 0.8 });
    crack(-3.2, 6.4, D / 2 + 0.05, 0.28, 5.0, 0.08);
    crack(-2.6, 3.6, D / 2 + 0.05, 1.6, 0.26, 0.08);
    crack(2.4, 8.2, D / 2 + 0.05, 0.24, 4.2, 0.08);
    crack(W / 2 + 0.05, 5.0, -1.2, 0.08, 6.0, 0.26);
    crack(W / 2 + 0.05, 2.4, 1.6, 0.08, 0.24, 2.2);
    // 窗洞：一部分烧黑、少数还亮着
    for (let fy = 0; fy < 4; fy++) for (let fx = 0; fx < 4; fx++) {
      const r = (fx * 17 + fy * 29) % 10;
      const col = r > 8 ? '#ffd479' : (r > 5 ? '#1a1c1e' : '#0e1114');
      b.box(-W / 2 + 2.6 + fx * 3.0, 2.4 + fy * 2.9, D / 2 + 0.06, 1.5, 1.4, 0.1, col, { emit: r > 8 ? 0.9 : 0 });
    }
    // 门洞
    b.box(0, 1.3, D / 2 + 0.08, 2.0, 2.6, 0.14, '#0b0d0e');
    // 外露钢筋
    for (const [rx, ry] of [[-5.2, H + 1.6], [3.9, H + 1.4]]) {
      b.cyl(rx, ry, 0.6, 0.06, 1.6, 6, '#6b5a48');
      b.cyl(rx + 0.5, ry - 0.2, -0.4, 0.05, 1.2, 6, '#5a4a3a');
    }
    // 残存的墙脚 + 焦黑
    b.box(0, 0.45, 0, W + 0.1, 0.9, D + 0.1, '#2b2e30');
    b.box(-W / 2 + 1.4, 1.6, D / 2 + 0.04, 3.0, 2.0, 0.06, '#101112');
    // 火光：烧着的窗口/破洞（自发光）
    b.box(W / 2 - 2.2, 2.2, D / 2 + 0.1, 1.6, 1.2, 0.08, '#ff8a3a', { emit: 1.6 });
    b.box(W / 2 - 2.2, 3.4, D / 2 + 0.1, 1.0, 0.6, 0.08, '#ffd479', { emit: 1.9 });
    // 屋顶上的火堆
    b.box(-2.0, H + 0.5, 1.2, 1.6, 0.5, 1.4, '#ff7a2a', { emit: 2.0 });
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
    zombie: buildZombie, building: buildRuin, turret: buildTurret
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
