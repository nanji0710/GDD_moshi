'use strict';
// 地图与轨道：生成一条 11.6 km 的废土铁路走廊（轨道、河流与铁桥、废墟、树林、公路、车站）。
// 轨道用「控制点 → Catmull-Rom 加密 → 弧长参数化」生成，对应 city-and-metro/js/metro.js 的 rt.pts / rt.cum 结构。
window.ZT = window.ZT || {};
(function (Z) {
  const U = Z.U, CFG = Z.CFG;

  const CTRL = [
    [0, 0], [700, -40], [1400, 70], [2100, 230], [2800, 120], [3500, -70],
    [4300, -150], [5100, 40], [5900, 270], [6700, 310], [7500, 150],
    [8300, -90], [9100, -230], [9900, -120], [10700, 130], [11620, 190]
  ];

  const World = Z.World = {
    path: null,
    stations: [],
    river: null,
    ruins: [], trees: [], roads: [], wrecks: [],
    bridge: null,

    generate: function (seed, targetM, biome, lm, mods) {
      const rng = new U.Rng(seed || 20261112);
      this.pal = (CFG.PAL && CFG.PAL[biome]) || CFG.PAL.temperate;
      this.lm = lm || null;
      this.hills = [];
      // 按关卡里程缩放整条走廊（控制点等比放大 → 弧长近似等比）
      const BASE = 11870;
      const scale = targetM ? Math.max(0.35, targetM / BASE) : 1;
      // ---- 轨道 ----
      const ctrl = CTRL.map(function (p) { return { x: p[0] * scale, y: p[1] * scale }; });
      const raw = U.spline(ctrl, 3.0, false);
      const path0 = U.buildPath(raw.map(function (p) { return { x: p.x, y: p.y, h: 0 }; }));
      const total = path0.len;
      const brS0 = total * 0.140, brS1 = total * 0.166;
      const b0 = brS0 - 90, b1 = brS1 + 90;
      for (let i = 0; i < path0.pts.length; i++) {
        const s = path0.cum[i];
        let h = 3.2;
        if (s > brS0 && s < brS1) h = 13.2;
        else if (s >= b0 && s <= brS0) h = U.lerp(3.2, 13.2, U.smooth((s - b0) / (brS0 - b0)));
        else if (s >= brS1 && s <= b1) h = U.lerp(13.2, 3.2, U.smooth((s - brS1) / (b1 - brS1)));
        path0.pts[i].h = h;
      }
      this.path = path0;
      this.bridge = { s0: brS0, s1: brS1 };
      // 山体：位置固定，会挡住射界（重庆弯道关尤其多）
      const canyon = (mods || []).indexOf('canyon') >= 0;
      const hillN = canyon ? CFG.HILL.canyon : (biome === 'mountain' ? CFG.HILL.mountain : 0);
      for (let i = 0; i < hillN; i++) {
        const hs = rng.range(0.03, 0.97) * total;
        const hp = U.posAt(path0, Math.min(path0.len - 5, Math.max(5, hs)), {});
        const side = rng.chance(0.5) ? 1 : -1;
        const off = rng.range(CFG.HILL.offMin, CFG.HILL.offMax);
        const hnx = -Math.sin(hp.a), hny = Math.cos(hp.a);
        this.hills.push({
          x: hp.x + hnx * off * side, y: hp.y + hny * off * side,
          r: rng.range(CFG.HILL.rMin, CFG.HILL.rMax), h: rng.range(9, 24)
        });
      }

      // ---- 车站 ----
      const KM_TOTAL = 11.6;
      // 站台：按 STATION_AT 的比例落在里程上（最后一个 = 终点安全区）
      const NAMES = ['出发站', '中途站', '补给站', '安全点'];
      this.stations = CFG.STATION_AT.map(function (r, i, arr) {
        const last = i === arr.length - 1;
        return {
          idx: i, name: last ? '安全点' : NAMES[Math.min(i, NAMES.length - 2)],
          km: r * total / 1000, s: U.clamp(r, 0.02, 1) * total,
          wall: i === 0 || last, final: last, visited: false
        };
      });

      // ---- 河流（以铁桥为中心斜穿） ----
      const bp = U.posAt(this.path, (brS0 + brS1) / 2, {});
      const ang = bp.a + Math.PI / 2 + 0.42;
      const rc = [];
      for (let i = -8; i <= 8; i++) {
        const t = i * 190, bend = Math.sin(i * 0.55) * 55;
        rc.push({ x: bp.x + Math.cos(ang) * t + Math.cos(ang + Math.PI / 2) * bend, y: bp.y + Math.sin(ang) * t + Math.sin(ang + Math.PI / 2) * bend });
      }
      const halfW = 62;
      const left = [], right = [];
      for (let i = 0; i < rc.length; i++) {
        const a = rc[Math.max(0, i - 1)], b = rc[Math.min(rc.length - 1, i + 1)];
        const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l, ny = dx / l;
        const w = halfW * (0.82 + 0.18 * Math.sin(i * 1.3));
        left.push({ x: rc[i].x + nx * w, y: rc[i].y + ny * w });
        right.push({ x: rc[i].x - nx * w, y: rc[i].y - ny * w });
      }
      this.river = { center: rc, poly: left.concat(right.slice().reverse()), halfW: halfW };

      // ---- 沿线散布：按「沿弧长 × 横向偏移」的网格铺，保证同一个屏幕里始终有东西 ----
      this.ruins = []; this.trees = []; this.roads = []; this.wrecks = [];
      const p = {};
      // 城镇密度场：0=荒野 1=镇中心（用两个高斯团 + 车站附近加成）
      const townAt = function (u) {
        return Math.min(1,
          Math.exp(-Math.pow((u - 0.30) / 0.085, 2)) +
          Math.exp(-Math.pow((u - 0.585) / 0.075, 2)) * 0.9 +
          Math.exp(-Math.pow((u - 0.78) / 0.05, 2)) * 0.6);
      };
      const G = 44;
      for (let s = 0; s < total; s += G) {
        const u = s / total;
        const town = townAt(u);
        U.posAt(this.path, s, p);
        const onBridge = s > this.bridge.s0 - 30 && s < this.bridge.s1 + 30;
        if (onBridge) continue;
        const nx = -Math.sin(p.a), ny = Math.cos(p.a);
        for (let lat = -620; lat <= 620; lat += G) {
          if (Math.abs(lat) < 24) continue;                       // 铁路走廊留空
          if (rng.next() > 0.10 + town * 0.62) continue;
          const jx = rng.range(-14, 14), jy = rng.range(-14, 14);
          const x = p.x + nx * lat + jx, y = p.y + ny * lat + jy;
          if (this.inRiver(x, y)) continue;
          const tall = rng.chance(0.10 + town * 0.18);
          this.ruins.push({
            x: x, y: y,
            w: rng.range(10, tall ? 26 : 22), d: rng.range(9, tall ? 22 : 20),
            rot: rng.range(-0.6, 0.6) + p.a,
            h: tall ? rng.range(8, 20) : rng.range(3.2, 8.5),
            kind: tall ? 2 : (rng.chance(0.34) ? 1 : 0),
            fire: rng.chance(0.05), dmg: rng.next()
          });
        }
        // 树与电线杆
        for (let k = 0; k < 2; k++) {
          if (!rng.chance(0.5 - town * 0.25)) continue;
          const lat = (rng.chance(0.5) ? 1 : -1) * rng.range(40, 620);
          const x = p.x + nx * lat + rng.range(-12, 12), y = p.y + ny * lat + rng.range(-12, 12);
          if (this.inRiver(x, y)) continue;
          this.trees.push({ x: x, y: y, r: rng.range(2.4, 5.6), k: rng.int(0, 2) });
        }
        if (rng.chance(0.10)) {
          const side = rng.chance(0.5) ? 1 : -1, lat = side * rng.range(10, 46);
          this.wrecks.push({ x: p.x + nx * lat, y: p.y + ny * lat, a: p.a + rng.range(-1.2, 1.2), burnt: rng.chance(0.55) });
        }
      }
      // 公路：三条横穿走廊的破路
      for (let i = 0; i < 3; i++) {
        const s = U.lerp(total * 0.22, total * 0.86, i / 2);
        U.posAt(this.path, s, p);
        const ang = p.a + Math.PI / 2 + rng.range(-0.35, 0.35);
        const pts = [];
        for (let j = -6; j <= 6; j++) {
          const t = j * 140;
          pts.push({ x: p.x + Math.cos(ang) * t + rng.range(-18, 18), y: p.y + Math.sin(ang) * t + rng.range(-18, 18) });
        }
        this.roads.push({ pts: pts, w: rng.range(6, 9) });
      }
      return this;
    },

    // 视线遮挡：线段 A→B 是否被山体挡住（山体是圆的，终点附近不算）
    losBlocked: function (ax, ay, bx, by) {
      const hills = this.hills;
      if (!hills || !hills.length) return false;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy || 1;
      for (let i = 0; i < hills.length; i++) {
        const h = hills[i];
        const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5;
        if (Math.abs(h.x - mx) > h.r + 700 || Math.abs(h.y - my) > h.r + 700) continue;
        let t = ((h.x - ax) * dx + (h.y - ay) * dy) / len2;
        t = Math.max(0.05, Math.min(0.95, t));
        const px = ax + dx * t, py = ay + dy * t;
        const ddx = h.x - px, ddy = h.y - py;
        if (ddx * ddx + ddy * ddy < h.r * h.r) return true;
      }
      return false;
    },

    inRiver: function (x, y) {
      if (!this.river) return false;
      const poly = this.river.poly;
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
      }
      return inside;
    },

    nextStation: function (s) {
      for (let i = 0; i < this.stations.length; i++) if (this.stations[i].s > s + 0.5) return this.stations[i];
      return null;
    },
    onBridge: function (s) { return s > this.bridge.s0 && s < this.bridge.s1; },

    // ---------------- 绘制 ----------------
    drawGround: function (ctx, R) {
      const v = R.worldView();
      ctx.save();
      R.flat(ctx);
      // 地表：260 m 色块，做出被踩烂的荒地感
      const G = 260;
      const x0 = Math.floor(v.x0 / G) * G, x1 = Math.ceil(v.x1 / G) * G;
      const y0 = Math.floor(v.y0 / G) * G, y1 = Math.ceil(v.y1 / G) * G;
      for (let x = x0; x < x1; x += G) {
        for (let y = y0; y < y1; y += G) {
          const n = R.hashCell(x / G, y / G, 7);
          const pal = this.pal;
          ctx.fillStyle = U.mix(pal.g1, n > 0.62 ? pal.g2 : (n > 0.30 ? pal.g3 : pal.g4), Math.abs(n - 0.5) * 1.6);
          ctx.fillRect(x, y, G + 1, G + 1);
        }
      }
      // 地表的碎屑斑块（不再画成方块网格，避免像 UI 元素）
      ctx.globalAlpha = 0.55;
      for (let i = 0; i < 300; i++) {
        const cx = R.hashCell(i, 3, 11) * 14000 - 1200, cy = R.hashCell(i, 4, 13) * 1800 - 900;
        if (cx < v.x0 - 200 || cx > v.x1 + 200 || cy < v.y0 - 200 || cy > v.y1 + 200) continue;
        const w = 30 + R.hashCell(i, 5, 17) * 130, hgt = 16 + R.hashCell(i, 6, 19) * 70;
        ctx.fillStyle = this.pal.patch[i % 3];
        ctx.beginPath();
        ctx.ellipse(cx, cy, w, hgt, R.hashCell(i, 7, 23) * 3.14, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // 地表颗粒：一张离屏噪点图平铺，让荒地不再是纯色块
      if (!this._grain) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 96;
        const g2 = cv.getContext('2d');
        for (let i = 0; i < 260; i++) {
          const gx = Math.random() * 96, gy = Math.random() * 96;
          const r = 0.4 + Math.random() * 1.5;
          g2.fillStyle = Math.random() > 0.48 ? 'rgba(210,200,170,0.035)' : 'rgba(0,0,0,0.085)';
          g2.beginPath(); g2.arc(gx, gy, r, 0, 6.2832); g2.fill();
        }
        this._grain = ctx.createPattern(cv, 'repeat');
      }
      if (this._grain) {
        ctx.fillStyle = this._grain;
        ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
      }

      // 公路
      for (const rd of this.roads) {
        if (!R.pathVisible(rd.pts, 500)) continue;
        ctx.strokeStyle = '#22221d';
        ctx.lineWidth = rd.w + 4;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        R.traceWorld(ctx, rd.pts); ctx.stroke();
        ctx.strokeStyle = '#4c4a41';
        ctx.lineWidth = rd.w; ctx.stroke();
        ctx.strokeStyle = 'rgba(200,188,140,0.30)';
        ctx.lineWidth = 0.7;
        ctx.setLineDash([6, 10]); ctx.stroke(); ctx.setLineDash([]);
      }
      // 河流
      const rv = this.river;
      if (R.pathVisible(rv.poly, 800)) {
        ctx.fillStyle = '#1a303c';
        ctx.beginPath();
        ctx.moveTo(rv.poly[0].x, rv.poly[0].y);
        for (let i = 1; i < rv.poly.length; i++) ctx.lineTo(rv.poly[i].x, rv.poly[i].y);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(120,190,210,0.09)'; ctx.fill();
      }
      R.unflat(ctx);
    },

    drawProps: function (ctx, R) {
      const v = R.worldView();
      const tin = function (x, y, pad) { return x > v.x0 - pad && x < v.x1 + pad && y > v.y0 - pad && y < v.y1 + pad; };
      // 山体（画在地面之上、其它道具之下）
      if (this.hills && this.hills.length) {
        for (let i = 0; i < this.hills.length; i++) {
          const h = this.hills[i];
          if (!tin(h.x, h.y, h.r + 60)) continue;
          const b = R.P(h.x, h.y, 0, {});
          const t = R.P(h.x, h.y, h.h, {});
          const rr = h.r * R.z;
          ctx.fillStyle = 'rgba(0,0,0,0.34)';
          ctx.beginPath(); ctx.ellipse(b.x, b.y + rr * 0.08, rr * 1.0, rr * 0.42, 0, 0, 6.2832); ctx.fill();
          // 八层椭圆堆出体积（比单层圆盘更像山）
          for (let k = 0; k < 8; k++) {
            const fk = k / 7;
            const yy = b.y + (t.y - b.y) * fk;
            const r2 = rr * (1 - 0.42 * fk);
            ctx.fillStyle = 'rgb(' + Math.round(22 + fk * 30) + ',' + Math.round(26 + fk * 30) + ',' + Math.round(21 + fk * 24) + ')';
            ctx.beginPath(); ctx.ellipse(h.x * 0 + (b.x + (t.x - b.x) * fk), yy, r2, r2 * 0.4, 0, 0, 6.2832); ctx.fill();
          }
          ctx.fillStyle = 'rgba(140,156,126,0.20)';
          ctx.beginPath(); ctx.ellipse(t.x - rr * 0.22, t.y - rr * 0.04, rr * 0.44, rr * 0.16, 0, 0, 6.2832); ctx.fill();
        }
      }
      // 树
      R.flat(ctx);
      for (const t of this.trees) {
        if (!tin(t.x, t.y, 40)) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.38)';
        ctx.beginPath(); ctx.ellipse(t.x + 2.2, t.y + 2.8, t.r * 1.05, t.r * 0.8, 0, 0, 6.2832); ctx.fill();
        const col = this.pal.tree[t.k];
        // 树干
        ctx.strokeStyle = 'rgba(30,24,18,0.85)';
        ctx.lineWidth = Math.max(1, t.r * 0.28);
        ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(t.x, t.y + t.r * 0.5); ctx.stroke();
        // 树冠：底色 + 受光面
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, 6.2832); ctx.fill();
        ctx.fillStyle = U.mix(col, '#c8d8a8', 0.28);
        ctx.beginPath(); ctx.arc(t.x - t.r * 0.3, t.y - t.r * 0.32, t.r * 0.55, 0, 6.2832); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.beginPath(); ctx.arc(t.x + t.r * 0.28, t.y + t.r * 0.3, t.r * 0.6, 0, 6.2832); ctx.fill();
      }
      R.unflat(ctx);
      // 报废车
      for (const w of this.wrecks) {
        if (!tin(w.x, w.y, 40)) continue;
        const cos = Math.cos(w.a) * 2.6, sin = Math.sin(w.a) * 2.6;
        const cos2 = Math.cos(w.a) * 1.1, sin2 = Math.sin(w.a) * 1.1;
        const q = [
          { x: w.x - cos - cos2, y: w.y - sin - sin2 }, { x: w.x + cos - cos2, y: w.y + sin - sin2 },
          { x: w.x + cos + cos2, y: w.y + sin + sin2 }, { x: w.x - cos + cos2, y: w.y - sin + sin2 }
        ];
        this._quad(ctx, R, q, 1.2, w.burnt ? '#2b2724' : '#4a4238', w.burnt ? '#1f1c1a' : '#6a5f4e');
      }
      // 废墟
      this.drawLandmarks(ctx, R);
      for (const b of this.ruins) {
        if (!tin(b.x, b.y, 80)) continue;
        const ca = Math.cos(b.rot), sa = Math.sin(b.rot);
        const hw = b.w / 2, hd = b.d / 2;
        const loc = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
        const q = loc.map(function (p) { return { x: b.x + p[0] * ca - p[1] * sa, y: b.y + p[0] * sa + p[1] * ca }; });
        const wall = this.pal.wall[b.kind];
        const roof = this.pal.roof[b.kind];
        const hh = b.h * (b.dmg > 0.72 ? 0.42 : (b.dmg > 0.45 ? 0.78 : 1));
        this._quad(ctx, R, q, hh, wall, roof, b.fire, b.dmg);
        // 建筑碎屑：几颗确定性散落的小方块
        if (R.cam.zoom > 1.2) {
          for (let i = 0; i < 3; i++) {
            const hx = R.hashCell(Math.floor(b.x / 7), Math.floor(b.y / 7), i + 3);
            const hy = R.hashCell(Math.floor(b.x / 7), Math.floor(b.y / 7), i + 11);
            const dp = R.P(b.x + (hx - 0.5) * b.w * 1.9, b.y + (hy - 0.5) * b.d * 1.9, 0, {});
            ctx.fillStyle = i % 2 ? 'rgba(20,19,16,0.75)' : 'rgba(48,46,40,0.8)';
            ctx.fillRect(dp.x, dp.y, Math.max(1.2, R.cam.zoom * 0.6), Math.max(1, R.cam.zoom * 0.4));
          }
        }
      }
    },

    // 有高度的方块：底面 + 朝屏幕下方的侧墙 + 屋顶（2.5D 挤压）
    // 地标：一两个高体块，让每关有一眼能认出来的东西
    drawLandmarks: function (ctx, R) {
      const lm = this.lm;
      if (!lm || !this.path) return;
      if (Math.abs(lm.s * this.path.len - (R.camS || 0)) > 2200) return;
      const p = U.posAt(this.path, lm.s * this.path.len, {});
      const nx = -Math.sin(p.a), ny = Math.cos(p.a);
      const ox = p.x + nx * (lm.off || 100) * (lm.side || 1);
      const oy = p.y + ny * (lm.off || 100) * (lm.side || 1);
      const ax = Math.cos(p.a), ay = Math.sin(p.a);
      const wall = U.mix(this.pal.wall[2], '#6d7a86', 0.10);
      const roof = U.mix(this.pal.roof[2], '#8fa0ae', 0.16);
      const box = function (dx, dy, w, d, h, roof2) {
        const cx = ox + ax * dx + nx * dy, cy = oy + ay * dx + ny * dy;
        const hw = w / 2, hd = d / 2, ang = p.a;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const q = [
          { x: cx + ca * hw - sa * hd, y: cy + sa * hw + ca * hd },
          { x: cx - ca * hw - sa * hd, y: cy - sa * hw + ca * hd },
          { x: cx - ca * hw + sa * hd, y: cy - sa * hw - ca * hd },
          { x: cx + ca * hw + sa * hd, y: cy + sa * hw - ca * hd }
        ];
        Z.World._quad(ctx, R, q, h, wall, roof2 || roof, false, 0);
      };
      const t = lm.type || 'tower';
      if (t === 'tower') {
        box(0, 0, 26, 26, 46);
        box(0, 0, 12, 12, 62, U.mix(roof, '#a8b4c0', 0.12));
        const tip = R.P(ox, oy, 66, {});
        ctx.strokeStyle = 'rgba(200,205,210,0.55)';
        ctx.lineWidth = Math.max(1, R.z * 0.5);
        ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(tip.x, tip.y - R.z * 14); ctx.stroke();
      } else if (t === 'twin') {
        box(-24, 0, 18, 18, 38);
        box(24, 0, 18, 18, 34);
        // 连桥
        const a = R.P(ox - ax * 24, oy - ay * 24, 26, {});
        const b = R.P(ox + ax * 24, oy + ay * 24, 26, {});
        ctx.strokeStyle = 'rgba(170,178,186,0.5)';
        ctx.lineWidth = Math.max(1.4, R.z * 0.7);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      } else if (t === 'cluster') {
        box(-30, -14, 22, 18, 30);
        box(0, 12, 26, 24, 44);
        box(30, -6, 18, 20, 26);
        box(6, -26, 16, 14, 34);
      } else if (t === 'dome') {
        box(0, 0, 40, 40, 18);
        const c0 = R.P(ox, oy, 18, {});
        const rr = 15 * R.z;
        const grd = ctx.createRadialGradient(c0.x - rr * 0.3, c0.y - rr * 0.4, rr * 0.1, c0.x, c0.y, rr);
        grd.addColorStop(0, 'rgba(112,128,142,0.50)');
        grd.addColorStop(1, 'rgba(38,46,54,0.62)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.ellipse(c0.x, c0.y, rr, rr * 0.72, 0, 0, 6.2832); ctx.fill();
        const tip = R.P(ox, oy, 24, {});
        ctx.fillStyle = '#c8b070';
        ctx.beginPath(); ctx.arc(tip.x, tip.y, Math.max(1.5, R.z * 0.8), 0, 6.2832); ctx.fill();
      }
    },

    _quad: function (ctx, R, q, h, wallCol, roofCol, fire, dmg) {
      // 落地投影：沿光方向偏移一点，画在最底下（树有影子、楼没有 = 楼像贴纸）
      if (h > 1.2) {
        const sh = q.map(function (p) { return R.P(p.x + 2.4, p.y + 3.2, 0, {}); });
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.moveTo(sh[0].x, sh[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(sh[i].x, sh[i].y);
        ctx.closePath(); ctx.fill();
      }
      const b = [], t = [];
      for (let i = 0; i < 4; i++) {
        b.push(R.P(q[i].x, q[i].y, 0, {}));
        t.push(R.P(q[i].x, q[i].y, h, {}));
      }
      const Z = R.cam.zoom;
      if (h > 0.4) {
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4;
          if (q[j].y - q[i].y <= 0) continue;   // 只画法线朝下（可见）的侧面
          // 墙面：下暗上亮，做出被天光照到的体积
          const g = ctx.createLinearGradient(b[i].x, b[i].y, t[i].x, t[i].y);
          g.addColorStop(0, U.mix(wallCol, '#000000', 0.32));
          g.addColorStop(0.62, wallCol);
          g.addColorStop(1, U.mix(wallCol, '#ffffff', 0.15));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(b[i].x, b[i].y); ctx.lineTo(b[j].x, b[j].y);
          ctx.lineTo(t[j].x, t[j].y); ctx.lineTo(t[i].x, t[i].y);
          ctx.closePath(); ctx.fill();
          // 墙脚积灰：贴地处压暗，楼就不会「浮」在地上
          if (h > 3) {
            const fh = 0.18;
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            ctx.beginPath();
            ctx.moveTo(b[i].x, b[i].y); ctx.lineTo(b[j].x, b[j].y);
            ctx.lineTo(b[j].x + (t[j].x - b[j].x) * fh, b[j].y + (t[j].y - b[j].y) * fh);
            ctx.lineTo(b[i].x + (t[i].x - b[i].x) * fh, b[i].y + (t[i].y - b[i].y) * fh);
            ctx.closePath(); ctx.fill();
          }
          // 檐口：顶边一道亮线 + 底边暗线
          ctx.strokeStyle = 'rgba(255,255,255,0.10)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(t[i].x, t[i].y); ctx.lineTo(t[j].x, t[j].y); ctx.stroke();

          // 裂缝：破损的楼身上拉几道不规则暗线
          if (dmg != null && dmg > 0.22 && Z > 0.7) {
            const hs3 = R.hashCell(Math.floor(q[i].x / 5), Math.floor(q[i].y / 5), 77);
            const u0 = 0.18 + hs3 * 0.54;
            const px = b[i].x + (b[j].x - b[i].x) * u0, py = b[i].y + (b[j].y - b[i].y) * u0;
            const tx = t[i].x + (t[j].x - t[i].x) * u0, ty = t[i].y + (t[j].y - t[i].y) * u0;
            ctx.strokeStyle = 'rgba(4,4,5,0.55)';
            ctx.lineWidth = Math.max(1, Z * 0.32);
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            let cxp = tx, cyp = ty;
            for (let s2 = 1; s2 <= 4; s2++) {
              const k = s2 / 4;
              const jx = (R.hashCell(Math.floor(q[i].x / 5) + s2, Math.floor(q[i].y / 5), 91) - 0.5) * Math.max(2, Z * 3);
              cxp = tx + (px - tx) * k + jx;
              cyp = ty + (py - ty) * k;
              ctx.lineTo(cxp, cyp);
            }
            ctx.stroke();
            // 裂缝边上的亮线（断面的受光边）
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = Math.max(0.8, Z * 0.18);
            ctx.beginPath(); ctx.moveTo(tx + 1, ty); ctx.lineTo(cxp + 1, cyp); ctx.stroke();
          }

          // 窗户：只有够高、够近的楼才画，避免远景噪点
          if (h > 4 && Z > 0.9 && !(dmg != null && dmg > 0.62)) {
            const cols = h > 14 ? 3 : 2;
            const rows = h > 20 ? 3 : 2;
            const cw = 0.62 / cols, ch = 0.56 / rows;
            for (let cx = 0; cx < cols; cx++) {
              for (let ry = 0; ry < rows; ry++) {
                const u0 = 0.19 + cx * cw, u1 = u0 + cw * 0.52;
                const v0 = 0.26 + ry * ch, v1 = v0 + ch * 0.48;
                const x1 = b[i].x + (b[j].x - b[i].x) * u0, y1 = b[i].y + (b[j].y - b[i].y) * u0;
                const x2 = b[i].x + (b[j].x - b[i].x) * u1, y2 = b[i].y + (b[j].y - b[i].y) * u1;
                const tx1 = t[i].x + (t[j].x - t[i].x) * u0, ty1 = t[i].y + (t[j].y - t[i].y) * u0;
                const tx2 = t[i].x + (t[j].x - t[i].x) * u1, ty2 = t[i].y + (t[j].y - t[i].y) * u1;
                const q1 = { x: x1 + (tx1 - x1) * v0, y: y1 + (ty1 - y1) * v0 };
                const q2 = { x: x2 + (tx2 - x2) * v0, y: y2 + (ty2 - y2) * v0 };
                const q3 = { x: x2 + (tx2 - x2) * v1, y: y2 + (ty2 - y2) * v1 };
                const q4 = { x: x1 + (tx1 - x1) * v1, y: y1 + (ty1 - y1) * v1 };
                const hs = R.hashCell(Math.floor(q[i].x / 6) + cx * 13, Math.floor(q[i].y / 6) + ry * 29, 41);
                ctx.fillStyle = hs > 0.82 ? 'rgba(255,206,128,0.80)'
                  : (hs > 0.55 ? 'rgba(120,132,146,0.45)' : 'rgba(10,11,13,0.62)');
                ctx.beginPath();
                ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y);
                ctx.lineTo(q3.x, q3.y); ctx.lineTo(q4.x, q4.y);
                ctx.closePath(); ctx.fill();
              }
            }
          }
        }
      }
      // 屋顶：亮面渐变 + 边缘光
      const ty0 = Math.min(t[0].y, t[1].y, t[2].y, t[3].y);
      const ty1 = Math.max(t[0].y, t[1].y, t[2].y, t[3].y);
      ctx.beginPath();
      ctx.moveTo(t[0].x, t[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(t[i].x, t[i].y);
      ctx.closePath();
      const rg = ctx.createLinearGradient(0, ty0, 0, ty1);
      rg.addColorStop(0, U.mix(roofCol, '#ffffff', 0.24));
      rg.addColorStop(0.6, roofCol);
      rg.addColorStop(1, U.mix(roofCol, '#000000', 0.26));
      ctx.fillStyle = rg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,238,206,0.16)'; ctx.lineWidth = 1; ctx.stroke();
      // 女儿墙：内缩一圈的高光边，屋顶就有了厚度
      if (Z > 0.8) {
        const cx0 = (t[0].x + t[1].x + t[2].x + t[3].x) / 4;
        const cy0 = (t[0].y + t[1].y + t[2].y + t[3].y) / 4;
        const k2 = 0.86;
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = Math.max(1, R.cam.zoom * 0.5);
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const px = cx0 + (t[i].x - cx0) * k2, py = cy0 + (t[i].y - cy0) * k2;
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.closePath(); ctx.stroke();
      }

      // 屋顶设备：空调箱 / 水箱（只有大屋顶才画）
      if (Z > 0.75 && h > 7 && !(dmg != null && dmg > 0.62)) {
        const rp = function (u, v) {
          const ax = t[0].x + (t[1].x - t[0].x) * u, ay = t[0].y + (t[1].y - t[0].y) * u;
          const bx = t[3].x + (t[2].x - t[3].x) * u, by = t[3].y + (t[2].y - t[3].y) * u;
          return { x: ax + (bx - ax) * v, y: ay + (by - ay) * v };
        };
        const hs2 = R.hashCell(Math.floor(q[0].x / 9), Math.floor(q[0].y / 9), 61);
        const u0 = 0.28 + hs2 * 0.12, v0 = 0.26 + hs2 * 0.1;
        const p1 = rp(u0, v0), p2 = rp(u0 + 0.3, v0), p3 = rp(u0 + 0.3, v0 + 0.3), p4 = rp(u0, v0 + 0.3);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y);
        ctx.closePath();
        ctx.fillStyle = U.mix(roofCol, '#8b939b', 0.22);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1; ctx.stroke();
        // 一部分楼顶加水箱，剪影更有变化
        if (hs2 > 0.55) {
          const w1 = rp(u0 + 0.34, v0 + 0.04), w2 = rp(u0 + 0.46, v0 + 0.04);
          const wr = Math.max(1.2, Math.hypot(w2.x - w1.x, w2.y - w1.y));
          ctx.fillStyle = 'rgba(30,34,38,0.85)';
          ctx.beginPath(); ctx.arc(w1.x, w1.y - wr * 1.1, wr, 0, 6.2832); ctx.fill();
          ctx.fillStyle = 'rgba(120,132,142,0.7)';
          ctx.beginPath(); ctx.arc(w1.x, w1.y - wr * 1.25, wr * 0.75, 0, 6.2832); ctx.fill();
        }
      }
      // 破损：屋顶破洞 + 断柱/钢筋
      if (dmg != null && dmg > 0.35) {
        const nHole = dmg > 0.72 ? 2 : 1;
        for (let i = 0; i < nHole; i++) {
          const a0 = (i * 0.5 + 0.25) % 1;
          const hx = t[0].x + (t[1].x - t[0].x) * a0 + (t[2].x - t[1].x) * (0.3 + i * 0.2);
          const hy = t[0].y + (t[1].y - t[0].y) * a0 + (t[2].y - t[1].y) * (0.3 + i * 0.2);
          ctx.fillStyle = 'rgba(10,9,7,0.9)';
          ctx.beginPath();
          ctx.ellipse(hx, hy, Math.max(1.5, R.cam.zoom * (2.2 - i)), Math.max(1, R.cam.zoom * 1.2), 0.5, 0, 6.2832);
          ctx.fill();
        }
        if (dmg > 0.72) {
          ctx.strokeStyle = 'rgba(120,118,108,0.55)';
          ctx.lineWidth = Math.max(0.8, R.cam.zoom * 0.3);
          ctx.beginPath();
          for (let i = 0; i < 3; i++) {
            const bx = t[0].x + (t[2].x - t[0].x) * (0.25 + i * 0.22);
            const by = t[0].y + (t[2].y - t[0].y) * (0.25 + i * 0.22);
            ctx.moveTo(bx, by);
            ctx.lineTo(bx - 1, by - Math.max(2, R.cam.zoom * 1.6));
          }
          ctx.stroke();
        }
      }
      // 着火 + 冒烟：末世废墟的标志
      if (fire && R.cam.zoom > 0.55) {
        const T = performance.now() / 1000;
        const cx0 = (t[0].x + t[1].x + t[2].x + t[3].x) / 4;
        const cy0 = (t[0].y + t[1].y + t[2].y + t[3].y) / 4;
        const sc = Math.max(0.5, R.cam.zoom);
        // 地面火光
        ctx.globalAlpha = 0.16 + Math.sin(T * 6) * 0.03;
        ctx.fillStyle = '#ff8a3a';
        ctx.beginPath(); ctx.ellipse(cx0, cy0 + sc * 2, sc * 7, sc * 3, 0, 0, 6.2832); ctx.fill();
        // 火苗：三簇跳动的椭圆
        for (let i = 0; i < 3; i++) {
          const ph = (T * 1.6 + i * 0.7) % 1;
          const fx = cx0 + (i - 1) * sc * 2.2;
          const fy = cy0 - ph * sc * 4.5;
          ctx.globalAlpha = (1 - ph) * 0.75;
          ctx.fillStyle = i === 1 ? '#ffd479' : '#ff7a2a';
          ctx.beginPath();
          ctx.ellipse(fx, fy, sc * (1.4 - ph * 0.6), sc * (2.4 - ph * 1.1), 0, 0, 6.2832);
          ctx.fill();
        }
        // 烟柱：缓慢上升、逐渐扩散
        for (let i = 0; i < 4; i++) {
          const ph = (T * 0.28 + i * 0.25) % 1;
          ctx.globalAlpha = (1 - ph) * 0.24;
          ctx.fillStyle = i % 2 ? '#4a4a48' : '#5c5c58';
          ctx.beginPath();
          ctx.arc(cx0 + Math.sin(T * 0.9 + i) * sc * 1.4, cy0 - sc * (3 + ph * 16),
            sc * (1.6 + ph * 4.2), 0, 6.2832);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    },

    drawTrack: function (ctx, R) {
      const path = this.path;
      const camS = R.camS || 0;
      const half = 900 / R.cam.zoom + 500;
      const s0 = Math.max(0, camS - half), s1 = Math.min(path.len, camS + half);
      const tmp = {};
      const bed = [];
      for (let s = s0; s <= s1; s += 5) {
        U.posAt(path, s, tmp);
        bed.push({ x: tmp.x, y: tmp.y, h: tmp.h });
      }
      const z = R.cam.zoom;
      ctx.lineCap = 'butt'; ctx.lineJoin = 'round';

      // ===== 道砟梯形断面（和 3D 的 strip 层一一对应）=====
      ctx.strokeStyle = 'rgba(0,0,0,0.42)';                       // 路基阴影
      ctx.lineWidth = Math.max(4, z * 8.4);
      this._strokeH(ctx, R, bed, 0);
      ctx.strokeStyle = '#33302a';                                 // 底部宽 7.2 m
      ctx.lineWidth = Math.max(3, z * 7.2);
      this._strokeH(ctx, R, bed, 0.06);
      ctx.strokeStyle = '#3c3830';                                 // 肩部 5.6 m
      ctx.lineWidth = Math.max(2.4, z * 5.6);
      this._strokeH(ctx, R, bed, 0.18);
      ctx.strokeStyle = '#454037';                                 // 顶面 5.0 m
      ctx.lineWidth = Math.max(2, z * 5.0);
      this._strokeH(ctx, R, bed, 0.30);
      ctx.strokeStyle = '#2a2822';                                 // 轨间油污带
      ctx.lineWidth = Math.max(1, z * 1.8);
      this._strokeH(ctx, R, bed, 0.31);

      // ===== 枕木：0.62 m 间距，2.6 m 长（低倍率下自动降采样）=====
      const tieStep = Math.max(0.62, 2.2 / z);
      ctx.strokeStyle = '#575249';
      ctx.lineWidth = Math.max(1, z * 0.26);
      ctx.beginPath();
      for (let st = Math.ceil(s0 / tieStep) * tieStep; st <= s1; st += tieStep) {
        U.posAt(path, st, tmp);
        const nx = -Math.sin(tmp.a), ny = Math.cos(tmp.a);
        const a = R.P(tmp.x + nx * 1.3, tmp.y + ny * 1.3, tmp.h + 0.34, {});
        const b = R.P(tmp.x - nx * 1.3, tmp.y - ny * 1.3, tmp.h + 0.34, {});
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();

      // ===== 钢轨：轨距 1.435 m，工字断面（轨底 + 轨头）=====
      for (const side of [-1, 1]) {
        const lat = 0.7175 * side;
        const body = [], head = [];
        for (let ss = s0; ss <= s1; ss += 5) {
          U.posAt(path, ss, tmp);
          const nx = -Math.sin(tmp.a) * lat, ny = Math.cos(tmp.a) * lat;
          body.push({ x: tmp.x + nx, y: tmp.y + ny, h: tmp.h + 0.48 });
          head.push({ x: tmp.x + nx, y: tmp.y + ny, h: tmp.h + 0.62 });
        }
        if (body.length < 2) continue;
        ctx.strokeStyle = '#8c9199';                              // 轨腰/轨底
        ctx.lineWidth = Math.max(1.1, z * 0.16);
        this._strokeH(ctx, R, body, 0);
        ctx.strokeStyle = '#c9ced4';                              // 轨头亮面（车轮压出来）
        ctx.lineWidth = Math.max(0.9, z * 0.13);
        this._strokeH(ctx, R, head, 0);
      }

      // ===== 沿线服务土路 + 两道车辙（左侧 9~15.2 m）=====
      if (z > 0.35) {
        const roadL = [], roadR = [];
        const rutA = [], rutB = [];
        for (let ss = s0; ss <= s1; ss += 8) {
          U.posAt(path, ss, tmp);
          const nx = -Math.sin(tmp.a), ny = Math.cos(tmp.a);
          roadL.push({ x: tmp.x + nx * 15.2, y: tmp.y + ny * 15.2, h: tmp.h + 0.05 });
          roadR.push({ x: tmp.x + nx * 9.0, y: tmp.y + ny * 9.0, h: tmp.h + 0.05 });
          rutA.push({ x: tmp.x + nx * 12.65, y: tmp.y + ny * 12.65, h: tmp.h + 0.07 });
          rutB.push({ x: tmp.x + nx * 11.35, y: tmp.y + ny * 11.35, h: tmp.h + 0.07 });
        }
        if (roadL.length > 1) {
          ctx.fillStyle = '#3c3429';
          ctx.beginPath();
          ctx.moveTo(R.P(roadL[0].x, roadL[0].y, roadL[0].h, {}).x, R.P(roadL[0].x, roadL[0].y, roadL[0].h, {}).y);
          for (let i = 1; i < roadL.length; i++) { const q = R.P(roadL[i].x, roadL[i].y, roadL[i].h, {}); ctx.lineTo(q.x, q.y); }
          for (let i = roadR.length - 1; i >= 0; i--) { const q = R.P(roadR[i].x, roadR[i].y, roadR[i].h, {}); ctx.lineTo(q.x, q.y); }
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#2a251d';
          ctx.lineWidth = Math.max(0.8, z * 0.35);
          this._strokeH(ctx, R, rutA, 0);
          this._strokeH(ctx, R, rutB, 0);
        }
      }


      // 桥面：在轨道下面铺一层钢板，让"桥"读得出来
      if (s1 > this.bridge.s0 - 200 && s0 < this.bridge.s1 + 200) {
        const L = [], Rt = [];
        for (let s = this.bridge.s0 - 6; s <= this.bridge.s1 + 6; s += 12) {
          const ss = U.clamp(s, 0, path.len);
          U.posAt(path, ss, tmp);
          const nx = -Math.sin(tmp.a) * 5.6, ny = Math.cos(tmp.a) * 5.6;
          L.push(R.P(tmp.x + nx, tmp.y + ny, tmp.h + 0.02, {}));
          Rt.push(R.P(tmp.x - nx, tmp.y - ny, tmp.h + 0.02, {}));
        }
        if (L.length > 1) {
          ctx.fillStyle = '#2f343a';
          ctx.beginPath();
          ctx.moveTo(L[0].x, L[0].y);
          for (let i = 1; i < L.length; i++) ctx.lineTo(L[i].x, L[i].y);
          for (let i = Rt.length - 1; i >= 0; i--) ctx.lineTo(Rt[i].x, Rt[i].y);
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = 'rgba(150,160,170,0.35)';
          ctx.lineWidth = Math.max(1, z * 0.5);
          ctx.beginPath();
          ctx.moveTo(L[0].x, L[0].y);
          for (let i = 1; i < L.length; i++) ctx.lineTo(L[i].x, L[i].y);
          ctx.stroke();
        }
      }
      // 桥墩与栏杆
      if (s1 > this.bridge.s0 - 200 && s0 < this.bridge.s1 + 200) {
        ctx.strokeStyle = '#3a3d42';
        ctx.lineWidth = Math.max(2, z * 3.4);
        ctx.beginPath();
        for (let s = this.bridge.s0; s <= this.bridge.s1; s += 24) {
          U.posAt(path, s, tmp);
          const nx = -Math.sin(tmp.a), ny = Math.cos(tmp.a);
          for (const side of [-1, 1]) {
            const a = R.P(tmp.x + nx * 5.4 * side, tmp.y + ny * 5.4 * side, tmp.h, {});
            const b = R.P(tmp.x + nx * 5.4 * side, tmp.y + ny * 5.4 * side, -3, {});
            ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
          }
        }
        ctx.stroke();
        // 桁架：两侧 X 形斜撑 + 上弦杆
        ctx.strokeStyle = 'rgba(96,102,110,0.9)';
        ctx.lineWidth = Math.max(1, z * 0.55);
        ctx.beginPath();
        const q1 = {}, q2 = {};
        for (let s = this.bridge.s0; s < this.bridge.s1 - 24; s += 24) {
          for (const side of [-1, 1]) {
            U.posAt(path, s, q1); U.posAt(path, s + 24, q2);
            const n1x = -Math.sin(q1.a) * 5.4 * side, n1y = Math.cos(q1.a) * 5.4 * side;
            const n2x = -Math.sin(q2.a) * 5.4 * side, n2y = Math.cos(q2.a) * 5.4 * side;
            const a0 = R.P(q1.x + n1x, q1.y + n1y, q1.h + 0.6, {});
            const a1 = R.P(q1.x + n1x, q1.y + n1y, q1.h + 5.2, {});
            const b0 = R.P(q2.x + n2x, q2.y + n2y, q2.h + 0.6, {});
            const b1 = R.P(q2.x + n2x, q2.y + n2y, q2.h + 5.2, {});
            ctx.moveTo(a0.x, a0.y); ctx.lineTo(b1.x, b1.y);
            ctx.moveTo(a1.x, a1.y); ctx.lineTo(b0.x, b0.y);
            ctx.moveTo(a1.x, a1.y); ctx.lineTo(b1.x, b1.y);
          }
        }
        ctx.stroke();
        // 桥面边缘亮线
        ctx.strokeStyle = 'rgba(210,205,185,0.22)';
        ctx.lineWidth = Math.max(1, z * 0.7);
        ctx.beginPath();
        for (const side of [-1, 1]) {
          for (let s = this.bridge.s0; s <= this.bridge.s1; s += 24) {
            U.posAt(path, s, tmp);
            const p = R.P(tmp.x - Math.sin(tmp.a) * 5.4 * side, tmp.y + Math.cos(tmp.a) * 5.4 * side, tmp.h + 0.4, {});
            if (s === this.bridge.s0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
          }
        }
        ctx.stroke();
      }
    },

    _strokeH: function (ctx, R, list, dh) {
      if (list.length < 2) return;
      ctx.beginPath();
      const p = {};
      R.P(list[0].x, list[0].y, list[0].h + dh, p);
      ctx.moveTo(p.x, p.y);
      for (let i = 1; i < list.length; i++) { R.P(list[i].x, list[i].y, list[i].h + dh, p); ctx.lineTo(p.x, p.y); }
      ctx.stroke();
    },

    drawStations: function (ctx, R) {
      const z = R.cam.zoom, tmp = {};
      for (const st of this.stations) {
        if (Math.abs(st.s - (R.camS || 0)) > 1400 / z + 700) continue;
        U.posAt(this.path, st.s, tmp);
        const nx = -Math.sin(tmp.a), ny = Math.cos(tmp.a);
        const along = function (d) { return { x: tmp.x + Math.cos(tmp.a) * d, y: tmp.y + Math.sin(tmp.a) * d }; };
        // 双侧站台
        for (const side of [-1, 1]) {
          const q = [];
          for (const d of [-17, 17]) {
            const a = along(d);
            for (const o of [3.2, 8.6]) q.push({ x: a.x + nx * o * side, y: a.y + ny * o * side });
          }
          this._quad(ctx, R, [q[0], q[1], q[3], q[2]], 1.2, '#4a4a42', st.visited ? '#5e5d50' : '#6a6858');
        }
        // 站牌
        const sign = R.P(tmp.x + nx * 26, tmp.y + ny * 26, 0, {});
        ctx.save();
        ctx.font = '600 ' + U.clamp(12 * z * 0.5, 11, 19) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const tw = ctx.measureText(st.name).width;
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        ctx.fillRect(sign.x - tw / 2 - 7, sign.y - 11, tw + 14, 21);
        ctx.fillStyle = st.final ? '#ffd479' : (st.wall ? '#9fe0b0' : '#dedcd2');
        ctx.fillText(st.name, sign.x, sign.y - 1);
        ctx.restore();
        // 避难所围墙
        if (st.wall) {
          ctx.strokeStyle = '#55554c';
          ctx.lineWidth = Math.max(3, z * 5);
          ctx.beginPath();
          for (const side of [-1, 1]) {
            const a = along(28);
            const p0 = R.P(a.x + nx * 34 * side, a.y + ny * 34 * side, 0, {});
            const p1 = R.P(a.x + nx * 34 * side, a.y + ny * 34 * side, 10, {});
            const p2 = R.P(a.x + Math.cos(tmp.a) * 46 + nx * 34 * side, a.y + Math.sin(tmp.a) * 46 + ny * 34 * side, 10, {});
            ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
          }
          ctx.stroke();
        }
      }
    }
  };
})(window.ZT);
