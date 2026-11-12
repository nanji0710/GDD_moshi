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

    // 侧面
    ctx.fillStyle = flash ? '#9fa8b4' : hull;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      if (corners[j].y - corners[i].y <= 0) continue;
      ctx.beginPath();
      ctx.moveTo(base[i].x, base[i].y); ctx.lineTo(base[j].x, base[j].y);
      ctx.lineTo(top[j].x, top[j].y); ctx.lineTo(top[i].x, top[i].y);
      ctx.closePath(); ctx.fill();
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

    // 车顶
    ctx.fillStyle = flash ? '#cfd6df' : roof;
    ctx.beginPath();
    ctx.moveTo(top[0].x, top[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(top[i].x, top[i].y);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = Math.max(1, z * 0.35);
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
        const r0 = Math.max(2.2, z * 1.15);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath(); ctx.arc(p.x, p.y, r0 * 1.3, 0, 6.2832); ctx.fill();
        ctx.fillStyle = w.def().color;
        ctx.beginPath(); ctx.arc(p.x, p.y, r0 * 0.58, 0, 6.2832); ctx.fill();
        const bx = mp.x + Math.cos(w.aim) * 6.2, by = mp.y + Math.sin(w.aim) * 6.2;
        const q = R.P(bx, by, mp.h, {});
        ctx.strokeStyle = '#20262c'; ctx.lineWidth = Math.max(1.6, z * 0.9);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        ctx.strokeStyle = w.def().color; ctx.lineWidth = Math.max(0.8, z * 0.42); ctx.stroke();
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

    // 耐久条（受损才显示）
    if (frac < 0.999) {
      const p = R.P(c.x, c.y, c.h + hgt + 3.2, {});
      const wbar = Math.max(18, z * 26), bh = Math.max(2.5, z * 2.4);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(p.x - wbar / 2, p.y, wbar, bh);
      ctx.fillStyle = car.dead ? '#5a1f1f' : (frac < 0.35 ? '#e05a4a' : (frac < 0.65 ? '#e0b04a' : '#5fc47a'));
      ctx.fillRect(p.x - wbar / 2, p.y, wbar * Math.max(0, frac), bh);
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

      // ---- 输入 ----
      let drag = null, down = null;
      cv.addEventListener('mousedown', function (e) {
        down = { x: e.clientX, y: e.clientY };
        // 注意：这里**不能**立刻解除跟随，否则任何一次点击都会停住镜头
        drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
      });
      window.addEventListener('mousemove', function (e) {
        if (!drag) return;
        if (!drag.moved) {
          if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
          drag.moved = true;
          R.follow = false;            // 只有拖动才切到自由视角
          cv.style.cursor = 'grabbing';
        }
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY;
        R.cam.cx -= dx / R.z; R.cam.cy -= dy / (R.cosT * R.z);
      });
      window.addEventListener('mouseup', function (e) {
        const wasClick = drag && !drag.moved;
        if (wasClick) {
          const k = pickCar(R, run, e.clientX, e.clientY);
          if (k >= 0 && Z.UI.canOpenRefit()) Z.UI.openRefit(k);
        }
        drag = null; down = null; cv.style.cursor = '';
      });
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
        else if (e.key >= '1' && e.key <= '3') Game.setSpeed(+e.key);
        else if (e.key === 'Escape') Z.UI.closeTop();
        else if (e.key === 't' || e.key === 'T') { R.cam.tiltT = R.cam.tiltT > 0.1 ? 0 : CFG.CAM.tilt; }
        else if (e.key === 'g' || e.key === 'G') { R.showRanges = !R.showRanges; }
        else if (e.key === 'f' || e.key === 'F') { R.follow = true; }
        else if (e.key === 'm' || e.key === 'M') { const on = Z.Sound.toggle(); Z.UI.toast(on ? '音效开' : '音效关', 'info'); }
        else if (e.key === 'Tab') { e.preventDefault(); Z.UI.toggleRefit(); }
        else {
          const k = e.key.toLowerCase();
          for (const s of CFG.SKILLS) if (s.key2.toLowerCase() === k) { Z.Skills.activate(run, s.key); }
        }
      });
      window.addEventListener('resize', function () { R.resize(); });
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
        try { render(R, run); } catch (e) { console.error('RENDER', e && e.stack || e); }
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
      Z.UI.hideScreen();
      Z.UI.showHUD(true);
      if (run.state === 'station' && run.station) Z.UI.openStation(run.station);
      else Z.UI.closeStation();
      Z.UI.toast('已继续：第 ' + run.level + ' 关 · ' + (run.km / 1000).toFixed(1) + ' km', 'good');
    },
    togglePause: function () {
      if (Z.Run.state !== 'run' && Z.Run.state !== 'parked') return;
      Game.paused = !Game.paused;
      if (Z.UI) Z.UI.refreshSpeeds();
    },
    setSpeed: function (n) {
      if (Z.Run.state !== 'run' && Z.Run.state !== 'parked') return;
      Game.speedMul = n; Game.paused = false;
      if (Z.UI) Z.UI.refreshSpeeds();
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
