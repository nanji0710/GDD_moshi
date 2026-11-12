'use strict';
// 能见度与天气：夜战/隧道用"黑暗层 + 挖洞光"实现，雨战用屏幕空间雨丝。
// 黑暗层画在离屏画布上再合成，避免每帧对主画布反复 clearRect + 叠加。
window.ZT = window.ZT || {};
(function (Z) {
  const CFG = Z.CFG;

  const L = Z.Lighting = {
    drops: null,
    t: 0,

    ensureDrops: function () {
      if (this.drops) return this.drops;
      const arr = [];
      for (let i = 0; i < 150; i++) {
        arr.push({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.9, l: 0.5 + Math.random() * 0.8 });
      }
      this.drops = arr;
      return arr;
    },

    // ---------- 黑暗 + 灯光 ----------
    draw: function (ctx, R, run) {
      const dark = run.darkness || 0;
      if (dark < 0.02) return;
      const cw = R.cv.width, ch = R.cv.height;
      let cv = R._dark;
      if (!cv) cv = R._dark = document.createElement('canvas');
      if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
      const g = cv.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cw, ch);
      g.fillStyle = 'rgba(3,5,11,' + (0.93 * dark).toFixed(3) + ')';
      g.fillRect(0, 0, cw, ch);
      g.globalCompositeOperation = 'destination-out';
      const glows = [];

      const k = R.dpr;
      const hole = function (wx, wy, wh, radius, strength) {
        const p = R.P(wx, wy, wh || 0, {});
        const r = Math.max(8, radius * R.z * k);
        const px = p.x * k, py = p.y * k;   // 离屏画布是设备像素
        if (px < -r || px > cw + r || py < -r || py > ch + r) return;
        const grd = g.createRadialGradient(px, py, 0, px, py, r);
        const s0 = strength == null ? 1 : strength;
        grd.addColorStop(0, 'rgba(255,255,255,' + s0 + ')');
        grd.addColorStop(0.55, 'rgba(255,255,255,' + (s0 * 0.55) + ')');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(px, py, r, 0, 6.2832); g.fill();
      };

      // 车灯（车头最亮，其余车厢小灯）
      if (run.train) {
        const lay = run.train.layout(Z.World);
        for (let i = 0; i < lay.length; i++) {
          const c = lay[i];
          if (!c || !c.ok) continue;
          const car = run.cars[i];
          if (!car || car.dead) continue;
          if (i === 0) {
            hole(c.fx, c.fy, 2.4, 210, 1);
            hole(c.x, c.y, 2.4, 46, 0.85);
          } else {
            hole(c.x, c.y, 2.2, 34, 0.7);
          }
        }
      }
      // 枪口 / 爆炸的瞬时照明
      const lights = Z.Fx.lights || [];
      for (let i = 0; i < lights.length; i++) {
        const li = lights[i];
        const f = 1 - li.t / li.life;
        if (f <= 0) continue;
        hole(li.x, li.y, 1.5, li.r, 0.9 * f);
      }
      // 废墟火堆
      const world = Z.World;
      if (world.ruins) {
        for (let i = 0; i < world.ruins.length; i++) {
          const b = world.ruins[i];
          if (!b.fire) continue;
          const p = R.P(b.x, b.y, 0, {});
          if (p.x < -80 || p.x > R.w + 80 || p.y < -80 || p.y > R.h + 80) continue;
          hole(b.x, b.y, 1.2, 22, 0.55);
        }
      }
      // 隧道顶灯：沿轨道每 46 m 一个光池，读起来才像"洞"
      if (run.mods && run.mods.indexOf('tunnel') >= 0 && run.train) {
        const P = Z.World.path;
        for (let s2 = run.km - 60; s2 < run.km + 720; s2 += 46) {
          if (s2 < 0 || s2 > P.len) continue;
          const pp = Z.U.posAt(P, s2, {});
          hole(pp.x, pp.y, 6.5, 30, 0.95);
          glows.push({ x: pp.x, y: pp.y, h: 6.5, r: 30 });
        }
      }
      // 站台灯
      if (run.station && world.stations && world.stations[run.stationIdx]) {
        const st = world.stations[run.stationIdx];
        const p = Z.U.posAt(world.path, st.s, {});
        hole(p.x, p.y, 4, 95, 0.95);
      }

      g.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(cv, 0, 0);
      ctx.restore();
      // 隧道顶灯的暖色光晕（在黑暗层之上，才有"灯"的实感）
      if (glows.length) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < glows.length; i++) {
          const gl = glows[i];
          const p = R.P(gl.x, gl.y, gl.h, {});
          const r = gl.r * R.z * 1.35;
          if (p.x < -r || p.x > R.w + r || p.y < -r || p.y > R.h + r) continue;
          const grd2 = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          grd2.addColorStop(0, 'rgba(255,214,150,0.22)');
          grd2.addColorStop(0.5, 'rgba(255,190,110,0.08)');
          grd2.addColorStop(1, 'rgba(255,180,90,0)');
          ctx.fillStyle = grd2;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832); ctx.fill();
        }
        ctx.restore();
      }

      // 隧道：上下压暗，制造"洞壁"
      if (run.mods && run.mods.indexOf('tunnel') >= 0) {
        ctx.save();
        ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
        const gh = ctx.createLinearGradient(0, 0, 0, R.h * 0.30);
        gh.addColorStop(0, 'rgba(0,0,0,0.95)'); gh.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gh; ctx.fillRect(0, 0, R.w, R.h * 0.30);
        const gb = ctx.createLinearGradient(0, R.h, 0, R.h * 0.68);
        gb.addColorStop(0, 'rgba(0,0,0,0.95)'); gb.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gb; ctx.fillRect(0, R.h * 0.68, R.w, R.h * 0.32);
        ctx.restore();
      }
    },

    // ---------- 雨 ----------
    rain: function (ctx, R, dt, intensity) {
      const drops = this.ensureDrops();
      const t = (this.t += dt);
      ctx.save();
      ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
      ctx.strokeStyle = 'rgba(176,196,214,' + (0.20 * intensity).toFixed(3) + ')';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        d.y += (0.55 + d.s) * dt * 1.25;
        d.x += dt * 0.06;
        if (d.y > 1.05) { d.y = -0.05; d.x = Math.random(); }
        if (d.x > 1.05) d.x -= 1.1;
        const x = d.x * R.w, y = d.y * R.h;
        ctx.moveTo(x, y);
        ctx.lineTo(x - 6 * d.l, y + 22 * d.l);
      }
      ctx.stroke();
      // 地面水光
      ctx.globalAlpha = 0.10 * intensity;
      ctx.fillStyle = '#141c26';
      ctx.fillRect(0, 0, R.w, R.h);
      ctx.restore();
      // 攒一层湿润感
      if (t > 1e6) this.t = 0;
    }
  };

  // Fx 侧登记瞬时光源
  if (Z.Fx) {
    Z.Fx.lights = Z.Fx.lights || [];
    const oldFlash = Z.Fx.flash.bind(Z.Fx);
    Z.Fx.flash = function (x, y, h, color, r) {
      this.lights.push({ x: x, y: y, r: 16, life: 0.12, t: 0 });
      if (this.lights.length > 40) this.lights.shift();
      return oldFlash(x, y, h, color, r);
    };
    const oldBoom = Z.Fx.boom.bind(Z.Fx);
    Z.Fx.boom = function (x, y, h, r) {
      this.lights.push({ x: x, y: y, r: 46, life: 0.5, t: 0 });
      if (this.lights.length > 40) this.lights.shift();
      return oldBoom(x, y, h, r);
    };
    const oldUpdate = Z.Fx.update.bind(Z.Fx);
    Z.Fx.update = function (dt) {
      const ls = this.lights || [];
      for (let i = ls.length - 1; i >= 0; i--) {
        ls[i].t += dt;
        if (ls[i].t >= ls[i].life) ls.splice(i, 1);
      }
      return oldUpdate(dt);
    };
  }
})(window.ZT);
