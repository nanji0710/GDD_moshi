'use strict';
// 渲染器 + 相机 + 输入 + 主循环。游戏逻辑在 state.js / train.js / zombies.js，界面在 ui.js。
window.ZT = window.ZT || {};
(function (Z) {
  const U = Z.U, CFG = Z.CFG, Fx = Z.Fx;

  // ================= 渲染器 =================
  function Renderer(cv) {
    this.cv = cv;
    this.ctx = cv.getContext('2d');
    this.w = 0; this.h = 0; this.dpr = 1;
    this.cam = { cx: 0, cy: 0, zoom: CFG.CAM.zoom, tilt: CFG.CAM.tilt, tiltT: CFG.CAM.tilt };
    this.z = CFG.CAM.zoom; this.ox = 0; this.oy = 0;
    this.cosT = Math.cos(CFG.CAM.tilt); this.sinT = Math.sin(CFG.CAM.tilt);
    this.frame = 0; this.follow = true; this.showRanges = false;
    this.resize();
  }
  Renderer.prototype.resize = function () {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.dpr = dpr; this.w = w; this.h = h;
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
  };
  Renderer.prototype.compute = function () {
    const c = this.cam;
    this.z = c.zoom;
    this.cosT = Math.cos(c.tilt); this.sinT = Math.sin(c.tilt);
    this.ox = this.w / 2 - c.cx * this.z;
    this.oy = this.h / 2 - c.cy * this.cosT * this.z;
  };
  Renderer.prototype.base = function () { this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); };
  Renderer.prototype.flat = function (ctx) { ctx.setTransform(this.dpr * this.z, 0, 0, this.dpr * this.z * this.cosT, this.dpr * this.ox, this.dpr * this.oy); };
  Renderer.prototype.unflat = function (ctx) { ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); };
  Renderer.prototype.P = function (x, y, h, out) {
    out = out || {};
    out.x = this.ox + x * this.z;
    out.y = this.oy + y * this.cosT * this.z - (h || 0) * this.sinT * this.z * CFG.CAM.hScale;
    return out;
  };
  Renderer.prototype.screenToWorld = function (sx, sy) { return { x: (sx - this.ox) / this.z, y: (sy - this.oy) / (this.cosT * this.z) }; };
  Renderer.prototype.worldView = function () {
    const a = this.screenToWorld(0, 0), b = this.screenToWorld(this.w, this.h);
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  };
  Renderer.prototype.hashCell = function (a, b, c) {
    let h = (a * 374761393 + b * 668265263 + (c || 0) * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  Renderer.prototype.pathVisible = function (pts, pad) {
    const v = this.worldView();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    return x1 > v.x0 - pad && x0 < v.x1 + pad && y1 > v.y0 - pad && y0 < v.y1 + pad;
  };
  Renderer.prototype.traceWorld = function (ctx, pts) {
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  };
  Z.Renderer = Renderer;

  // ================= 车辆绘制 =================
  function drawCar(ctx, R, run, k, lay) {
    const c = lay[k], car = run.cars[k];
    if (!c || !c.ok || !car) return;
    const z = R.z, hw = CFG.TRAIN.carHalfW, hgt = CFG.TRAIN.heightM;
    const type = car.type, tdef = CFG.CAR_TYPES[type];
    const frac = car.dead ? 0 : car.hp / car.maxHp;
    const T = performance.now() / 1000;

    const corners = [
      { x: c.fx + c.nx * hw, y: c.fy + c.ny * hw },
      { x: c.fx - c.nx * hw, y: c.fy - c.ny * hw },
      { x: c.bx - c.nx * hw, y: c.by - c.ny * hw },
      { x: c.bx + c.nx * hw, y: c.by + c.ny * hw }
    ];
    const base = corners.map(function (p) { return R.P(p.x, p.y, c.h, {}); });
    const top = corners.map(function (p) { return R.P(p.x, p.y, c.h + hgt, {}); });

    // 落地阴影
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.beginPath();
    const sh = corners.map(function (p) { return R.P(p.x + 2.2, p.y + 3.0, c.h, {}); });
    ctx.moveTo(sh[0].x, sh[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(sh[i].x, sh[i].y);
    ctx.closePath(); ctx.fill();

    const dmg = 1 - frac;
    const skin = (Z.Meta && Z.Meta.skinDef) ? Z.Meta.skinDef() : null;
    const hull = car.dead ? '#202226' : U.mix((skin && skin.hull) || '#4b5765', '#2a2f36', dmg * 0.8);
    const roof = car.dead ? '#191b1e' : U.mix(tdef.color, '#2a2f36', dmg * 0.55);
    const flash = car.flash > 0.4;

    // 侧面：上亮下暗的金属渐变 + 高光边，让方块有体积
    const hullMid = U.mix(hull, '#ffffff', 0.15);
    const hullTop = U.mix(hullMid, '#ffffff', 0.26);
    const hullBot = U.mix(hull, '#000000', 0.34);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      if (corners[j].y - corners[i].y <= 0) continue;
      if (flash) {
        ctx.fillStyle = '#9fa8b4';
      } else {
        const g = ctx.createLinearGradient(base[i].x, base[i].y, top[i].x, top[i].y);
        g.addColorStop(0, hullBot);
        g.addColorStop(0.55, hullMid);
        g.addColorStop(1, hullTop);
        ctx.fillStyle = g;
      }
      ctx.beginPath();
      ctx.moveTo(base[i].x, base[i].y); ctx.lineTo(base[j].x, base[j].y);
      ctx.lineTo(top[j].x, top[j].y); ctx.lineTo(top[i].x, top[i].y);
      ctx.closePath(); ctx.fill();
      // 侧面污渍：两三道纵向脏痕，让车皮不「新得发亮」
      if (!car.dead && z > 1.0) {
        ctx.fillStyle = 'rgba(20,18,14,0.13)';
        for (let d = 0; d < 2; d++) {
          const t0 = 0.24 + d * 0.34 + ((k * 7 + d * 13) % 10) * 0.012;
          const x0 = base[i].x + (base[j].x - base[i].x) * t0;
          const y0 = base[i].y + (base[j].y - base[i].y) * t0;
          const x1 = top[i].x + (top[j].x - top[i].x) * t0;
          const y1 = top[i].y + (top[j].y - top[i].y) * t0;
          ctx.fillRect(x0 - z * 0.35, y0 + (y1 - y0) * 0.22, Math.max(1, z * 0.7), (y0 - y1) * 0.55);
        }
      }
      // 上沿高光 / 下沿暗边
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = Math.max(1, z * 0.28);
      ctx.beginPath(); ctx.moveTo(top[i].x, top[i].y); ctx.lineTo(top[j].x, top[j].y); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.42)';
      ctx.beginPath(); ctx.moveTo(base[i].x, base[i].y); ctx.lineTo(base[j].x, base[j].y); ctx.stroke();
      // 板缝 + 铆钉（近景才画，远了纯噪点）
      if (z > 1.2 && !car.dead) {
        for (const t of [0.34, 0.67]) {
          const x0 = base[i].x + (base[j].x - base[i].x) * t, y0 = base[i].y + (base[j].y - base[i].y) * t;
          const x1 = top[i].x + (top[j].x - top[i].x) * t, y1 = top[i].y + (top[j].y - top[i].y) * t;
          ctx.strokeStyle = 'rgba(0,0,0,0.26)';
          ctx.lineWidth = Math.max(0.8, z * 0.18);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,0.07)';
          ctx.beginPath(); ctx.moveTo(x0 + 1, y0); ctx.lineTo(x1 + 1, y1); ctx.stroke();
          ctx.fillStyle = 'rgba(0,0,0,0.28)';
          for (let r = 0; r < 4; r++) {
            const v = 0.18 + r * 0.22;
            ctx.beginPath();
            ctx.arc(x0 + (x1 - x0) * v, y0 + (y1 - y0) * v, Math.max(0.55, z * 0.15), 0, 6.2832);
            ctx.fill();
          }
        }
      }
    }
    // 车下底盘：一条暗带 + 两端转向架，让车厢"站"在轨道上而不是浮着
    if (z > 0.6) {
      ctx.fillStyle = 'rgba(8,9,11,0.55)';
      ctx.beginPath();
      ctx.moveTo(base[0].x, base[0].y + z * 0.55);
      for (let i = 1; i < 4; i++) ctx.lineTo(base[i].x, base[i].y + z * 0.55);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = Math.max(1.4, z * 0.5);
      for (const t of [-1, 1]) {
        const bx = c.x + c.ox * t * 6.6, by = c.y + c.oy * t * 6.6;
        const p0 = R.P(bx - c.ox * 2.4, by - c.oy * 2.4, c.h * 0.2, {});
        const p1 = R.P(bx + c.ox * 2.4, by + c.oy * 2.4, c.h * 0.2, {});
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      }
    }
    // 车钩：前后各一小段
    if (z > 0.9) {
      ctx.strokeStyle = 'rgba(14,16,18,0.9)';
      ctx.lineWidth = Math.max(1.4, z * 0.42);
      for (const sgn of [-1, 1]) {
        const ex = c.x + c.ox * sgn * (CFG.TRAIN.carLenM / 2 + 0.2);
        const ey = c.y + c.oy * sgn * (CFG.TRAIN.carLenM / 2 + 0.2);
        const a1 = R.P(ex, ey, c.h + hgt * 0.45, {});
        const a2 = R.P(ex + c.ox * sgn * 1.1, ey + c.oy * sgn * 1.1, c.h + hgt * 0.45, {});
        ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y); ctx.stroke();
      }
    }

    // 装甲车厢：外挂侧板
    if (type === 'armor' && !car.dead) {
      ctx.strokeStyle = 'rgba(160,175,192,0.5)';
      ctx.lineWidth = Math.max(1.5, z * 0.8);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        if (corners[j].y - corners[i].y <= 0) continue;
        const a = R.P(corners[i].x + c.nx * 0.9, corners[i].y + c.ny * 0.9, c.h + hgt * 0.55, {});
        const b2 = R.P(corners[j].x + c.nx * 0.9, corners[j].y + c.ny * 0.9, c.h + hgt * 0.55, {});
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
      }
    }

    // 车顶：中间亮、边缘暗的金属顶
    const roofMid = U.mix(roof, '#ffffff', 0.20);
    const roofHi = U.mix(roofMid, '#ffffff', 0.30);
    const roofLo = U.mix(roofMid, '#000000', 0.30);
    const rminY = Math.min(top[0].y, top[1].y, top[2].y, top[3].y);
    const rmaxY = Math.max(top[0].y, top[1].y, top[2].y, top[3].y);
    ctx.beginPath();
    ctx.moveTo(top[0].x, top[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(top[i].x, top[i].y);
    ctx.closePath();
    if (flash) {
      ctx.fillStyle = '#cfd6df';
    } else {
      const rg = ctx.createLinearGradient(0, rminY, 0, rmaxY);
      rg.addColorStop(0, roofHi); rg.addColorStop(0.55, roofMid); rg.addColorStop(1, roofLo);
      ctx.fillStyle = rg;
    }
    ctx.fill();

    // 车顶设备：用双线性坐标在顶面画，任意视角都不会歪
    if (z > 0.85 && !car.dead) {
      const rp = function (u, v) {
        const ax = top[0].x + (top[1].x - top[0].x) * u, ay = top[0].y + (top[1].y - top[0].y) * u;
        const bx = top[3].x + (top[2].x - top[3].x) * u, by = top[3].y + (top[2].y - top[3].y) * u;
        return { x: ax + (bx - ax) * v, y: ay + (by - ay) * v };
      };
      const rquad = function (u0, u1, v0, v1, fill, edge) {
        const p1 = rp(u0, v0), p2 = rp(u1, v0), p3 = rp(u1, v1), p4 = rp(u0, v1);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y);
        ctx.closePath();
        ctx.fillStyle = fill; ctx.fill();
        if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = Math.max(0.8, z * 0.16); ctx.stroke(); }
      };
      const edgeL = 'rgba(255,255,255,0.10)';
      if (type === 'engine') {
        rquad(0.52, 0.80, 0.14, 0.32, '#3b4046', edgeL);      // 设备箱
        rquad(0.18, 0.32, 0.18, 0.26, 'rgba(255,212,121,0.45)'); // 舱口
      } else if (type === 'passenger') {
        rquad(0.28, 0.72, 0.16, 0.38, '#4b5158', edgeL);      // 空调
        rquad(0.28, 0.72, 0.56, 0.78, '#4b5158', edgeL);
      } else if (type === 'weapon') {
        rquad(0.10, 0.32, 0.28, 0.72, '#2f3439', 'rgba(255,255,255,0.08)');
        rquad(0.68, 0.90, 0.28, 0.72, '#2f3439', 'rgba(255,255,255,0.08)');
      } else if (type === 'power') {
        rquad(0.18, 0.82, 0.22, 0.78, '#34393f', edgeL);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = Math.max(0.8, z * 0.16);
        for (let v = 0.3; v < 0.75; v += 0.12) {
          const a = rp(0.2, v), b2 = rp(0.8, v);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
        }
      } else if (type === 'cargo') {
        rquad(0.14, 0.86, 0.16, 0.84, '#7a6a4a', 'rgba(255,255,255,0.12)');
        ctx.strokeStyle = 'rgba(0,0,0,0.30)';
        ctx.lineWidth = Math.max(0.8, z * 0.16);
        for (let v2 = 0.24; v2 < 0.8; v2 += 0.12) {
          const a1 = rp(0.16, v2), b1 = rp(0.84, v2);
          ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(b1.x, b1.y); ctx.stroke();
        }
      } else if (type === 'repair') {
        rquad(0.32, 0.68, 0.32, 0.68, '#3e434a', edgeL);
        const ctr = rp(0.5, 0.5);
        ctx.fillStyle = 'rgba(255,212,121,0.65)';
        ctx.beginPath(); ctx.arc(ctr.x, ctr.y, Math.max(1.2, z * 0.5), 0, 6.2832); ctx.fill();
      }
    }
    ctx.strokeStyle = 'rgba(255,236,200,0.34)';
    ctx.lineWidth = Math.max(1.2, z * 0.4);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = Math.max(1, z * 0.22);
    ctx.beginPath();
    ctx.moveTo(top[3].x, top[3].y); ctx.lineTo(top[2].x, top[2].y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.30)';
    ctx.lineWidth = Math.max(1, z * 0.32);
    const m0 = R.P(c.bx, c.by, c.h + hgt, {}), m1 = R.P(c.fx, c.fy, c.h + hgt, {});
    ctx.beginPath(); ctx.moveTo(m0.x, m0.y); ctx.lineTo(m1.x, m1.y); ctx.stroke();
    // 车顶细节：让不同类型的车厢在缩略时也能认出来
    if (z > 1.0 && !car.dead) {
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = Math.max(1.2, z * 0.34);
      ctx.beginPath();
      if (type === 'weapon') {
        for (let sidx = 0; sidx < 2; sidx++) {
          const sg = sidx === 0 ? -1 : 1;
          const a = R.P(c.x + c.nx * 1.5 * sg - c.ox * 9, c.y + c.ny * 1.5 * sg - c.oy * 9, c.h + hgt, {});
          const b = R.P(c.x + c.nx * 1.5 * sg + c.ox * 9, c.y + c.ny * 1.5 * sg + c.oy * 9, c.h + hgt, {});
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        }
      } else if (type === 'armor') {
        for (let n = 0; n < 3; n++) {
          const t0 = -7 + n * 7;
          const a = R.P(c.x + c.ox * t0 - c.nx * 2.6, c.y + c.oy * t0 - c.ny * 2.6, c.h + hgt, {});
          const b = R.P(c.x + c.ox * t0 + c.nx * 2.6, c.y + c.oy * t0 + c.ny * 2.6, c.h + hgt, {});
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        }
      } else if (type === 'power') {
        const q1 = R.P(c.x + c.ox * 6 - c.nx * 2.0, c.y + c.oy * 6 - c.ny * 2.0, c.h + hgt, {});
        const q2 = R.P(c.x - c.ox * 6 + c.nx * 2.0, c.y - c.oy * 6 + c.ny * 2.0, c.h + hgt, {});
        ctx.moveTo(q1.x, q1.y);
        const q3 = R.P(c.x - c.ox * 6 - c.nx * 2.0, c.y - c.oy * 6 - c.ny * 2.0, c.h + hgt, {});
        ctx.lineTo(q3.x, q3.y);
        ctx.lineTo(q2.x, q2.y);
        ctx.lineTo(q1.x, q1.y);
      } else if (type === 'repair') {
        const q1 = R.P(c.x + c.ox * 5 - c.nx * 2.2, c.y + c.oy * 5 - c.ny * 2.2, c.h + hgt, {});
        const q2 = R.P(c.x + c.ox * 5 + c.nx * 2.2, c.y + c.oy * 5 + c.ny * 2.2, c.h + hgt, {});
        ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y);
      }
      ctx.stroke();
    }

    // 窗带（人员车厢 / 车头）
    if ((type === 'passenger' || type === 'engine') && z > 0.9) {
      const cols = type === 'passenger' ? 5 : 2;
      const edges = [[1, 2], [3, 0]];
      for (let e = 0; e < edges.length; e++) {
        const i = edges[e][0], j = edges[e][1];
        for (let n = 0; n < cols; n++) {
          const t0 = 0.14 + (n + 0.5) / cols * 0.72;
          const px = corners[i].x + (corners[j].x - corners[i].x) * t0;
          const py = corners[i].y + (corners[j].y - corners[i].y) * t0;
          const q = R.P(px, py, c.h + hgt * 0.62, {});
          const broken = frac < 0.28;
          ctx.fillStyle = broken ? 'rgba(12,10,8,0.9)' : (flash ? '#fff' : 'rgba(232,220,192,0.72)');
          const ww = Math.max(1.4, z * 0.75), hh = Math.max(1.4, z * 0.55);
          ctx.fillRect(q.x - ww / 2, q.y - hh / 2, ww, hh);
        }
      }
    }
    // 车头灯
    if (type === 'engine') {
      const hp2 = R.P(c.fx, c.fy, c.h + hgt * 0.55, {});
      ctx.fillStyle = 'rgba(255,240,200,0.16)';
      ctx.beginPath(); ctx.arc(hp2.x, hp2.y, Math.max(5, z * 3.2), 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#f0e6cc';
      ctx.beginPath(); ctx.arc(hp2.x, hp2.y, Math.max(1.8, z * 0.9), 0, 6.2832); ctx.fill();
    }
    // 动力车厢：烟囱 + 烟
    if (type === 'power') {
      const cp = R.P(c.x, c.y, c.h + hgt + 1.2, {});
      ctx.fillStyle = '#3a3a3e';
      ctx.fillRect(cp.x - z * 0.9, cp.y - z * 1.6, z * 1.8, z * 2.2);
      for (let n = 0; n < 3; n++) {
        const ph = (T * 0.5 + n * 0.33) % 1;
        ctx.globalAlpha = (1 - ph) * 0.32;
        ctx.fillStyle = '#8a8f96';
        ctx.beginPath();
        ctx.arc(cp.x + Math.sin(ph * 6 + n) * z * 0.6, cp.y - z * (1.8 + ph * 5), z * (0.8 + ph * 1.5), 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // 修理车厢：吊臂
    if (type === 'repair' && !car.dead) {
      const ang = Math.sin(T * 0.8) * 0.9;
      const rp = R.P(c.x, c.y, c.h + hgt + 0.8, {});
      const ep = R.P(c.x + Math.cos(ang) * 7, c.y + Math.sin(ang) * 7, c.h + hgt + 4.2, {});
      ctx.strokeStyle = '#c9a94a';
      ctx.lineWidth = Math.max(1.6, z * 0.7);
      ctx.beginPath(); ctx.moveTo(rp.x, rp.y); ctx.lineTo(ep.x, ep.y); ctx.stroke();
      ctx.fillStyle = '#8a8f96';
      ctx.beginPath(); ctx.arc(ep.x, ep.y, Math.max(1.4, z * 0.5), 0, 6.2832); ctx.fill();
    }
    // 武器车厢：弹药箱
    if (type === 'weapon' && !car.dead) {
      for (let n = 0; n < car.slots.length; n++) {
        if (!car.slots[n]) continue;
        const dx = (n === 0 ? -1 : 1) * 4.5;
        const wp = R.P(c.x + c.ox * dx + c.nx * 1.1, c.y + c.oy * dx + c.ny * 1.1, c.h + hgt, {});
        ctx.fillStyle = 'rgba(30,32,28,0.9)';
        ctx.fillRect(wp.x - z * 0.7, wp.y - z * 0.5, z * 1.4, z * 1.0);
      }
    }

    // 受损：掉装甲板 / 冒烟 / 起火
    if (!car.dead) {
      if (frac < 0.75) {
        const holes = frac < 0.5 ? 3 : 1;
        for (let n = 0; n < holes; n++) {
          const t0 = 0.2 + (n * 0.27) % 0.6;
          const q = R.P(c.bx + (c.fx - c.bx) * t0 + c.nx * (n % 2 ? 1 : -1) * 0.8,
                      c.by + (c.fy - c.by) * t0 + c.ny * (n % 2 ? 1 : -1) * 0.8, c.h + hgt, {});
          ctx.fillStyle = 'rgba(14,12,10,0.85)';
          ctx.beginPath(); ctx.ellipse(q.x, q.y, Math.max(1.2, z * 0.9), Math.max(0.9, z * 0.6), 0.4, 0, 6.2832); ctx.fill();
        }
      }
      if (frac < 0.5) {
        for (let n = 0; n < 3; n++) {
          const ph = (T * 0.7 + n * 0.34) % 1;
          const q = R.P(c.x + c.ox * (n - 1) * 3, c.y + c.oy * (n - 1) * 3, c.h + hgt + 1 + ph * 6, {});
          ctx.globalAlpha = (1 - ph) * (frac < 0.25 ? 0.72 : 0.26);
          ctx.fillStyle = frac < 0.25 ? (ph < 0.45 ? '#ffd08a' : '#ff7a2f') : '#7d838a';
          ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(1.5, z * (0.9 + ph * 1.8)), 0, 6.2832); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    // 武器（炮塔 + 炮管 + 等级点）
    if (!car.dead) {
      for (let j = 0; j < car.slots.length; j++) {
        const w = car.slots[j];
        if (!w) continue;
        const mp = run.train.slotPos(c, j, {});
        const p = R.P(mp.x, mp.y, mp.h, {});
        // ===== 按 3D 模型的构件重画：同一套局部坐标（前/横/高，单位米）=====
        const kind = w.key || 'mg';
        const kd = w.def();
        const form = w.form;
        const col = kd.color || '#ffd479';
        const ca2 = Math.cos(w.aim), sa2 = Math.sin(w.aim);
        const nx2 = -sa2, ny2 = ca2;
        const toW = function (fx, fz) { return [mp.x + ca2 * fx + nx2 * fz, mp.y + sa2 * fx + ny2 * fz]; };
        // 一个水平矩形（前向长 len、横向宽 wid、中心相对 (fx,fz)，高度 h）
        const quad = function (fx, fz, len, wid, h, fill) {
          const hs = [[-len / 2, -wid / 2], [len / 2, -wid / 2], [len / 2, wid / 2], [-len / 2, wid / 2]];
          ctx.beginPath();
          for (let k3 = 0; k3 < 4; k3++) {
            const w3 = toW(fx + hs[k3][0], fz + hs[k3][1]);
            const q3 = R.P(w3[0], w3[1], h, {});
            if (k3 === 0) ctx.moveTo(q3.x, q3.y); else ctx.lineTo(q3.x, q3.y);
          }
          ctx.closePath();
          ctx.fillStyle = fill; ctx.fill();
        };
        const disc = function (fx, fz, r, h, fill) {
          const w3 = toW(fx, fz);
          const q3 = R.P(w3[0], w3[1], h, {});
          ctx.beginPath(); ctx.arc(q3.x, q3.y, Math.max(0.6, r * z), 0, 6.2832);
          ctx.fillStyle = fill; ctx.fill();
        };
        const rod = function (fx0, fz, fx1, wid, h, fill) {
          quad((fx0 + fx1) / 2, fz, Math.abs(fx1 - fx0), wid, h, fill);
        };
        // 立体盒：给定底面中心/尺寸/离地高度/盒高，画出顶面 + 四个侧面（斜投影下才有厚度）
        const box3 = function (fx, fz, len, wid, y0, hgt, cTop, cSide) {
          const fc = [[-len / 2, -wid / 2], [len / 2, -wid / 2], [len / 2, wid / 2], [-len / 2, wid / 2]];
          const pb = [], pt = [];
          for (let k5 = 0; k5 < 4; k5++) {
            const w5 = toW(fx + fc[k5][0], fz + fc[k5][1]);
            pb.push(R.P(w5[0], w5[1], y0, {}));
            pt.push(R.P(w5[0], w5[1], y0 + hgt, {}));
          }
          // 四个侧面
          for (let k5 = 0; k5 < 4; k5++) {
            const k6 = (k5 + 1) % 4;
            ctx.beginPath();
            ctx.moveTo(pb[k5].x, pb[k5].y);
            ctx.lineTo(pb[k6].x, pb[k6].y);
            ctx.lineTo(pt[k6].x, pt[k6].y);
            ctx.lineTo(pt[k5].x, pt[k5].y);
            ctx.closePath();
            ctx.fillStyle = cSide; ctx.fill();
          }
          // 顶面
          ctx.beginPath();
          for (let k5 = 0; k5 < 4; k5++) {
            if (k5 === 0) ctx.moveTo(pt[0].x, pt[0].y); else ctx.lineTo(pt[k5].x, pt[k5].y);
          }
          ctx.closePath();
          ctx.fillStyle = cTop; ctx.fill();
        };

        const H0 = mp.h + 0.55;          // 回转台高度（和 3D 的 3.52 对应）
        // 等级成长（与 3D 同一公式）
        const wlv2 = Math.min(5, w.level || 1);
        const lvLen2 = 1 + (wlv2 - 1) * 0.07;
        const lvThick2 = 1 + (wlv2 - 1) * 0.05;
        const HB = mp.h + 0.55;          // 炮管高度

        // 1) 共用底座圈
        disc(0, 0, 1.30, mp.h + 0.1, '#5a636d');
        disc(0, 0, 1.02, mp.h + 0.22, '#4e5a66');

        if (kind === 'mg') {
          box3(0, 0, 1.9, 1.6, H0, 0.56, '#6d7b88', '#4a5561');
          box3(0.75, 0, 0.5, 1.2, H0, 0.42, '#2a2f36', '#1a1e22');          // 弹链箱
          quad(-0.35, 0.55, 0.7, 0.5, H0 + 0.1, col);      // 顶部识别条
          const nb = form === 'A' ? 2 : 1;
          const far = (form === 'B' ? 2.9 : form === 'A' ? 2.1 : 2.5) * lvLen2;
          for (let bi = 0; bi < nb; bi++) {
            const off = nb === 1 ? 0 : (bi === 0 ? -0.22 : 0.22);
            rod(0.5, off, far, 0.13 * lvThick2, HB, '#3f474f');
            quad(far, off, 0.22, 0.16, HB, '#20242a');
          }
          quad(0.45, 0, 0.5, 0.62, HB, col);
        } else if (kind === 'flamer') {
          box3(0, 0, 1.7, 1.5, H0, 0.60, '#7a6a55', '#4e4234');
          disc(-0.55, -0.72, 0.36, H0 + 0.1, '#8a6a3a');    // 燃料罐 ×2
          disc(-0.55, 0.72, 0.36, H0 + 0.1, '#8a6a3a');
          box3(0.85, 0, 0.4, 0.8, H0, 0.50, '#2a2f36', '#1a1e22');
          rod(0.4, 0, 1.2 * lvLen2, 0.3 * lvThick2, HB, '#4a525a');
          rod(1.2, 0, 1.75, 0.26, HB, '#6a6a6a');
          disc(1.6, 0, 0.2, HB, '#20242a');
          disc(1.72, 0, 0.26, HB, col);                     // 火环
        } else if (kind === 'flak') {
          box3(0, 0, 2.2, 1.9, H0, 0.66, '#6d7b88', '#4a5561');
          box3(0.9, 0, 0.5, 1.5, H0, 0.80, '#7b8a98', '#55606b');            // 炮盾
          box3(-0.5, -0.85, 0.9, 0.35, H0 - 0.1, 0.40, '#6b5836', '#3e3220');
          box3(-0.5, 0.85, 0.9, 0.35, H0 - 0.1, 0.40, '#6b5836', '#3e3220');
          const far2 = (form === 'B' ? 3.1 : 2.9) * lvLen2;
          rod(0.5, 0, far2, 0.16 * lvThick2, HB, '#3f474f');
          quad(far2, 0, 0.4, 0.24, HB, '#20242a');          // 制退器
          quad(0.55, 0, 0.2, 0.4, HB, col);
        } else if (kind === 'tesla') {
          disc(0, 0, 0.85, H0, '#3a4048');
          for (let k4 = 0; k4 < 3; k4++) {                  // 三层线圈
            const rr = 0.62 - k4 * 0.08;
            const w4 = toW(0, 0);
            const q4 = R.P(w4[0], w4[1], H0 + 0.2 + k4 * 0.26, {});
            ctx.strokeStyle = col;
            ctx.lineWidth = Math.max(1, z * 0.16);
            ctx.beginPath(); ctx.arc(q4.x, q4.y, Math.max(1, rr * z), 0, 6.2832); ctx.stroke();
          }
          quad(0, 0, 1.5, 0.12, H0, '#8b98a6');             // 十字支架
          quad(0, 0, 0.12, 1.5, H0, '#8b98a6');
          for (const fz2 of [-0.28, 0, 0.28]) {             // 三根放电针
            rod(0.6, fz2, 1.5, 0.1, HB, col);
            disc(1.6, fz2, 0.09, HB, '#e8e0ff');
          }
        } else if (kind === 'laser') {
          box3(0, 0, 2.0, 1.7, H0, 0.52, '#6d7b88', '#4a5561');
          box3(-0.6, 0, 0.5, 1.2, H0, 0.40, '#3f4a54', '#2a323a');     // 冷却罐
          box3(0, 0, 0.9, 0.5, H0 + 0.52, 0.12, col, col);            // 顶部散热条
          rod(0.5, 0, 2.4 * lvLen2, 0.14 * lvThick2, HB, '#6a7480');
          for (let k5 = 0; k5 < 3; k5++) disc(1.2 + k5 * 0.35, 0, 0.20, HB, col);
          disc(2.5, 0, 0.12, HB, '#e8ffff');
        } else if (kind === 'shotgun') {
          box3(0, 0, 1.8, 1.7, H0, 0.56, '#7a6f62', '#554c42');
          box3(0.85, 0, 0.4, 1.4, H0, 0.66, '#8a7f72', '#5a5148');    // 炮盾
          box3(-0.5, -0.8, 0.8, 0.3, H0 - 0.1, 0.34, '#5a4a34', '#3a2f20');
          box3(-0.5, 0.8, 0.8, 0.3, H0 - 0.1, 0.34, '#5a4a34', '#3a2f20');
          for (const dz of [-0.16, 0.16]) rod(0.5, dz, 2.1 * lvLen2, 0.16 * lvThick2, HB, '#3f474f');
          disc(2.15, 0, 0.24 * lvThick2, HB, '#2c333a');
        } else if (kind === 'gas') {
          box3(0, 0, 1.6, 1.5, H0, 0.56, '#697a55', '#47543a');
          disc(-0.5, -0.62, 0.34, H0 + 0.1, '#6a8a4a');               // 毒气罐 ×2
          disc(-0.5, 0.62, 0.34, H0 + 0.1, '#6a8a4a');
          rod(0.4, 0, 1.3 * lvLen2, 0.26 * lvThick2, HB, '#6a7a5a');
          disc(1.45, 0, 0.24, HB, '#2c333a');
          disc(1.62, 0, 0.30, HB, col);                               // 毒雾环
        } else { // mortar
          box3(0, 0, 1.5, 1.4, H0, 0.50, '#69737f', '#434b54');
          disc(0, 0, 0.9, H0 + 0.14, '#20242a');            // 座钣
          quad(-0.6, -0.55, 0.5, 0.4, H0 - 0.05, '#4a535c');
          quad(-0.6, 0.55, 0.5, 0.4, H0 - 0.05, '#4a535c');
          rod(0.3, 0, 2.0 * lvLen2, 0.2 * lvThick2, HB, '#3f474f');  // 短粗炮管
          rod(0.3, 0, 2.0, 0.07, HB + 0.05, col);
          disc(2.0, 0, 0.2, HB, '#20242a');
          disc(1.7, 0, 0.14, HB + 0.04, col);
        }


        const r0 = Math.max(2.0, z * 1.15);   // 屏幕上的炮塔半径（用于形态环与等级点）
        // 形态 A：再补一根并列炮管；形态 B：炮管加粗（3D 里是同样的处理）
        if (form === 'A' && kind !== 'mg') {
          const bore = { flamer: 1.9, flak: 2.9, tesla: 1.7, mortar: 2.1 }[kind] || 2.2;
          const wd = { flamer: 0.24, flak: 0.13, tesla: 0.08, mortar: 0.16 }[kind] || 0.12;
          for (const fz3 of [-0.45, 0.45]) {
            rod(0.45, fz3, bore, wd, HB - 0.02, '#3f474f');
          }
        } else if (form === 'B') {
          const bore2 = { mg: 2.9, flamer: 2.3, flak: 3.1, tesla: 1.9, mortar: 2.4 }[kind] || 2.5;
          rod(0.5, 0, bore2, { mg: 0.2, flamer: 0.36, flak: 0.24, tesla: 0.14, mortar: 0.28 }[kind] || 0.22,
            HB + 0.04, col);
        }

        // 选了形态：底座加一圈亮环
        if (form) {
          ctx.strokeStyle = 'rgba(255,212,121,0.75)';
          ctx.lineWidth = Math.max(1, z * 0.3);
          ctx.beginPath(); ctx.arc(p.x, p.y, r0 * 1.15, 0, 6.2832); ctx.stroke();
        }
        if (wlv2 >= 5) {
          box3(0.2, 0, 0.42, 0.5, H0 + 0.55, 0.26, '#b8c2cc', '#7c8894');
        }
        const lvDots = Math.min(5, w.level);
        for (let l = 0; l < lvDots; l++) {
          const a0 = -Math.PI / 2 + (l - (lvDots - 1) / 2) * 0.5;
          ctx.fillStyle = w.form ? '#ffd479' : '#ffe2a0';
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(a0) * r0 * 1.55, p.y + Math.sin(a0) * r0 * 1.55, Math.max(0.7, z * 0.28), 0, 6.2832);
          ctx.fill();
        }
      }
    }

    // 耐久条（明显受损才显示，避免满血时一排绿条糊在车顶）
    if (frac < 0.72) {
      const p = R.P(c.x, c.y, c.h + hgt + 7.0, {});
      // 屏幕尺寸上限：放大到 8 倍以上时不要变成一条巨型绿条
      const wbar = U.clamp(z * 20, 16, 62), bh = U.clamp(z * 1.8, 2.2, 3.4);
      ctx.fillStyle = 'rgba(0,0,0,0.68)';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(p.x - wbar / 2 - 1, p.y - 1, wbar + 2, bh + 2, 3) : ctx.rect(p.x - wbar / 2 - 1, p.y - 1, wbar + 2, bh + 2);
      ctx.fill();
      ctx.fillStyle = car.dead ? '#5a1f1f' : (frac < 0.35 ? '#e05a4a' : (frac < 0.65 ? '#e0b04a' : '#5fc47a'));
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(p.x - wbar / 2, p.y, wbar * Math.max(0, frac), bh, 2) : ctx.rect(p.x - wbar / 2, p.y, wbar * Math.max(0, frac), bh);
      ctx.fill();
    }
  }

  // ================= 主程序 =================
  const Game = Z.Game = {
    speedMul: 1, paused: false, acc: 0,

    boot: function () {
      const cv = document.getElementById('map');
      const R = new Renderer(cv);
      Z.R = R;
      Z.Meta.load();
      if (Z.Settings) { Z.Settings.load(); Z.Settings.apply(); }
      Z.World.generate(1717, 11870);   // 标题页背景
      const run = Z.Run;
      Z.UI.init(run);
      Z.UI.showStart();

      // ---- 输入（鼠标 + 触摸共用一套逻辑）----
      let drag = null, down = null;
      cv.style.touchAction = 'none';            // 手机上拖拽不要触发页面滚动/缩放

      function onDown(x, y) {
        down = { x: x, y: y };
        // 注意：这里**不能**立刻解除跟随，否则任何一次点击都会停住镜头
        drag = { x: x, y: y, sx: x, sy: y, moved: false };
      }
      function onMove(x, y) {
        if (!drag) return;
        if (!drag.moved) {
          if (Math.hypot(x - drag.sx, y - drag.sy) < 8) return;
          drag.moved = true;
          R.follow = false;                     // 只有拖动才切到自由视角
          cv.style.cursor = 'grabbing';
        }
        const dx = x - drag.x, dy = y - drag.y;
        drag.x = x; drag.y = y;
        R.cam.cx -= dx / R.z; R.cam.cy -= dy / (R.cosT * R.z);
      }
      function onUp(x, y) {
        const wasClick = drag && !drag.moved;
        if (wasClick) {
          const k = pickCar(R, run, x, y);
          if (k >= 0 && Z.UI.canOpenRefit()) Z.UI.openRefit(k);
        }
        drag = null; down = null; cv.style.cursor = '';
      }

      cv.addEventListener('mousedown', function (e) { onDown(e.clientX, e.clientY); });
      window.addEventListener('mousemove', function (e) { onMove(e.clientX, e.clientY); });
      window.addEventListener('mouseup', function (e) { onUp(e.clientX, e.clientY); });

      cv.addEventListener('touchstart', function (e) {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        onDown(t.clientX, t.clientY);
      }, { passive: true });
      cv.addEventListener('touchmove', function (e) {
        if (!drag || e.touches.length !== 1) return;
        const t = e.touches[0];
        onMove(t.clientX, t.clientY);
        if (e.cancelable) e.preventDefault();
      }, { passive: false });
      cv.addEventListener('touchend', function (e) {
        const t = e.changedTouches && e.changedTouches[0];
        if (t) onUp(t.clientX, t.clientY);
      }, { passive: true });
      cv.addEventListener('touchcancel', function () { drag = null; down = null; }, { passive: true });

      cv.addEventListener('wheel', function (e) {
        e.preventDefault();
        const before = R.screenToWorld(e.clientX, e.clientY);
        R.cam.zoom = U.clamp(R.cam.zoom * (e.deltaY < 0 ? 1.12 : 0.89), CFG.CAM.minZ, CFG.CAM.maxZ);
        R.compute();
        const after = R.screenToWorld(e.clientX, e.clientY);
        R.cam.cx += before.x - after.x; R.cam.cy += before.y - after.y;
      }, { passive: false });

      window.addEventListener('keydown', function (e) {
        const t = e.target && e.target.tagName;
        if (t === 'INPUT' || t === 'TEXTAREA') return;
        if (e.key === ' ') { e.preventDefault(); Game.togglePause(); }
        // 三选一是强制模态：数字键必须能选（此前只能鼠标，键盘玩家被卡住）
        else if ((e.key === '1' || e.key === '2' || e.key === '3') && run && run.offer) {
          const pick = run.offer[+e.key - 1];
          if (pick) Z.UI.takeCar(pick);
        }
        else if (e.key >= '1' && e.key <= '3') Game.setSpeed(+e.key);
        else if (e.key === 'Escape') Z.UI.closeTop();
        else if (e.key === 't' || e.key === 'T') { R.cam.tiltT = R.cam.tiltT > 0.1 ? 0 : CFG.CAM.tilt; }
        else if (e.key === 'g' || e.key === 'G') { R.showRanges = !R.showRanges; }
        else if (e.key === 'f' || e.key === 'F') { R.follow = true; }
        else if (e.key === 'm' || e.key === 'M') { const on = Z.Sound.toggle(); if (Z.UI) Z.UI.refreshSound(); Z.UI.toast(on ? '音效开' : '音效关', 'info'); }
        else if (e.key === 'Tab') { e.preventDefault(); Z.UI.toggleRefit(); }
        else {
          const k = e.key.toLowerCase();
          for (const s of CFG.SKILLS) if (s.key2.toLowerCase() === k) { Z.Skills.activate(run, s.key); }
        }
      });
      window.addEventListener('resize', function () { R.resize(); if (Z.UI) Z.UI.maybePortraitHint(); });
      // 手机竖屏提示：进局后由 UI 统一控制（只挡一次，可一键继续竖屏）
      setTimeout(function () {
        if (!Z.UI) return;
        Z.UI.maybePortraitHint();
        if (Z.Run.state !== 'run' && Z.Run.state !== 'station' && Z.Run.state !== 'parked') {
          const portrait = window.innerHeight > window.innerWidth * 1.1;
          if (portrait && Math.min(window.innerWidth, window.innerHeight) < 900) {
            Z.UI.toast('竖屏能玩，但横屏更好操作（旋转手机试试）', 'info');
          }
        }
      }, 2500);
      window.addEventListener('beforeunload', function () { if (Z.Save) Z.Save.save(run); });

      // ---- 循环 ----
      let last = performance.now();
      function frame(t) {
        requestAnimationFrame(frame);
        const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
        last = t;
        R.frame++;
        R.resize();
        R.cam.tilt = U.approach(R.cam.tilt, R.cam.tiltT, 7, dt);

        const running = (run.state === 'run' || run.state === 'parked') && !Game.paused && !run.offer;
        if (running) {
          Game.acc += dt * (Game.speedMul || 1);
          const step = CFG.TIME.fixed;
          let guard = 0;
          while (Game.acc >= step && guard++ < 10) {
            Game.acc -= step;
            try { run.tick(step); } catch (err) { console.error('TICK', err && err.stack || err); }
          }
          if (guard >= 10) Game.acc = 0;
          if (run.state === 'station') { run.board(dt * (run.boardSpeed || 1)); }
        } else if (run.state === 'station') {
          run.board(dt);
        }
        try { Fx.update(dt); } catch (e) { console.error(e); }

        if (R.follow && run.train) {
          const lay = run.train.layout(Z.World);
          const mid = lay[(lay.length / 2) | 0];
          if (mid) {
            const ahead = U.clamp((run.speed || 0) / CFG.TRAIN.maxSpeed, 0, 1) * CFG.CAM.lookAhead;
            const tx = mid.x + Math.cos(mid.a) * ahead, ty = mid.y + Math.sin(mid.a) * ahead;
            R.cam.cx = U.approach(R.cam.cx, tx, CFG.CAM.followRate, dt);
            R.cam.cy = U.approach(R.cam.cy, ty, CFG.CAM.followRate, dt);
          }
        }
        if (Z.Sound && Z.Sound.ctx) Z.Sound.rumble(run.train ? (run.speed || 0) / CFG.TRAIN.maxSpeed : 0);
        // 每 15 秒落一次盘（站台/停车/获得车厢另有即时落盘）
        if (running && Z.Save) {
          Game.saveAcc = (Game.saveAcc || 0) + dt;
          if (Game.saveAcc > 15) { Game.saveAcc = 0; Z.Save.save(run); }
        }
        R.compute();
        R.ox += Fx.shakeX; R.oy += Fx.shakeY;
        try {
          if (Z.World3D && Z.World3D.on) Z.World3D.render(run);
          else render(R, run);
        } catch (e) { console.error('RENDER', e && e.stack || e); }
        try { Z.UI.tick(dt); } catch (e) { console.error('UI', e && e.stack || e); }
      }
      requestAnimationFrame(frame);
    },

    startLevel: function (n) {
      const R = Z.R;
      const run = Z.Run;
      if (Z.Save) Z.Save.clear();
      run.start(n);
      if (Z.Save) Z.Save.save(run);
      // 镜头对准列车
      const lay = run.train.layout(Z.World);
      const mid = lay[(lay.length / 2) | 0];
      if (mid) { R.cam.cx = mid.x; R.cam.cy = mid.y; }
      R.cam.zoom = CFG.CAM.zoom; R.cam.tilt = R.cam.tiltT = CFG.CAM.tilt;
      R.follow = true; R.compute();
      Game.paused = false; Game.speedMul = 1; Game.acc = 0;
      if (Z.UI) Z.UI._pausedByRefit = false;
      Z.UI.hideScreen();
      Z.UI.showHUD(true);
    },
    startEndless: function () {
      const R = Z.R, run = Z.Run;
      run.startEndless();
      const lay = run.train.layout(Z.World);
      const mid = lay[(lay.length / 2) | 0];
      if (mid) { R.cam.cx = mid.x; R.cam.cy = mid.y; }
      R.cam.zoom = CFG.CAM.zoom; R.cam.tilt = R.cam.tiltT = CFG.CAM.tilt;
      R.follow = true; R.compute();
      Game.paused = false; Game.speedMul = 1; Game.acc = 0;
      if (Z.UI) Z.UI._pausedByRefit = false;
      Z.UI.hideScreen();
      Z.UI.showHUD(true);
    },
    continueRun: function () {
      const snap = Z.Save && Z.Save.get();
      if (!snap) { if (Z.UI) Z.UI.toast('没有可继续的存档', 'bad'); return; }
      const R = Z.R, run = Z.Run;
      run.restore(snap);
      const lay = run.train.layout(Z.World);
      const mid = lay[(lay.length / 2) | 0];
      if (mid) { R.cam.cx = mid.x; R.cam.cy = mid.y; }
      R.cam.zoom = CFG.CAM.zoom; R.cam.tilt = R.cam.tiltT = CFG.CAM.tilt;
      R.follow = true; R.compute();
      Game.paused = false; Game.speedMul = 1; Game.acc = 0;
      if (Z.UI) Z.UI._pausedByRefit = false;
      Z.UI.hideScreen();
      Z.UI.showHUD(true);
      if (run.state === 'station' && run.station) Z.UI.openStation(run.station);
      else Z.UI.closeStation();
      Z.UI.toast('已继续：第 ' + run.level + ' 关 · ' + (run.km / 1000).toFixed(1) + ' km', 'good');
    },
    togglePause: function () {
      if (Z.Run.state !== 'run' && Z.Run.state !== 'parked') return;
      if (Z.UI && Z.UI._pausedByRefit) { Z.UI.toast('改装面板开着，关掉面板再继续', 'info'); return; }
      if (Z.Run.offer) return;                       // 三选一期间模拟本来就冻结
      Game.paused = !Game.paused;
      if (Z.UI) Z.UI.refreshSpeeds();
    },
    setSpeed: function (n) {
      if (Z.Run.state !== 'run' && Z.Run.state !== 'parked') return;
      Game.speedMul = n;
      // 改装面板的暂停不能被倍速键偷偷解除：只改倍速，暂停状态交给面板生命周期
      if (!(Z.UI && Z.UI._pausedByRefit)) Game.paused = false;
      if (Z.UI) Z.UI.refreshSpeeds();
    },
    // 顶栏倍速合成一个按钮：3 个 32px 目标变成 1 个 44px 目标
    cycleSpeed: function () {
      const cur = Game.speedMul || 1;
      Game.setSpeed(cur >= 3 ? 1 : cur + 1);
    }
  };

  function pickCar(R, run, sx, sy) {
    if (!run.train) return -1;
    const lay = run.train.layout(Z.World);
    let best = -1, bd = 46;
    for (let k = 0; k < lay.length; k++) {
      const c = lay[k]; if (!c || !c.ok) continue;
      const p = R.P(c.x, c.y, c.h + CFG.TRAIN.heightM, {});
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  // ================= 渲染 =================
  function render(R, run) {
    const ctx = R.ctx, world = Z.World;
    R.camS = run.km;
    R.base();
    const g = ctx.createLinearGradient(0, 0, 0, R.h);
    g.addColorStop(0, '#0e1116'); g.addColorStop(0.35, '#191c20'); g.addColorStop(1, '#1d1d1a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, R.w, R.h);

    world.drawGround(ctx, R);
    world.drawProps(ctx, R);
    world.drawTrack(ctx, R);
    world.drawStations(ctx, R);
    drawTrackDamage(ctx, R, run);

    const drawables = [];
    for (const zb of Z.Zombies.list) {
      const p = R.P(zb.x, zb.y, 0, {});
      if (p.x < -40 || p.x > R.w + 40 || p.y < -40 || p.y > R.h + 60) continue;
      drawables.push({ y: p.y, zb: zb });
    }
    const lay = run.train ? run.train.layout(world) : [];
    for (let k = 0; k < lay.length; k++) {
      if (!lay[k].ok) continue;
      const p = R.P(lay[k].x, lay[k].y, 0, {});
      drawables.push({ y: p.y - 1, car: k });
    }
    drawables.sort(function (a, b) { return a.y - b.y; });
    for (const d of drawables) {
      if (d.zb) Z.Zombies.drawOne(ctx, R, d.zb);
      else drawCar(ctx, R, run, d.car, lay);
    }

    // 射程圈
    if (R.showRanges && run.cars) {
      for (let k = 0; k < run.cars.length; k++) {
        const car = run.cars[k]; if (!car || car.dead || !lay[k]) continue;
        for (let j = 0; j < car.slots.length; j++) {
          const w = car.slots[j]; if (!w) continue;
          const mp = run.train.slotPos(lay[k], j, {});
          const rr = w.range();
          ctx.strokeStyle = U.rgba(w.def().color, 0.42); ctx.lineWidth = 1.2;
          ctx.beginPath();
          for (let a = 0; a <= 28; a++) {
            const t = a / 28 * Math.PI * 2;
            const p = R.P(mp.x + Math.cos(t) * rr, mp.y + Math.sin(t) * rr, 0, {});
            if (a) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
          }
          ctx.stroke();
        }
      }
    }

    // 炮弹
    if (run.train) {
      for (const sh of run.train.shells) {
        const k = sh.t / sh.dur;
        const x = U.lerp(sh.sx != null ? sh.sx : sh.tx, sh.tx, k), y = U.lerp(sh.ty, sh.ty, k);
        const h = 2 + Math.sin(k * Math.PI) * 34;
        const p = R.P(x, y, h, {});
        ctx.fillStyle = '#ffe2a0';
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.6, R.z * 0.8), 0, 6.2832); ctx.fill();
      }
    }

    Fx.draw(ctx, R);
    R.base();
    if (world.pal && world.pal.fog) {
      ctx.fillStyle = world.pal.fog;
      ctx.fillRect(0, 0, R.w, R.h);
    }
    if (run.mods && run.mods.indexOf('rain') >= 0 && run.train) {
      Z.Lighting.rain(ctx, R, 1 / 60, 1);
    }
    Z.Lighting.draw(ctx, R, run);
    drawOverlay(ctx, R, run);
  }

  function drawTrackDamage(ctx, R, run) {
    if (!run.trackDamage || run.trackDamage < 5) return;
    const p = Z.U.posAt(Z.World.path, Z.U.clamp(run.km + 120, 0, Z.World.path.len), {});
    const q = R.P(p.x, p.y, p.h + 1.2, {});
    const a = Z.U.clamp(run.trackDamage / 100, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.4 + a * 0.5;
    ctx.strokeStyle = a > 0.7 ? '#ff7a3c' : '#e8b04a';
    ctx.lineWidth = Math.max(1.6, R.cam.zoom * 0.9);
    ctx.beginPath();
    const nx = -Math.sin(p.a), ny = Math.cos(p.a);
    for (const side of [-1, 1]) {
      const a1 = R.P(p.x + nx * 2.6 * side, p.y + ny * 2.6 * side, p.h + 0.8, {});
      const a2 = R.P(p.x + Math.cos(p.a) * 4 + nx * 3.6 * side, p.y + Math.sin(p.a) * 4 + ny * 3.6 * side, p.h + 0.8, {});
      ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawOverlay(ctx, R, run) {
    if (run.state === 'parked') {
      ctx.save();
      ctx.fillStyle = 'rgba(120,20,20,0.28)';
      ctx.fillRect(0, R.h * 0.42, R.w, 56);
      ctx.fillStyle = '#ffd9d9';
      ctx.font = '700 20px "PingFang SC",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('轨道被撬断 · 停车防守 ' + Math.max(0, Math.ceil(run.parkDur - run.parkT)) + ' 秒（修满自动出发）', R.w / 2, R.h * 0.42 + 35);
      ctx.restore();
    }
  }

  window.addEventListener('load', function () { Game.boot(); });
})(window.ZT);
