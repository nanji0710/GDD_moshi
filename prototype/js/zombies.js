'use strict';
// 丧尸：生成导演（随关卡密度递增、停车时 ×2.2）+ 个体行为（逼近车厢、啃咬、撬轨）+ 绘制。
window.ZT = window.ZT || {};
(function (Z) {
  const U = Z.U, CFG = Z.CFG, Fx = Z.Fx;

  const Zombies = Z.Zombies = {
    list: [],
    spawnAcc: 0,
    groupCd: 8,
    reset: function () { this.list.length = 0; this.spawnAcc = 0; this.groupCd = 8; },
    countAlive: function () { let n = 0; for (const z of this.list) if (!z.dead) n++; return n; },

    make: function (x, y, opt) {
      opt = opt || {};
      const lv = (Z.Run && Z.Run.level) || 1;
      const hpMul = 1 + 0.30 * (lv - 1);
      const atkMul = 1 + 0.12 * (lv - 1);
      const kind = opt.kind || 'walker';
      const base = { walker: 1, runner: 0.72, climber: 1.3, ripper: 1.45, spitter: 1.05, screamer: 0.85, bloater: 1.7 }[kind] || 1;
      let hp = CFG.ZOMBIE.hp * hpMul * base * (0.9 + Math.random() * 0.22);
      let speed = { walker: 6.0, runner: 13.0, climber: 7.5, ripper: 8.5, spitter: 5.0, screamer: 7.0, bloater: 4.5 }[kind] || 6.0;
      const lvDef = (Z.Run && Z.Run.levelDef) || null;
      if (kind === 'runner' && lvDef && (lvDef.mods || []).indexOf('straight') >= 0) speed *= 1.3;
      let atk = CFG.ZOMBIE.attack * atkMul;
      if (opt.elite) { hp *= CFG.ZOMBIE.eliteHpMul; atk *= CFG.ZOMBIE.eliteAtkMul; speed *= 0.85; }
      if (opt.boss) { hp = 600 * hpMul * 2.2 * (lv <= 2 ? 0.5 : 1); atk *= 2.4; speed *= 0.72; }
      if (opt.mini) { hp = CFG.PARK.miniBossHp * hpMul; atk *= 1.6; speed *= 0.8; }
      return {
        x: x, y: y, hp: hp, maxHp: hp, speed: speed, attack: atk,
        kind: kind, elite: !!opt.elite, boss: !!opt.boss, mini: !!opt.mini,
        dead: false, deadT: 0, flash: 0, cd: Math.random() * 0.7, retarget: Math.random() * 0.4,
        target: null, phase: Math.random() * 6.28, ripT: 0
      };
    },

    // ---------------- 导演 ----------------
    update: function (dt, run) {
      const W = Z.World, P = W.path;
      const L = run.levelDef || CFG.LEVELS[0];
      if (run.state === 'run' || run.state === 'parked') {
        const parked = run.state === 'parked';
        const alive = this.countAlive();
        const cap = CFG.ZOMBIE.maxAliveBase + CFG.ZOMBIE.maxAlivePerLevel * (run.level - 1);
        let rate = (L.dens / 90) * 3.4 * (parked ? CFG.PARK.spawnMul : 1);
        if (run.mods && run.mods.indexOf('bridge') >= 0 && Z.World.onBridge(run.km)) rate *= CFG.BRIDGE.spawnMul;
        if (run.straight) rate *= CFG.STRAIGHT.rateMul;
        this.spawnAcc += dt * rate;
        let made = 0;
        while (this.spawnAcc >= 1 && alive + made < cap && made < 24) {
          this.spawnAcc -= 1; this.spawnOne(run); made++;
        }
        if (this.spawnAcc > 4) this.spawnAcc = 4;
        // 成组：每 20–30 秒一波
        this.groupCd -= dt;
        if (this.groupCd <= 0 && !parked) {
          this.groupCd = CFG.WAVE.baseInterval - CFG.WAVE.intervalPerLevel * (run.level - 1);
          this.groupCd = Math.max(CFG.WAVE.minInterval, this.groupCd) * (0.8 + Math.random() * 0.5);
          this.spawnGroup(run, Math.round(8 + run.level * 2));
        }
      }

      const cars = run.train ? run.train.layout(W) : [];
      for (let i = this.list.length - 1; i >= 0; i--) {
        const zb = this.list[i];
        if (zb.dead) { zb.deadT += dt; if (zb.deadT > 3.4) this.list.splice(i, 1); continue; }
        zb.flash = Math.max(0, zb.flash - dt * 4);
        zb.cd -= dt; zb.retarget -= dt;
        if (zb.retarget <= 0 || !zb.target || zb.target.car.dead) {
          zb.retarget = 0.45 + Math.random() * 0.3;
          let best = null, bd = Infinity;
          for (const c of cars) {
            if (!c || !c.car || c.car.dead) continue;
            const d = (c.x - zb.x) * (c.x - zb.x) + (c.y - zb.y) * (c.y - zb.y);
            if (d < bd) { bd = d; best = c; }
          }
          zb.target = best;
        }
        const tgt = zb.target;
        if (!tgt) continue;
        const dx = tgt.x - zb.x, dy = tgt.y - zb.y;
        const dist = Math.hypot(dx, dy);
        const reach = CFG.TRAIN.carLenM * 0.5 + 2.4;
        // 撬轨者：贴近（34 m）就拆轨道，不咬车
        if (zb.kind === 'ripper') {
          if (dist < 34) {
            zb.ripT += dt;
            run.ripTrack(CFG.PARK.ripPerSec * 0.55 * dt);
            if (Math.floor(zb.ripT) !== Math.floor(zb.ripT - dt)) Fx.text(zb.x, zb.y, 1.6, '撬轨', '#ff9a5a');
            if (dist < reach) { /* 顺便也咬一口 */ }
            continue;
          }
        }
        if (dist > reach) {
          // 预判：按"我跑到那儿要多久"，瞄列车届时的位置（最多预判 2 秒）
          const lead = Math.min(2.0, dist / Math.max(0.1, zb.speed));
          const dirS = run.speed || 0;
          const aimX = tgt.x + Math.cos(tgt.a || 0) * dirS * lead * 0.85;
          const aimY = tgt.y + Math.sin(tgt.a || 0) * dirS * lead * 0.85;
          let ax = aimX - zb.x, ay = aimY - zb.y;
          const alen = Math.hypot(ax, ay) || 1;
          zb.x += ax / alen * zb.speed * dt;
          zb.y += ay / alen * zb.speed * dt;
          zb.phase += dt * (3.2 + zb.speed * 0.4);
        } else if (zb.cd <= 0) {
          zb.cd = 1 / CFG.ZOMBIE.attackRate;
          zb.phase += 1.2;
          const car = tgt.car;
          if (car && !car.dead) {
            let dmg = zb.attack;
            // 装甲车厢替相邻车厢吸收 40%
            const idx = run.cars.indexOf(car);
            for (const k of [idx - 1, idx + 1]) {
              const nb = run.cars[k];
              if (nb && !nb.dead && nb.type === 'armor') { dmg *= 1 - CFG.CAR_TYPES.armor.adjacentGuard; break; }
            }
            if (Z.Sound) Z.Sound.play('claw', { vol: 0.45 });
            Fx.shake = Math.min(1, Fx.shake + 0.05);
            Fx.text(tgt.x, tgt.y, 3.6, '-' + Math.round(dmg), '#ff8f8f');
            run.damageCar(car, dmg);
            if (car.dead) {
              if (Z.Sound) Z.Sound.play('boom', { vol: 0.8 });
              Fx.boom(tgt.x, tgt.y, 2.2, 10);
            }
          }
        }
      }
      // 离场清理
      const mid = cars[(cars.length / 2) | 0];
      if (mid) {
        for (let i = this.list.length - 1; i >= 0; i--) {
          const zb = this.list[i];
          if (zb.dead || zb.boss) continue;
          if (Math.hypot(zb.x - mid.x, zb.y - mid.y) > 900) this.list.splice(i, 1);
        }
      }
    },

    spawnOne: function (run) {
      const W = Z.World, P = W.path, s = run.km;
      let sp, lat;
      const r = Math.random();
      if (r < 0.6) sp = s + 80 + Math.random() * 260;
      else if (r < 0.85) sp = s - 40 - Math.random() * 200;
      else sp = s + (Math.random() - 0.5) * 140;
      lat = Math.random() < 0.6 ? (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 34)
        : (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 140);
      // 铁桥：两侧没有地面，只能贴着轨道来
      if (Z.World.onBridge(run.km) || Z.World.onBridge(sp)) {
        lat = (Math.random() < 0.5 ? -1 : 1) * (2.5 + Math.random() * CFG.BRIDGE.latMax);
        sp = Math.random() < 0.5 ? s + 90 + Math.random() * 240 : s - 60 - Math.random() * 180;
      }
      const p = U.posAt(P, U.clamp(sp, 6, P.len - 6), {});
      const nx = -Math.sin(p.a), ny = Math.cos(p.a);
      const lv = run.levelDef || CFG.LEVELS[0];
      const roll = Math.random();
      let kind = 'walker';
      if (run.straight && Math.random() < CFG.STRAIGHT.runnerChance) {
        // 长直道：正面高速冲过来的冲锋者
        kind = 'runner';
        sp = s + CFG.STRAIGHT.aheadMin + Math.random() * (CFG.STRAIGHT.aheadMax - CFG.STRAIGHT.aheadMin);
        lat = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 9);
      } else if (roll > 0.92) kind = 'runner';
      else if (roll > 0.86) kind = 'bloater';
      else if (roll > 0.80) kind = 'spitter';
      else if (roll > 0.75) kind = 'screamer';
      else if (roll > 0.70) kind = 'climber';
      if (run.level >= 3 && Math.random() < 0.06) kind = 'ripper';
      const zb = this.make(p.x + nx * lat, p.y + ny * lat, { kind: kind, elite: Math.random() < (lv.elite || 0.02) });
      this.list.push(zb);
    },

    spawnGroup: function (run, n) {
      const W = Z.World, P = W.path;
      const sBase = Math.min(P.len - 20, run.km + 180 + Math.random() * 160);
      for (let i = 0; i < n; i++) {
        const p = U.posAt(P, U.clamp(sBase + (Math.random() - 0.5) * 120, 6, P.len - 6), {});
        const nx = -Math.sin(p.a), ny = Math.cos(p.a);
        let lat = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 40);
        if (Z.World.onBridge(run.km) || Z.World.onBridge(sBase)) lat = (Math.random() < 0.5 ? -1 : 1) * (2.5 + Math.random() * CFG.BRIDGE.latMax);
        this.list.push(this.make(p.x + nx * lat, p.y + ny * lat, { elite: Math.random() < 0.08 }));
      }
    },

    spawnMiniBossChance: function (run, chance) {
      if (Math.random() > chance) return false;
      const W = Z.World, P = W.path;
      const p = U.posAt(P, U.clamp(run.km + 90, 6, P.len - 6), {});
      const nx = -Math.sin(p.a), ny = Math.cos(p.a);
      const zb = this.make(p.x + nx * 20, p.y + ny * 20, { mini: true, kind: 'clot' });
      this.list.push(zb);
      if (Z.UI) Z.UI.toast('小 Boss 出现：血块巨尸', 'bad');
      return true;
    },

    spawnBoss: function (run, kind) {
      const W = Z.World, P = W.path;
      const p = U.posAt(P, U.clamp(run.km + 140, 6, P.len - 6), {});
      const nx = -Math.sin(p.a), ny = Math.cos(p.a);
      if (Z.Sound) Z.Sound.play('roar');
      if (Z.Tips) Z.Tips.tip('boss');
      const zb = this.make(p.x + nx * 16, p.y + ny * 16, { boss: true, kind: kind || 'armor' });
      zb.kind = kind || 'armor';
      this.list.push(zb);
      return zb;
    },

    // ---------------- 绘制 ----------------
    drawOne: function (ctx, R, zb) {
      const z = R.cam.zoom, p = {};
      const dead = zb.dead;
      const k = dead ? U.clamp(zb.deadT / 3.2, 0, 1) : 0;
      R.P(zb.x, zb.y, 0, p);
      if (p.x < -40 || p.x > R.w + 40 || p.y < -40 || p.y > R.h + 60) return;
      const big = zb.boss ? 2.6 : (zb.mini ? 1.9 : (zb.elite ? 1.45 : 1));
      const r = Math.max(3.6, 1.85 * z * big);
      ctx.globalAlpha = dead ? (1 - k) * 0.9 : 1;
      // 影子
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 1.05, r * 0.5, 0, 0, 6.2832); ctx.fill();
      if (dead) {
        ctx.fillStyle = 'rgba(96,20,20,0.55)';
        ctx.beginPath(); ctx.ellipse(p.x, p.y - r * 0.15, r * 1.5 * (0.6 + k), r * 0.6 * (0.6 + k), 0, 0, 6.2832); ctx.fill();
        ctx.fillStyle = '#3a2b2b';
        ctx.beginPath(); ctx.ellipse(p.x, p.y - r * 0.2, r * 0.9, r * 0.4, 0.3, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }
      const bodyCol = zb.boss ? '#7a5c8a' : (zb.mini ? '#8a5a4a' : (zb.elite ? '#6d7d45' : (zb.kind === 'runner' ? '#6a7a58' : (zb.kind === 'spitter' ? '#5f7a4a' : (zb.kind === 'bloater' ? '#6a6a4a' : '#55684f')))));
      const flash = zb.flash > 0.35;
      const cloth = flash ? '#ffffff' : bodyCol;
      const headCol = flash ? '#ffffff' : (zb.boss ? '#9a7aaa' : (zb.elite ? '#7d8a4e' : '#5a6350'));
      // 走路：上下起伏 + 冲锋者前倾
      const bob = Math.sin(zb.phase * 2) * r * 0.10;
      const lean = zb.kind === 'runner' ? 0.14 : (zb.kind === 'bloater' ? -0.05 : 0);
      const cy = p.y - r * 0.95 + bob;
      const hy = p.y - r * 1.95 + bob;
      const wob = Math.sin(zb.phase) * 0.18 * r;
      const legSw = Math.sin(zb.phase * 2) * r * 0.34;

      // 腿：左右交替，走路有节奏
      ctx.strokeStyle = 'rgba(10,12,10,0.85)';
      ctx.lineWidth = Math.max(1.2, r * 0.30);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x - r * 0.18, p.y - r * 0.35);
      ctx.lineTo(p.x - r * 0.22 + legSw, p.y + r * 0.02);
      ctx.moveTo(p.x + r * 0.18, p.y - r * 0.35);
      ctx.lineTo(p.x + r * 0.22 - legSw, p.y + r * 0.02);
      ctx.stroke();

      // 手臂（在身体后面，先画）
      ctx.strokeStyle = flash ? '#ffffff' : U.mix(bodyCol, '#000000', 0.28);
      ctx.lineWidth = Math.max(1, r * 0.40);
      ctx.beginPath();
      ctx.moveTo(p.x - r * 0.2, p.y - r * 1.25 + bob);
      ctx.lineTo(p.x - r * 1.05, p.y - r * 1.02 + wob + bob * 0.5);
      ctx.moveTo(p.x + r * 0.2, p.y - r * 1.25 + bob);
      ctx.lineTo(p.x + r * 1.05, p.y - r * 1.02 - wob + bob * 0.5);
      ctx.stroke();

      // 身体：先描一圈深色轮廓，再填色，再补受光面
      ctx.fillStyle = 'rgba(8,10,8,0.85)';
      ctx.beginPath(); ctx.ellipse(p.x, cy, r * 0.62, r * 0.96, lean, 0, 6.2832); ctx.fill();
      ctx.fillStyle = cloth;
      ctx.beginPath(); ctx.ellipse(p.x, cy, r * 0.52, r * 0.86, lean, 0, 6.2832); ctx.fill();
      if (!flash) {
        ctx.fillStyle = U.mix(cloth, '#ffffff', 0.16);
        ctx.beginPath(); ctx.ellipse(p.x - r * 0.12, cy - r * 0.22, r * 0.28, r * 0.48, lean, 0, 6.2832); ctx.fill();
      }
      // 破衣：下摆几道暗口
      if (z > 1.1) {
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = Math.max(0.8, r * 0.10);
        ctx.beginPath();
        ctx.moveTo(p.x - r * 0.28, cy + r * 0.55);
        ctx.lineTo(p.x - r * 0.20, cy + r * 0.80);
        ctx.moveTo(p.x + r * 0.10, cy + r * 0.62);
        ctx.lineTo(p.x + r * 0.18, cy + r * 0.84);
        ctx.stroke();
      }

      // 头：描边 + 填充
      ctx.fillStyle = 'rgba(8,10,8,0.85)';
      ctx.beginPath(); ctx.arc(p.x, hy, r * 0.48, 0, 6.2832); ctx.fill();
      ctx.fillStyle = headCol;
      ctx.beginPath(); ctx.arc(p.x, hy, r * 0.40, 0, 6.2832); ctx.fill();

      // 红眼
      if (z > 0.8) {
        ctx.fillStyle = flash ? '#ffffff' : '#e8564a';
        ctx.beginPath(); ctx.arc(p.x - r * 0.16, hy - r * 0.04, Math.max(0.9, r * 0.19), 0, 6.2832); ctx.fill();
        ctx.beginPath(); ctx.arc(p.x + r * 0.16, hy - r * 0.04, Math.max(0.9, r * 0.19), 0, 6.2832); ctx.fill();
        if (z > 1.4) {
          ctx.fillStyle = 'rgba(232,86,74,0.22)';
          ctx.beginPath(); ctx.arc(p.x - r * 0.16, hy - r * 0.04, r * 0.34, 0, 6.2832); ctx.fill();
          ctx.beginPath(); ctx.arc(p.x + r * 0.16, hy - r * 0.04, r * 0.34, 0, 6.2832); ctx.fill();
        }
      }
      // 撬轨标记
      if (zb.kind === 'ripper') {
        ctx.fillStyle = '#ffcf4a';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - r * 3.1); ctx.lineTo(p.x - r * 0.42, p.y - r * 2.4); ctx.lineTo(p.x + r * 0.42, p.y - r * 2.4);
        ctx.closePath(); ctx.fill();
      }
      // 血条：精英 / 小 Boss / Boss
      if ((zb.elite || zb.mini || zb.boss) && z > 0.8) {
        const wbar = r * (zb.boss ? 3.2 : 2.4);
        const frac = Math.max(0, zb.hp / zb.maxHp);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(p.x - wbar / 2, p.y - r * 2.75, wbar, Math.max(2, r * 0.3));
        ctx.fillStyle = zb.boss ? '#b04ad0' : '#c0392b';
        ctx.fillRect(p.x - wbar / 2, p.y - r * 2.75, wbar * frac, Math.max(2, r * 0.3));
      }
      ctx.globalAlpha = 1;
    },

    draw: function (ctx, R) { for (const zb of this.list) this.drawOne(ctx, R, zb); }
  };
})(window.ZT);
