'use strict';
// 3D 模型：程序化几何 → 顶点数组（pos/nor/col/emi/idx）。
// 同一份代码既供游戏内 WebGL 视图渲染，也供 tools/export-glb.mjs 导出 .glb 资产。
(function (root) {
  // 共享外观表（2D 也读它，保证两边一致）
  const ART = (typeof require === "function") ? require("./art.js") : (root.ZT && root.ZT.Art);
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

  // ==================== 车厢 ====================
  // 所有车厢长宽高完全一致，只有外观按类型不同：
  //   长 22 · 宽 3.3 · 车身 1.05 → 3.40（顶面色带 3.40 → 3.60）
  const CAR = { L: 22, W: 3.3, FLOOR: 1.05, H: 2.35 };
  CAR.ROOF = CAR.FLOOR + CAR.H;              // 3.40

  const CB = {
    body: '#5f6b78', bodyL: '#77848f', dark: '#20242a', steel: '#8b98a6',
    win: '#2b3a4a', gold: '#c9a24a'
  };
  const ROOF = {
    engine: '#8f9aa8', passenger: '#7f8f6a', weapon: '#7d8794',
    power: '#8a7a5e', armor: '#5f6b78', cargo: '#8a7a5a', repair: '#7a8a74'
  };
  const BODY = {
    engine: '#5b6875', passenger: '#5d6a78', weapon: '#606b76',
    power: '#5a6472', armor: '#4e5a66', cargo: '#6f6350', repair: '#5f6d66'
  };

  function bogies(b, L) {
    for (const x of [-L * 0.32, L * 0.32]) {
      b.box(x, 0.55, 0, 3.4, 0.5, 2.6, CB.dark);
      for (const dx of [-1.0, 1.0]) for (const dz of [-1.05, 1.05]) {
        b.cyl(x + dx, 0.62, dz, 0.55, 0.42, 12, '#1a1c1f');
        b.cyl(x + dx, 0.62, dz + 0.01, 0.24, 0.46, 8, CB.steel);
      }
      b.box(x, 0.95, 0, 3.0, 0.28, 2.2, CB.bodyL);
    }
    b.box(0, 1.15, 0, L - 2.4, 0.5, 3.38, CB.dark);
    for (const s of [-1, 1]) b.box(s * (L / 2 + 0.45), 1.5, 0, 0.9, 0.3, 0.45, CB.dark);
  }

  // 车钩：两端各一套，长 2.4 m，正好跨过 2.2 m 的车距和连接处
  function couplers(b) {
    for (const dir of [-1, 1]) {
      // 钩座（贴在端墙上）
      b.box(dir * 9.85, 1.30, 0, 0.7, 0.8, 1.0, '#2b3037');
      // 钩身
      b.box(dir * 10.9, 1.18, 0, 2.3, 0.32, 0.36, '#3d444c');
      // 钩头（两车相遇的粗节）
      b.box(dir * 11.95, 1.18, 0, 0.65, 0.5, 0.58, '#4c545d');
      b.box(dir * 12.2, 1.34, 0, 0.28, 0.18, 0.34, '#5a636d');
      // 缓冲器
      for (const dz of [-0.5, 0.5]) b.box(dir * 10.15, 1.62, dz, 0.5, 0.46, 0.28, '#2b3037');
      // 风管
      b.cyl(dir * 10.9, 0.95, 0.42, 0.06, 2.1, 5, '#20242a');
    }
  }

  // 统一外壳：每个车型都从这里开始，保证尺寸一致
  function shell(b, type) {
    bogies(b, CAR.L);
    const y0 = CAR.FLOOR, h = CAR.H, W = CAR.W;
    b.box(0, y0 + h / 2, 0, CAR.L - 2.6, h, W, BODY[type] || CB.body);
    couplers(b);

    // 车顶：中间隆起 + 两侧斜切，做出弧度；设备装在顶上不会被色带盖住
    const roofW = W - 1.1;
    b.box(0, CAR.ROOF + 0.11, 0, CAR.L - 2.8, 0.22, roofW, BODY[type] || CB.body, { k: 1.06 });
    for (const dz of [-(roofW / 2 + 0.16), roofW / 2 + 0.16]) {
      b.box(0, CAR.ROOF + 0.05, dz, CAR.L - 2.8, 0.10, 0.60, BODY[type] || CB.body, { k: 0.9 });
      b.box(0, CAR.ROOF - 0.02, dz * 1.35, CAR.L - 3.4, 0.08, 0.42, BODY[type] || CB.body, { k: 0.82 });
    }

    // 顶面色带：只占中间一条（约 1/3 车宽），不再整片盖住车顶
    b.box(0, CAR.ROOF + 0.23, 0, CAR.L - 7.0, 0.05, 1.00, ROOF[type]);
    b.box(0, CAR.ROOF + 0.26, 0, CAR.L - 8.0, 0.03, 0.62, ROOF[type], { k: 1.2 });

    // 檐线 / 腰线 / 竖向分割
    for (const dz of [-W / 2 - 0.02, W / 2 + 0.02]) {
      b.box(0, y0 + h - 0.12, dz, CAR.L - 3.2, 0.09, 0.06, CB.steel);
      b.box(0, y0 + 0.55, dz, CAR.L - 3.2, 0.10, 0.06, CB.steel);
      for (let i = 0; i <= 6; i++) {
        const x = -(CAR.L - 3.4) / 2 + i * ((CAR.L - 3.4) / 6);
        b.box(x, y0 + h * 0.5, dz, 0.09, h * 0.9, 0.05, CB.dark);
      }
  }


    }
  // 车窗：窗框 + 玻璃 + 反光高光 + 窗台，所有车厢同一套做法
  function windows(b, n, lit) {
    const W = CAR.W, y = CAR.FLOOR + CAR.H * 0.62;
    const wh = CAR.H * 0.36;
    for (const dz of [-W / 2 - 0.05, W / 2 + 0.05]) {
      const side = Math.sign(dz);
      for (let i = 0; i < n; i++) {
        const x = -(CAR.L - 5.4) / 2 + (i + 0.5) * ((CAR.L - 5.4) / n);
        // 窗框（钢色，比玻璃大一圈）
        b.box(x, y, dz, 1.46, wh + 0.16, 0.07, '#8b98a6');
        // 玻璃
        b.box(x, y, dz + side * 0.02, 1.28, wh, 0.05, '#243441', { emit: 0.08 });
        // 玻璃高光（斜切一条亮边，模拟天空反射）
        b.box(x - 0.40, y + wh * 0.28, dz + side * 0.03, 0.34, wh * 0.30, 0.04, '#8fb6d4', { emit: 0.30 });
      }
    }
    if (lit) {
      const x0 = -(CAR.L - 5.4) / 2 + 0.9;
      b.box(x0, y, W / 2 + 0.08, 1.2, wh * 0.9, 0.04, '#ffd479', { emit: 0.9 });
    }
  }


  function buildEngine() {
    const b = new Builder();
    shell(b, 'engine');
    windows(b, 5);
    // 金色腰线 + 端面
    for (const dz of [-CAR.W / 2 - 0.05, CAR.W / 2 + 0.05]) b.box(0, 2.42, dz, CAR.L - 3.4, 0.34, 0.06, CB.gold);
    b.box(CAR.L / 2 - 0.35, 1.65, 0, 0.7, 0.9, CAR.W - 0.5, CB.gold, { k: 0.9 });
    b.cyl(CAR.L / 2 + 0.12, 2.55, -0.9, 0.26, 0.22, 10, '#fff3c8', { emit: 1.3 });
    b.cyl(CAR.L / 2 + 0.12, 2.55, 0.9, 0.26, 0.22, 10, '#fff3c8', { emit: 1.3 });
    // 烟囱（车顶设备，不算车身高度）
    b.cyl(-4.6, CAR.ROOF + 0.55, 0, 0.38, 1.1, 12, CB.dark);
    b.cyl(-4.6, CAR.ROOF + 1.15, 0, 0.46, 0.16, 12, CB.bodyL);
    // 散热格栅
    for (let i = 0; i < 5; i++) b.box(-8 + i * 1.1, CAR.ROOF + 0.22, 0, 0.14, 0.22, CAR.W - 1.4, CB.dark);
    return b;
  }

  function buildPassenger() {
    const b = new Builder();
    shell(b, 'passenger');
    windows(b, 7, true);
    // 车门
    for (const x of [-CAR.L / 2 + 2.6, CAR.L / 2 - 2.6]) {
      b.box(x, CAR.FLOOR + CAR.H * 0.5, CAR.W / 2 + 0.05, 1.0, CAR.H * 0.82, 0.07, CB.bodyL);
      b.box(x, CAR.FLOOR + CAR.H * 0.5, -CAR.W / 2 - 0.05, 1.0, CAR.H * 0.82, 0.07, CB.bodyL);
    }
    // 车顶通风机
    for (let i = 0; i < 3; i++) for (const dz of [-0.95, 0.95]) b.box(-5.5 + i * 5.5, CAR.ROOF + 0.38, dz, 1.4, 0.26, 0.9, CB.bodyL);
    return b;
  }

  function buildCargoCar() {
    const b = new Builder();
    shell(b, 'cargo');
    // 加强筋
    for (let i = 0; i < 15; i++) {
      const x = -((CAR.L - 3.8) / 2) + i * ((CAR.L - 3.8) / 14);
      for (const dz of [CAR.W / 2 - 0.14, -CAR.W / 2 + 0.14]) {
        b.box(x, CAR.FLOOR + CAR.H * 0.5, dz, 0.14, CAR.H * 0.92, 0.10, '#847656');
      }
    }
    // 柜门 + 锁杆
    for (const x of [-2.4, 0.4]) {
      b.box(x, CAR.FLOOR + CAR.H * 0.5, CAR.W / 2 + 0.03, 0.12, CAR.H * 0.9, 0.08, '#3e372b');
      b.box(x, CAR.FLOOR + CAR.H * 0.4, CAR.W / 2 + 0.07, 0.10, 1.1, 0.06, CB.steel);
    }
    return b;
  }

  function buildWeaponCar() {
    const b = new Builder();
    shell(b, 'weapon');
    // 上层是敞开平台：把车顶中间挖成甲板
    b.box(0, CAR.ROOF + 0.02, 0, CAR.L - 4.0, 0.06, CAR.W - 1.0, CB.dark);
    // 炮座圈
    // 两个挂座圈：和 2D 的 ±4.5 m 挂点对齐
    for (const dx of [-4.5, 4.5]) {
      b.cyl(dx, CAR.ROOF + 0.12, 0, 1.35, 0.20, 14, CB.steel);
      b.cyl(dx, CAR.ROOF + 0.20, 0, 1.05, 0.10, 14, CB.dark);
    }
    // 弹药箱
    for (const dz of [-1.1, 1.1]) b.box(0, CAR.ROOF + 0.26, dz, 1.6, 0.45, 0.7, '#5a4a2a');
    // 护栏
    for (const dz of [-CAR.W / 2 + 0.2, CAR.W / 2 - 0.2]) b.box(0, CAR.ROOF + 0.45, dz, CAR.L - 4.4, 0.07, 0.07, CB.steel);
    return b;
  }

  function buildPowerCar() {
    const b = new Builder();
    shell(b, 'power');
    windows(b, 2);
    // 发电机组 + 散热格栅
    for (const dz of [-0.9, 0.9]) b.box(-3.4, CAR.ROOF + 0.35, dz, 4.2, 0.7, 1.0, CB.bodyL);
    for (let i = 0; i < 5; i++) b.box(-6.4 + i * 0.5, CAR.FLOOR + CAR.H * 0.6, CAR.W / 2 + 0.04, 0.26, 1.1, 0.06, CB.dark);
    // 排气管
    for (const dz of [-0.75, 0.75]) b.cyl(6.6, CAR.ROOF + 0.6, dz, 0.2, 1.2, 8, CB.dark);
    // 电缆
    b.box(0, CAR.ROOF + 0.30, 1.0, 7.0, 0.10, 0.10, CB.steel);
    return b;
  }

  function buildArmorCar() {
    const b = new Builder();
    shell(b, 'armor');
    // 外挂装甲板：贴在车身上，不改变总尺寸
    for (const dz of [-CAR.W / 2 - 0.06, CAR.W / 2 + 0.06]) {
      for (let i = 0; i < 6; i++) {
        const x = -(CAR.L - 4) / 2 + i * ((CAR.L - 4) / 5);
        b.box(x, CAR.FLOOR + CAR.H * 0.5, dz, 1.55, CAR.H * 0.8, 0.10, '#56626e');
      }
      for (let i = 0; i < 13; i++) b.box(-(CAR.L - 3) / 2 + i * ((CAR.L - 3) / 12), CAR.ROOF - 0.25, dz + 0.04, 0.11, 0.11, 0.05, CB.steel);
    }
    // 射击孔
    for (const x of [-4.5, 0, 4.5]) b.box(x, CAR.FLOOR + CAR.H * 0.55, CAR.W / 2 + 0.14, 0.45, 0.26, 0.08, '#101315');
    return b;
  }

  function buildRepairCar() {
    const b = new Builder();
    shell(b, 'repair');
    windows(b, 3);
    // 吊臂（车顶设备）
    b.box(2.2, CAR.ROOF + 0.5, 0, 0.45, 1.0, 0.45, CB.steel);
    b.box(4.4, CAR.ROOF + 1.0, 0, 4.2, 0.3, 0.36, CB.steel);
    b.box(6.2, CAR.ROOF + 0.5, 0, 0.09, 1.2, 0.09, CB.dark);
    // 工具箱
    for (let i = 0; i < 3; i++) b.box(-6 + i * 1.7, CAR.ROOF + 0.32, 1.0, 1.2, 0.5, 0.8, '#5a4a2a');
    return b;
  }


  // 炮塔拆四件：底座圈（不转） / 回转台 / 炮盾 / 炮管（可俯仰）
  // 原点都在各自的枢轴上，方便 3D 里做 yaw + pitch
  function buildTurretBase() {
    const b = new Builder();
    b.cyl(0, 0.09, 0, 1.30, 0.18, 18, '#5a636d');       // 固定座圈
    b.cyl(0, 0.20, 0, 1.12, 0.10, 18, '#8b98a6');
    for (let i = 0; i < 8; i++) {                        // 一圈螺栓
      const a = i / 8 * Math.PI * 2;
      b.box(Math.cos(a) * 1.16, 0.26, Math.sin(a) * 1.16, 0.12, 0.10, 0.12, '#6d767f');
    }
    return b;
  }

  // 回转台：绕 Y 旋转（yaw）
  function buildTurretBody() {
    const b = new Builder();
    b.cyl(0, 0.14, 0, 1.02, 0.28, 16, '#4e5a66');        // 回转盘
    b.box(0, 0.52, 0, 2.35, 0.62, 2.05, '#5f6b78');      // 塔体
    b.box(0.15, 0.86, 0, 1.75, 0.22, 1.65, '#77848f');   // 顶盖
    b.box(-0.75, 0.90, 0, 0.55, 0.16, 0.55, '#20242a');  // 舱盖
    // 炮盾：正前方一块带斜角的护板
    b.box(1.05, 0.55, 0, 0.22, 0.95, 1.95, '#6b7784');
    b.box(1.20, 0.55, 0, 0.14, 0.72, 1.35, '#7a8794');
    // 侧储物筐
    for (const dz of [-1.12, 1.12]) b.box(-0.05, 0.42, dz, 1.25, 0.34, 0.16, '#3f4a54');
    return b;
  }

  // 炮管：枢轴在原点，向 +X 伸出；绕 X 旋转（pitch）
  function buildTurretBarrel() {
    const b = new Builder();
    b.box(0.32, 0, 0, 0.64, 0.30, 0.30, '#3a4249');      // 炮尾
    b.cyl(0.55, 0, 0, 0.13, 0.10, 10, '#8b98a6');        // 抽烟装置
    b.box(1.45, 0, 0, 2.30, 0.13, 0.13, '#4a525a');      // 炮管
    b.box(2.55, 0, 0, 0.22, 0.19, 0.19, '#2c333a');      // 制退器
    b.box(2.72, 0, 0, 0.14, 0.15, 0.15, '#3d454d');
    return b;
  }

  // ============ 五种武器的炮塔外观 ============
  // 每种武器有独立的「回转台」和「炮管/发射器」，底座圈共用
  const WCOL = { mg: '#ffd479', flamer: '#ff7a2f', flak: '#9fe0ff', tesla: '#b79bff', mortar: '#ffb347', laser: '#7ef0ff', shotgun: '#ffb0a0', gas: '#9fe86a' };
  const WHULL = '#5f6b78', WDARK = '#20242a', WSTEEL = '#8b98a6';

  function turretBodyOf(kind) {
    const b = new Builder();
    const c = WCOL[kind] || '#ffd479';
    b.cyl(0, 0.14, 0, 1.02, 0.28, 16, '#4e5a66');          // 共用回转盘
    if (kind === 'mg') {
      b.box(0, 0.50, 0, 1.9, 0.56, 1.6, WHULL);
      b.box(0.75, 0.55, 0, 0.5, 0.42, 1.2, WDARK);           // 弹链箱
      b.box(-0.35, 0.84, 0.55, 0.7, 0.18, 0.5, c);           // 顶部识别条
    } else if (kind === 'flamer') {
      b.box(0, 0.52, 0, 1.7, 0.6, 1.5, '#6a5c4a');
      for (const dz of [-0.72, 0.72]) b.cyl(-0.55, 0.62, dz, 0.36, 1.1, 10, '#8a6a3a');  // 燃料罐
      b.box(0.85, 0.5, 0, 0.4, 0.5, 0.8, WDARK);
    } else if (kind === 'flak') {
      b.box(0, 0.54, 0, 2.2, 0.66, 1.9, WHULL);
      b.box(0.9, 0.6, 0, 0.5, 0.8, 1.5, '#6b7784');          // 炮盾
      for (const dz of [-0.85, 0.85]) b.box(-0.5, 0.4, dz, 0.9, 0.4, 0.35, '#5a4a2a'); // 弹箱
      b.box(-0.35, 0.92, 0, 0.8, 0.16, 1.2, c);
    } else if (kind === 'tesla') {
      b.cyl(0, 0.42, 0, 0.85, 0.55, 14, '#3a4048');
      for (let k = 0; k < 3; k++) b.cyl(0, 0.72 + k * 0.26, 0, 0.62 - k * 0.08, 0.12, 12, c); // 线圈
      b.box(0, 0.55, 0, 1.5, 0.12, 0.12, WSTEEL);            // 支架
      b.box(0, 0.55, 0, 0.12, 0.12, 1.5, WSTEEL);
    } else if (kind === 'laser') {
      b.box(0, 0.50, 0, 2.0, 0.52, 1.7, '#5a6470');
      for (let k = 0; k < 3; k++) b.cyl(0.15, 0.78 + k * 0.1, 0, 0.55 - k * 0.1, 0.1, 12, c);
      b.box(-0.6, 0.55, 0, 0.5, 0.4, 1.2, '#3a4249');       // 冷却罐
      b.box(0, 0.9, 0, 0.9, 0.12, 0.5, c);
    } else if (kind === 'shotgun') {
      b.box(0, 0.50, 0, 1.8, 0.56, 1.7, '#6a5f52');
      b.box(0.85, 0.52, 0, 0.4, 0.66, 1.4, '#7a6f62');       // 炮盾
      for (const dz of [-0.8, 0.8]) b.box(-0.5, 0.42, dz, 0.8, 0.34, 0.3, '#4a3a28'); // 弹药
      b.box(0, 0.86, 0, 0.7, 0.14, 0.9, c);
    } else if (kind === 'gas') {
      b.box(0, 0.50, 0, 1.6, 0.56, 1.5, '#5a6a4a');
      for (const dz of [-0.62, 0.62]) b.cyl(-0.5, 0.6, dz, 0.34, 1.0, 10, '#6a8a4a'); // 毒气罐
      b.box(0.8, 0.5, 0, 0.36, 0.46, 0.7, '#3a4a32');
    } else { // mortar
      b.box(0, 0.44, 0, 1.5, 0.5, 1.4, '#5a6470');
      b.cyl(0, 0.72, 0, 0.9, 0.24, 14, WDARK);               // 座钣
      for (const dz of [-0.55, 0.55]) b.box(-0.6, 0.5, dz, 0.5, 0.5, 0.4, '#4a535c');
    }
    return b;
  }

  function turretBarrelOf(kind) {
    const b = new Builder();
    const c = WCOL[kind] || '#ffd479';
    if (kind === 'mg') {
      for (const dz of [-0.22, 0.22]) {
        b.box(1.15, 0, dz, 2.1, 0.12, 0.12, '#3f474f');
        b.box(2.2, 0, dz, 0.22, 0.16, 0.16, WDARK);
      }
      b.box(0.45, 0, 0, 0.5, 0.3, 0.62, c);                  // 枪座
    } else if (kind === 'flamer') {
      b.box(0.42, 0, 0, 0.5, 0.3, 0.4, '#4a525a');
      b.box(0.95, 0, 0, 1.0, 0.26, 0.26, '#6a6a6a');
      b.cyl(1.55, 0, 0, 0.2, 0.26, 10, WDARK);               // 喷口
      b.cyl(1.72, 0, 0, 0.26, 0.1, 10, c);                   // 火环
    } else if (kind === 'flak') {
      b.box(0.55, 0, 0, 0.9, 0.26, 0.26, '#4a525a');
      b.box(1.85, 0, 0, 2.2, 0.16, 0.16, '#3f474f');
      b.box(2.95, 0, 0, 0.4, 0.24, 0.24, WDARK);             // 制退器
      b.box(0.55, 0, 0, 0.2, 0.4, 0.4, c);
    } else if (kind === 'tesla') {
      b.box(0.6, 0, 0, 0.8, 0.16, 0.16, '#6a7080');
      for (const dz of [-0.28, 0, 0.28]) {
        b.cyl(1.15, 0, dz, 0.06, 0.9, 8, c);                 // 三根放电针
        b.cyl(1.6, 0, dz, 0.04, 0.3, 6, '#e8e0ff');
      }
    } else if (kind === 'laser') {
      b.box(0.5, 0, 0, 0.8, 0.3, 0.3, '#3a4249');
      b.cyl(1.5, 0, 0, 0.14, 2.0, 10, '#6a7480');            // 发射管
      for (let k = 0; k < 3; k++) b.cyl(1.2 + k * 0.35, 0, 0, 0.2, 0.1, 10, c); // 聚焦环
      b.cyl(2.6, 0, 0, 0.1, 0.16, 8, '#e8ffff');             // 镜面
    } else if (kind === 'shotgun') {
      for (const dz of [-0.16, 0.16]) b.box(1.3, 0, dz, 1.6, 0.16, 0.16, '#3f474f');
      b.cyl(2.15, 0, 0, 0.24, 0.2, 10, '#2c333a');           // 收口
      b.box(0.5, 0, 0, 0.5, 0.28, 0.5, c);
    } else if (kind === 'gas') {
      b.box(0.4, 0, 0, 0.4, 0.3, 0.34, '#4a5a42');
      b.box(0.9, 0, 0, 0.9, 0.26, 0.26, '#6a7a5a');
      b.cyl(1.45, 0, 0, 0.24, 0.22, 10, '#2c333a');          // 喷头
      b.cyl(1.62, 0, 0, 0.3, 0.08, 10, c);                   // 毒雾环
    } else { // mortar
      b.cyl(0.55, 0, 0, 0.2, 0.5, 10, '#4a525a');
      b.box(1.25, 0, 0, 1.5, 0.2, 0.2, '#3f474f');
      b.cyl(2.0, 0, 0, 0.2, 0.24, 10, WDARK);
      b.cyl(1.7, 0, 0, 0.14, 0.16, 8, c);                    // 炮口环
    }
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

  // 废墟：倒塌的上层、露出的楼板与立柱、断墙、瓦砾、焦痕、火光
  // 枯树：低模，两层稀疏树冠
  function buildTree() {
    const b = new Builder();
    b.cyl(0, 1.6, 0, 0.22, 3.2, 8, '#4a3a2a');
    b.cyl(0, 3.4, 0, 1.5, 1.5, 9, '#3a4a32');
    b.cyl(0, 4.5, 0, 1.15, 1.2, 9, '#42543a');
    b.cyl(0, 5.4, 0, 0.75, 0.9, 8, '#4c6040');
    b.cyl(0.9, 2.6, 0.4, 0.16, 1.8, 6, '#4a3a2a');
    return b;
  }

  // 车顶色带：与 2D 的 roof 色块一一对应，按车厢类型染色
  function buildBand() {
    const b = new Builder();
    b.box(0, 0, 0, 15.6, 0.10, 2.05, '#c8ccd0');
    b.box(0, 0.07, 0, 14.6, 0.06, 1.6, '#d8dce0');
    return b;
  }

  // 丧尸拆件：身体 / 腿 / 手臂，供 3D 做走路摆动
  const ZP = { skin: '#7c8a6a', cloth: '#4e5a49', dark: '#2f382e' };
  function buildZBody(kind) {
    const a = (ART && ART.ZOMBIE && ART.ZOMBIE[kind]) || { body: '#55684f', head: '#5a6350', w: 1, h: 1 };
    const b = new Builder();
    const w = a.w || 1, h = a.h || 1;
    const eye = '#e8564a';
    // 躯干
    b.box(0, 1.12 * h, 0, 0.72 * w, 0.50 * h, 0.42 * w, a.body);
    b.box(0, 1.50 * h, 0, 0.80 * w, 0.34 * h, 0.46 * w, a.body);
    // 头
    b.box(0, 1.86 * h, 0.02, 0.42, 0.42, 0.40, a.head);
    b.box(0, 1.92 * h, 0.21, 0.30, 0.12, 0.04, '#1a1410');
    b.box(-0.10, 1.90 * h, 0.22, 0.07, 0.07, 0.03, eye, { emit: 1.0 });
    b.box(0.10, 1.90 * h, 0.22, 0.07, 0.07, 0.03, eye, { emit: 1.0 });
    // 腰带
    b.box(0, 1.05 * h, 0, 0.84 * w, 0.18, 0.50 * w, '#3d4739');
    // 种类特征
    if (a.sac) {                                  // 吐酸者：背上的毒囊
      b.box(0, 1.42 * h, -0.40 * w, 0.52, 0.54, 0.34, '#7a8a3a');
      b.box(0, 1.42 * h, -0.56 * w, 0.30, 0.30, 0.12, '#93a34a');
    }
    if (a.tool) {                                 // 撬轨者：右臂的撬棍
      b.box(0.46 * w, 1.40 * h, 0.42, 0.13, 0.13, 0.70, '#8a8f95');
      b.box(0.46 * w, 1.40 * h, 0.78, 0.22, 0.10, 0.18, '#5a5f65');
    }
    if (a.mouth) {                                // 尖啸者：张开的嘴
      b.box(0, 1.80 * h, 0.21, 0.16, 0.24, 0.05, '#120c0c');
      b.box(0, 1.80 * h, 0.23, 0.10, 0.16, 0.03, '#3a1010');
    }
    if (a.fat) {                                  // 肿胀者：鼓起的肚子
      b.box(0, 1.04 * h, 0, 0.94 * w, 0.52, 0.62 * w, a.body);
      b.box(0, 1.04 * h, 0.34 * w, 0.60, 0.40, 0.10, '#7a7a52');
    }
    if (a.longArms) {                             // 攀爬者：更长的前臂
      b.box(-0.44 * w, 1.36 * h, 0.62, 0.20, 0.20, 0.62, a.body);
      b.box(0.44 * w, 1.36 * h, 0.62, 0.20, 0.20, 0.62, a.body);
    }
    return b;
  }
  function buildZLeg() {
    const b = new Builder();
    b.box(0, -0.45, 0, 0.26, 0.9, 0.28, ZP.dark);
    b.box(0, -0.9, 0.06, 0.3, 0.14, 0.42, '#25231f');
    return b;
  }
  function buildZArm() {
    const b = new Builder();
    b.box(0, 0, 0.45, 0.22, 0.22, 0.9, ZP.skin);
    b.box(0, 0, 0.9, 0.2, 0.2, 0.22, ZP.skin);
    return b;
  }


  function buildRuin() {
    const b = new Builder();
    const W = 14, D = 11;
    const wallC = '#6f7780', wallD = '#5c646c', slabC = '#7c848c', darkC = '#1b1f22';
    // 确定性伪随机：同一个模型每次导出都一样
    let seed = 20261113;
    const rnd = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    // 1) 残存的楼体：只到 3 层，第 4 层塌了
    b.box(0, 5.4, 0, W, 10.8, D, wallC);
    // 2) 楼板：三层，越往上越缺
    for (let i = 0; i < 3; i++) {
      const y = 3.6 + i * 3.6;
      const w = i === 2 ? W * 0.55 : W;
      const d = i === 2 ? D * 0.5 : D;
      b.box(-(W - w) / 2, y, -(D - d) / 2, Math.max(1.2, w - 0.25), 0.30, Math.max(1.2, d - 0.25), '#4f565c');
    }
    // 3) 顶部参差：一排高低不同的残墙
    const tops = [[-5.6, 2.2], [-2.3, 4.6], [0.8, 1.4], [3.4, 3.4], [5.9, 1.0]];
    for (const t of tops) {
      b.box(t[0], 10.8 + t[1] / 2, 0, 2.7, t[1], D * 0.82, wallD);
    }
    // 4) 外露立柱：从断口处伸出来
    for (const cx of [-6.2, 6.2]) {
      b.box(cx, 11.6, 5.1, 0.75, 2.4, 0.75, slabC);
      b.box(cx, 11.6, -5.1, 0.75, 2.4, 0.75, slabC);
      // 钢筋
      b.cyl(cx, 13.4, 5.1, 0.05, 1.1, 5, '#6b5a48');
    }
    // 5) 断墙：正面右上角整块塌掉
    b.box(4.6, 8.4, D / 2 - 0.15, 4.4, 4.2, 0.3, darkC);
    // 6) 裂缝：暗色细条贴在墙上
    const crack = (x, y, z, w, h, d) => b.box(x, y, z, w, h, d, darkC);
    crack(-3.4, 6.2, D / 2 + 0.03, 0.26, 5.4, 0.07);
    crack(-2.9, 3.4, D / 2 + 0.03, 1.7, 0.24, 0.07);
    crack(1.9, 8.0, D / 2 + 0.03, 0.22, 4.0, 0.07);
    crack(W / 2 + 0.03, 5.2, -1.4, 0.07, 6.2, 0.26);
    crack(W / 2 + 0.03, 2.2, 1.2, 0.07, 0.22, 2.4);
    // 7) 窗洞：烧黑为主，少数还亮着
    for (let fy = 0; fy < 3; fy++) for (let fx = 0; fx < 4; fx++) {
      if (fy === 2 && fx > 1) continue;                 // 顶层塌了一半
      const r = (fx * 13 + fy * 29) % 10;
      const col = r > 8 ? '#ffd479' : (r > 4 ? '#141719' : '#0d1012');
      b.box(-W / 2 + 2.6 + fx * 3.0, 2.0 + fy * 3.6, D / 2 + 0.05, 1.5, 1.4, 0.1, col, { emit: r > 8 ? 0.8 : 0 });
    }
    // 8) 门洞
    b.box(0, 1.3, D / 2 + 0.06, 2.2, 2.6, 0.12, '#0a0c0d');
    // 9) 瓦砾堆：楼脚一圈碎块
    for (let i = 0; i < 26; i++) {
      const a = rnd() * 6.2832, rr = 6.0 + rnd() * 6.0;
      const px = Math.cos(a) * rr, pz = Math.sin(a) * rr * 0.8;
      const sz = 0.5 + rnd() * 1.6;
      b.box(px, sz * 0.35, pz, sz, sz * 0.7, sz * 0.9, rnd() > 0.5 ? wallD : '#3a3f44');
    }
    // 10) 焦黑：被烧过的墙面
    b.box(-W / 2 + 2.0, 1.5, D / 2 + 0.02, 3.2, 3.0, 0.06, '#0b0d0e');
    // 11) 火光：烧穿的窗口和屋顶余烬（自发光）
    b.box(W / 2 - 2.6, 2.2, D / 2 + 0.12, 1.5, 1.1, 0.08, '#ff8a3a', { emit: 1.8 });
    b.box(W / 2 - 2.6, 3.3, D / 2 + 0.12, 1.0, 0.6, 0.08, '#ffd479', { emit: 2.2 });
    b.box(-1.8, 11.1, 1.0, 1.8, 0.5, 1.6, '#ff7a2a', { emit: 2.0 });
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
    engine: buildEngine, passenger: buildPassenger, cargo: buildCargoCar,
    weapon: buildWeaponCar, power: buildPowerCar, armor: buildArmorCar,
    repair: buildRepairCar,
    turret: buildTurretBody, zombie: buildZombie, building: buildRuin, turret_base: buildTurretBase,
    t_mg: function () { return turretBodyOf('mg'); }, t_mg_b: function () { return turretBarrelOf('mg'); },
    t_flamer: function () { return turretBodyOf('flamer'); }, t_flamer_b: function () { return turretBarrelOf('flamer'); },
    t_flak: function () { return turretBodyOf('flak'); }, t_flak_b: function () { return turretBarrelOf('flak'); },
    t_tesla: function () { return turretBodyOf('tesla'); }, t_tesla_b: function () { return turretBarrelOf('tesla'); },
    t_mortar: function () { return turretBodyOf('mortar'); }, t_mortar_b: function () { return turretBarrelOf('mortar'); },
    t_laser: function () { return turretBodyOf('laser'); }, t_laser_b: function () { return turretBarrelOf('laser'); },
    t_shotgun: function () { return turretBodyOf('shotgun'); }, t_shotgun_b: function () { return turretBarrelOf('shotgun'); },
    t_gas: function () { return turretBodyOf('gas'); }, t_gas_b: function () { return turretBarrelOf('gas'); }, turret_body: buildTurretBody, turret_barrel: buildTurretBarrel, tree: buildTree,
    zbody: function () { return buildZBody("walker"); },
    zbody_walker: function () { return buildZBody("walker"); },
    zbody_runner: function () { return buildZBody("runner"); },
    zbody_climber: function () { return buildZBody("climber"); },
    zbody_ripper: function () { return buildZBody("ripper"); },
    zbody_spitter: function () { return buildZBody("spitter"); },
    zbody_screamer: function () { return buildZBody("screamer"); },
    zbody_bloater: function () { return buildZBody("bloater"); }, zleg: buildZLeg, zarm: buildZArm
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
