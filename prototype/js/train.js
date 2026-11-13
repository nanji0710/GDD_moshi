'use strict';
// 列车：车厢沿曲线排布、车顶挂点、五种武器开火。挂点定位全在世界坐标（x,y,h），最后一步才投影。
window.ZT = window.ZT || {};
(function (Z) {
  const U = Z.U, CFG = Z.CFG, Fx = Z.Fx;

  function Train(run) {
    this.run = run;
    this.s = 0;
    this.v = 0;
    this.shells = [];
    this._lay = [];
    this._joints = [];
  }
  Train.prototype.pitch = function () { return CFG.TRAIN.carLenM + CFG.TRAIN.carGapM; };
  Train.prototype.cars = function () { return this.run.cars; };

  // 车厢布局：中心里程 = 列车中点里程 + (k - (n-1)/2) * 节距
  Train.prototype.layout = function (world) {
    const out = this._lay, cars = this.run.cars;
    out.length = cars.length;
    const pitch = this.pitch(), half = CFG.TRAIN.carLenM / 2;
    const n = cars.length;
    for (let k = 0; k < n; k++) {
      // 列车中心在 this.s；k=0 是车头（在最前面），k 越大越靠后
      const cs = this.s + ((n - 1) / 2 - k) * pitch;
      const c = out[k] || (out[k] = {});
      const p = U.posAt(world.path, U.clamp(cs, 0, world.path.len), {});
      const pf = U.posAt(world.path, U.clamp(cs + half, 0, world.path.len), {});
      const pb = U.posAt(world.path, U.clamp(cs - half, 0, world.path.len), {});
      c.cs = cs; c.x = p.x; c.y = p.y; c.h = p.h; c.a = p.a;
      c.fx = pf.x; c.fy = pf.y; c.bx = pb.x; c.by = pb.y;
      c.ox = Math.cos(p.a); c.oy = Math.sin(p.a);
      c.nx = -Math.sin(p.a); c.ny = Math.cos(p.a);
      c.ok = cs > -half && cs < world.path.len + half;
      c.car = cars[k];
    }
    return out;
  };
  // 车顶挂点：沿车身前后各偏 26%，高度 = 轨面 + 车体高
  // car 可以是布局项（有 .car 指回真实车厢），也可以是车厢本身
  Train.prototype.slotPos = function (car, j, out) {
    const real = car && car.car ? car.car : car;
    const slots = (real && real.slots) || [];
    const n = slots.length || 1;
    const off = n === 1 ? 0 : (j === 0 ? -1 : 1) * CFG.TRAIN.carLenM * 0.26;
    out = out || {};
    out.x = car.x + car.ox * off;
    out.y = car.y + car.oy * off;
    out.h = car.h + CFG.TRAIN.heightM + 0.7;
    out.a = car.a;
    return out;
  };

  // ---------------- 开火 ----------------
  function d2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

  Train.prototype.updateWeapons = function (dt, run) {
    const cars = this.layout(Z.World);
    const zs = Z.Zombies.list;
    const tmp = {};
    const rofBuff = run.buffs.belt ? CFG.BUFFS.belt.rof : 1;
    const wrath = run.buffs.wrath ? 1.15 : 1;
    const over = run.skills.active.over ? 1.6 : 1;
    const salvo = run.skills.active.salvo ? 2 : 1;

    for (const c of run.cars) c.flash = Math.max(0, c.flash - dt * 2.5);

    for (let k = 0; k < cars.length; k++) {
      const lay = cars[k], car = run.cars[k];
      if (!car || car.dead) continue;
      for (let j = 0; j < car.slots.length; j++) {
        const w = car.slots[j];
        if (!w) continue;
        w.cd -= dt;
        w.heat = Math.max(0, w.heat - dt * 0.42);
        const mount = this.slotPos(lay, j, tmp);
        const R = w.range();
        w.retarget -= dt;
        const Rvis = Math.min(R, run.visRange || 1e9);
        if (w.retarget <= 0 || (w.target && (w.target.dead || d2(w.target, mount) > Rvis * Rvis))) {
          w.retarget = (Z.Meta && Z.Meta.has5 && Z.Meta.has5('rof')) ? 0.12 : 0.25;
          w.target = pickTarget(zs, mount, Rvis, true);
        }
        if (!w.target) { w.aim = U.turnTo(w.aim, lay.a, 1.4, dt); continue; }
        const want = Math.atan2(w.target.y - mount.y, w.target.x - mount.x);
        w.aim = U.turnTo(w.aim, want, w.def().aimRate || 2, dt);
        const aligned = Math.abs(U.angleDiff(w.aim, want)) < (w.def().mode === 'cone' ? 0.5 : 0.14);
        if (!aligned || w.cd > 0) continue;
        // 弹药
        const cost = Math.max(1, Math.round(w.def().ammoPerShot * (over > 1 ? 2 : 1)));
        if (!CFG.ECON.infiniteAmmo) {
          if (run.ammo < cost) { w.cd = 0.6; continue; }
          run.ammo -= cost;
        }
        w.cd = 1 / (w.rof() * rofBuff * wrath * salvo);
        w.heat = Math.min(1, w.heat + 0.16);
        this.fire(w, k, lay, mount, run, zs, over);
      }
    }
    // 迫击炮炮弹
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      sh.t += dt;
      if (sh.t >= sh.dur) {
        this.shells.splice(i, 1);
        Fx.boom(sh.tx, sh.ty, 1, sh.radius);
        Fx.shake = Math.min(1, Fx.shake + 0.3);
        if (Z.Sound) Z.Sound.play('boom', { vol: volAt(sh.tx, sh.ty) * 0.85 });
        areaDamage(zs, sh.tx, sh.ty, sh.radius, sh.dmg, run);
      }
    }
  };

  function volAt(x, y) {
    const R = Z.R; if (!R) return 0.6;
    const d = Math.hypot(x - R.cam.cx, y - R.cam.cy);
    return Math.max(0.12, Math.min(1, 1 - d / 1400));
  }
  Train.prototype.fire = function (w, carIdx, lay, mount, run, zs, over) {
    const def = w.def(), f = w.formDef() || {};
    if (Z.Sound) Z.Sound.play(w.key === 'flamer' ? 'flamer' : (w.key === 'flak' ? 'flak' : (w.key === 'tesla' ? 'tesla' : (w.key === 'mortar' ? 'mortar' : 'mg'))), { vol: volAt(mount.x, mount.y) });
    const dmg = w.dps() / Math.max(0.1, w.rof()) * over;
    run.shots++;
    if (def.mode === 'hitscan' || def.mode === 'burst') {
      const t = w.target, n = def.burst || 1;
      const fw = f === 'B' ? 2.8 : (f === 'A' ? 1.1 : 1.5);
      for (let i = 0; i < n; i++) {
        Fx.tracer(mount.x, mount.y, mount.h, t.x + (Math.random() - 0.5) * 3, t.y + (Math.random() - 0.5) * 3, 1.4, def.color, fw);
      }
      Fx.flash(mount.x, mount.y, mount.h, def.color, f === 'B' ? 3.6 : 2.6);
      hit(t, dmg * n * (run.buffs.ap && t.elite ? CFG.BUFFS.ap.ap : 1), run, elementOf(w.key));
      w.target = null;
    } else if (def.mode === 'cone') {
      Fx.cone(mount.x, mount.y, w.aim, w.range(), w.coneDeg() / 2 * Math.PI / 180, '#ff8a2f');
      Fx.flash(mount.x, mount.y, mount.h, def.color, 2);
      let hits = 0;
      for (const zb of zs) {
        if (zb.dead || hits >= def.targets) continue;
        const dd = Math.hypot(zb.x - mount.x, zb.y - mount.y);
        if (dd > w.range()) continue;
        if (Math.abs(U.angleDiff(w.aim, Math.atan2(zb.y - mount.y, zb.x - mount.x))) > w.coneDeg() / 2 * Math.PI / 180) continue;
        hit(zb, dmg * 1.6 * (run.flamerMul || 1), run, 'fire'); hits++;
      }
    } else if (def.mode === 'chain') {
      let cur = w.target, dd = dmg, seen = [];
      const pts = [{ x: mount.x, y: mount.y }];
      for (let i = 0; i < w.chain() && cur; i++) {
        pts.push({ x: cur.x, y: cur.y });
        hit(cur, dd, run, 'shock'); seen.push(cur); dd *= 0.62;
        let best = null, bd = 1600;
        for (const zb of zs) {
          if (zb.dead || seen.indexOf(zb) >= 0) continue;
          const q = d2(zb, cur); if (q < bd) { bd = q; best = zb; }
        }
        cur = best;
      }
      Fx.chain(pts, def.color);
      Fx.flash(mount.x, mount.y, mount.h, def.color, f === 'B' ? 4.4 : 3.4);
      w.target = null;
    } else if (def.mode === 'shell') {
      const t = w.target, salvo = f.salvo || 1;
      for (let i = 0; i < salvo; i++) {
        const tx = t.x + (i - (salvo - 1) / 2) * 12;
        this.shells.push({
          tx: tx, ty: t.y, t: 0, dur: 0.55 + Math.hypot(t.x - mount.x, t.y - mount.y) / 700,
          radius: def.splash * (f.splashMul || 1), dmg: dmg * 1.6
        });
      }
      Fx.flash(mount.x, mount.y, mount.h, def.color, f === 'B' ? 4.2 : 3);
      w.target = null;
    }
  };

  function pickTarget(zs, mount, range, checkLos) {
    let best = null, bd = range * range;
    for (const zb of zs) {
      if (zb.dead) continue;
      const q = d2(zb, mount);
      if (q >= bd) continue;
      // 隔着山体打不到：这是重庆弯道关的核心限制
      if (checkLos && Z.World.losBlocked && Z.World.losBlocked(mount.x, mount.y, zb.x, zb.y)) continue;
      bd = q; best = zb;
    }
    return best;
  }
  // 元素：mg/flak = bullet，flamer = fire，tesla = shock，mortar = blast
  function elementOf(key) {
    return key === 'flamer' ? 'fire' : key === 'tesla' ? 'shock' : key === 'mortar' ? 'blast' : 'bullet';
  }

  function hit(zb, dmg, run, el) {
    if (!zb || zb.dead) return;
    el = el || 'bullet';
    // 攻击力 Lv5：对精英/Boss 额外 +20%
    if ((zb.elite || zb.boss || zb.mini) && Z.Meta && Z.Meta.has5 && Z.Meta.has5('dmg')) dmg *= 1.2;

    // ---- 元素连携 ----
    let combo = '';
    const wet = !!(run.mods && run.mods.indexOf('rain') >= 0);
    if (el === 'bullet' && zb.burn > 0) { dmg *= 1.30; combo = '爆燃'; }
    else if (el === 'shock' && (wet || zb.burn > 0)) { dmg *= 1.35; combo = '导电'; }
    else if (el === 'blast' && zb.burn > 0) { dmg *= 1.5; combo = '殉爆'; zb.burn = 0; }
    if (el === 'fire') { zb.burn = Math.max(zb.burn || 0, 3.5); zb.burnDps = Math.max(zb.burnDps || 0, CFG.ZOMBIE.burnDps || 7); }
    if (combo && Math.random() < 0.45) {
      Fx.text(zb.x, zb.y, 2.9, combo, el === 'shock' ? '#a8d8ff' : '#ffab4a');
    }
    if (Z.Sound) Z.Sound.play('hit', { vol: 0.35 });
    zb.hp -= dmg; zb.flash = 1;
    if (zb.hp <= 0) {
      zb.dead = true; zb.deadT = 0; zb.burn = 0;
      run.kills++;
      run.scrap += (zb.boss ? (CFG.ZOMBIE.bossScrap || 250)
        : zb.mini ? (CFG.ZOMBIE.miniScrap || 200)
        : (zb.elite ? CFG.ZOMBIE.eliteScrap : CFG.ZOMBIE.scrap))
        * (run.state === 'parked' ? CFG.PARK.scrapMul : 1);
      if (zb.boss) run.bossKills++;
      Fx.blood(zb.x, zb.y, 1.2);
      Fx.sparks(zb.x, zb.y, 2.2, 3, '#c8402e');
      Fx.text(zb.x, zb.y, 1.2, '+' + (zb.boss ? (CFG.ZOMBIE.bossScrap || 250) : zb.mini ? (CFG.ZOMBIE.miniScrap || 200) : zb.elite ? CFG.ZOMBIE.eliteScrap : CFG.ZOMBIE.scrap), '#ffd479');
    } else if (Math.random() < 0.2) Fx.blood(zb.x, zb.y, 1.2);
  }
  function areaDamage(zs, x, y, r, dmg, run) {
    const r2 = r * r;
    for (const zb of zs) {
      if (zb.dead) continue;
      const q = (zb.x - x) * (zb.x - x) + (zb.y - y) * (zb.y - y);
      if (q <= r2) hit(zb, dmg * (1 - Math.sqrt(q) / r * 0.6), run);
    }
  }
  Z.damageArea = areaDamage;
  Z.Train = Train;
})(window.ZT);
