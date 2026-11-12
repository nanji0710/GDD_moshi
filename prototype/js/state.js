'use strict';
// 局内状态机：列车/车厢/武器/难民/轨道/停车/结算/局外。所有数值来自 cfg.js（GDD v1.2）。
window.ZT = window.ZT || {};
(function (Z) {
  const U = Z.U, CFG = Z.CFG, Fx = Z.Fx;
  const W = CFG.WEAPONS;

  // ---------------- 武器实例 ----------------
  function Weapon(key, level) {
    this.key = key;
    this.level = level || 1;
    this.form = null;          // 'A' | 'B'
    this.cd = 0; this.aim = 0; this.target = null; this.retarget = 0;
    this.heat = 0; this.overheat = 0;
  }
  Weapon.prototype.def = function () { return W[this.key]; };
  Weapon.prototype.formDef = function () { return this.form ? W[this.key].forms[this.form] : null; };
  // 等级成长（Lv3 后形态提供整体上修）
  Weapon.prototype.dps = function () {
    const d = W[this.key];
    let v = d.dps * (1 + CFG.WEAPON.dpsPerLevel * (this.level - 1));
    const f = this.formDef();
    if (f) v *= (f.dmgMul || 1) * CFG.WEAPON.formDpsMul;
    if (Z.Meta) v *= Z.Meta.mult('dmg');
    return v;
  };
  Weapon.prototype.rof = function () {
    const d = W[this.key];
    let v = d.rof;
    const f = this.formDef();
    if (f) v *= (f.rofMul || 1);
    if (Z.Meta) v *= Z.Meta.mult('rof');
    if (this.heat > 0.99) v *= 0.4;
    return v;
  };
  Weapon.prototype.range = function () {
    const d = W[this.key];
    let v = d.range * (1 + CFG.WEAPON.rangePerLevel * (this.level - 1));
    const f = this.formDef();
    if (f && f.rangeMul) v *= f.rangeMul;
    return v;
  };
  Weapon.prototype.coneDeg = function () {
    const d = W[this.key]; const f = this.formDef();
    return d.coneDeg * (f && f.coneMul ? f.coneMul : 1);
  };
  Weapon.prototype.chain = function () {
    const d = W[this.key]; const f = this.formDef();
    return Math.max(1, (d.chain || 1) + (f && f.chainAdd ? f.chainAdd : 0));
  };
  Weapon.prototype.upgradeCost = function () {
    return Math.round(CFG.WEAPON.costBase * Math.pow(CFG.WEAPON.costGrowth, this.level - 1));
  };
  Weapon.prototype.canChooseForm = function () {
    return this.level >= CFG.WEAPON.formLevel && !this.form;
  };
  Z.Weapon = Weapon;

  // ---------------- 车厢 ----------------
  let carSeq = 0;
  function Car(type) {
    const t = CFG.CAR_TYPES[type];
    const hpMul = Z.Meta ? Z.Meta.mult('hp') : 1;
    this.id = ++carSeq;
    this.type = type;
    this.maxHp = Math.round(t.hp * hpMul);
    this.hp = this.maxHp;
    this.slots = [];
    for (let i = 0; i < t.slots; i++) this.slots.push(null);
    this.refugees = type === 'passenger' ? 0 : 0;
    this.dead = false;
    this.tier = 0;              // 已触发的难民死亡档位
    this.flash = 0;
    this.boardAcc = 0;
  }
  Z.Car = Car;

  // ---------------- 运行状态 ----------------
  const Run = Z.Run = {
    level: 1, levelDef: null, totalKm: 0,
    km: 0, speed: 0, state: 'menu',
    scrap: 0, ammo: 0, fuel: 100,
    cars: [], train: null,
    kills: 0, shots: 0, bossKills: 0,
    buffs: {}, skills: { owned: [], cd: {}, active: {} },
    stationIdx: 0, station: null, parkT: 0, parkDur: 0, trackDamage: 0,
    offer: null, levelUp: null,
    bossAt: [], bossSpawned: 0,
    nextCarKm: 0,
    log: [],
    boardAcc: 0,

    // ---- 速度 ----
    speedCap: function () {
      const n = this.cars.length;
      const t = CFG.TRAIN;
      const power = this.cars.filter(function (c) { return c.type === 'power'; }).length;
      // 不设上限、不设下限：纯由车厢数决定（越挂越慢，加速车厢往回拉）
      let v = t.maxSpeed * (1 - t.speedPerCar * (n - 1)) * (1 + t.powerBonus * power);
      if (v < 0) v = 0;                      // 太重开不动（无尽模式里就是死局）
      if (this.buffs.tail) v *= CFG.BUFFS.tail.speed;
      if (this.straight) v *= CFG.STRAIGHT.speedMul;      // 长直道：地面好，能跑更快
      if (Z.Meta) v *= Z.Meta.mult('speed');
      return v;
    },
    totalHp: function () { let h = 0; for (const c of this.cars) if (!c.dead) h += c.hp; return h; },
    maxHp: function () { let h = 0; for (const c of this.cars) if (!c.dead) h += c.maxHp; return h; },
    aliveCars: function () { return this.cars.filter(function (c) { return !c.dead; }).length; },
    passengerCars: function () { return this.cars.filter(function (c) { return c.type === 'passenger' && !c.dead; }); },
    capacity: function () { return this.passengerCars().length * CFG.REFUGEE.perCar; },
    refugees: function () { let n = 0; for (const c of this.passengerCars()) n += c.refugees; return n; },
    weaponCount: function () {
      let n = 0;
      for (const c of this.cars) for (const w of c.slots) if (w) n++;
      return n;
    },
    powerCars: function () { return this.cars.filter(function (c) { return c.type === 'power' && !c.dead; }).length; },

    // ---- 开新关 ----
    start: function (level) {
      const L = CFG.LEVELS[Math.min(CFG.LEVELS.length, Math.max(1, level)) - 1];
      this.level = L.n; this.levelDef = L;
      this.totalKm = L.km * 1000;
      this.km = 0; this.speed = 0; this.trackDamage = 0;
      this.scrap = CFG.ECON.startScrap;
      this.ammo = CFG.ECON.startAmmo;
      this.fuel = CFG.ECON.startFuel;
      this.kills = 0; this.shots = 0; this.bossKills = 0;
      this.stats = { t: 0, maxSpeed: 0, maxCars: 2, deaths: 0, repairs: 0 };
      this.buffs = {}; this.log = [];
      this.cars = CFG.TRAIN.startCars.map(function (t) { return new Car(t); });
      // 开局送一把最便宜的武器：没有火力就没有废料，第一个站会"什么都买不起"
      {
        const host = this.cars.find(function (c) { return c.slots.length > 0; });
        if (host && CFG.ECON.starterWeapon) host.slots[0] = new Weapon(CFG.ECON.starterWeapon, 1);
      }
      this.train = new Z.Train(this);
      this.stationIdx = 0; this.station = null;
      this.parkT = 0; this.trackDamage = 0;
      this.bossAt = (L.bosses || []).map(function (p) { return p * L.km * 1000; });
      this.bossSpawned = 0;
      this.nextCarKm = 1200;
      this.applyMods(L);
      this.offer = null; this.levelUp = null;
      this.state = 'station';              // 起点站，先进站
      this.openStation(0);
      this.refreshSkills();
      Z.World.generate(20261112 + L.n * 7, this.totalKm, L.biome, L.lm, (L.mods || []));
      if (Z.Zombies && Z.Zombies.reset) Z.Zombies.reset();
      if (Z.Skills) Z.Skills.reset(this);
      if (Z.Tips) Z.Tips.tip('start');
      return this;
    },

    // 关卡变异 → 黑暗度 / 能见度 / 天气系数
    applyMods: function (L) {
      const mods = (L && L.mods) || [];
      this.mods = mods;
      let dark = 0, vis = 1e9;
      for (const m of mods) {
        if (CFG.VIS[m] != null) dark = Math.max(dark, CFG.VIS[m]);
        if (CFG.VIS_RANGE[m] != null) vis = Math.min(vis, CFG.VIS_RANGE[m]);
      }
      this.darkness = dark;
      this.visRange = vis;
      if (Z.Tips) for (const mm of mods) Z.Tips.tip(mm);
      this.brakeMul = mods.indexOf('rain') >= 0 ? CFG.WEATHER.rainBrake : 1;
      this.flamerMul = mods.indexOf('rain') >= 0 ? CFG.WEATHER.rainFlamer : 1;
      this.straight = mods.indexOf('straight') >= 0;
    },

    refreshSkills: function () {
      // 第 2/3/4 关固定发，第 5 关起三选一（这里简化为全部拥有 3 张，冷却独立）
      const n = this.level;
      if (!Z.Skills) return;
      Z.Skills.ensure(this, n >= 2 ? 1 : 0);
    },

    // ---- 主循环 ----
    tick: function (dt) {
      if (this.state === 'win' || this.state === 'over') return;
      this.checkWin();
      if (this.state === 'win' || this.state === 'over') return;
      if (this.state !== 'run' && this.state !== 'parked') return;
      if (this.stats) {
        this.stats.t += dt;
        if (this.speed > this.stats.maxSpeed) this.stats.maxSpeed = this.speed;
        if (this.cars.length > this.stats.maxCars) this.stats.maxCars = this.cars.length;
      }
      // 技能冷却
      if (Z.Skills) Z.Skills.update(this, dt);

      if (this.state === 'parked') {
        this.parkT += dt;
        this.trackDamage = 100;
        // 停车防守：刷怪更快，车厢照常挨咬
        if (this.train) this.train.updateWeapons(dt, this);
        if (this.parkT >= this.parkDur) this.endPark();
      } else {
        this.move(dt);
        if (this.state === 'run' && this.train) this.train.updateWeapons(dt, this);
      }
      // 自动回血
      let regen = Z.Meta ? Z.Meta.regen() : 0;
      if (regen > 0 && this.state === 'parked' && Z.Meta && Z.Meta.has5 && Z.Meta.has5('regen')) regen *= 2.5;
      if (regen > 0) for (const c of this.cars) if (!c.dead && c.hp < c.maxHp) c.hp = Math.min(c.maxHp, c.hp + regen * dt);

      if (Z.Zombies) Z.Zombies.update(dt, this);
      this.checkRefugees();
      this.checkBosses();
      this.checkCarGain();
      this.checkWin();
      if (this.aliveCars() <= 0) this.gameOver();
    },

    move: function (dt) {
      const cap = this.speedCap();
      // 轨道损坏限速
      let limit = cap;
      if (this.trackDamage >= CFG.PARK.slowAtDamage) {
        limit = Math.min(limit, cap * (1 - (this.trackDamage - CFG.PARK.slowAtDamage) / 40 * 0.6));
      }
      if (this.skills.active.brake) limit = Math.min(limit, cap * 0.3);
      const t = CFG.TRAIN;
      const accelMul = (Z.Meta && Z.Meta.has5 && Z.Meta.has5('speed')) ? 1.4 : 1;
      if (this.speed < limit) this.speed = Math.min(limit, this.speed + t.accel * accelMul * dt);
      else this.speed = Math.max(limit, this.speed - t.brake * (this.brakeMul || 1) * dt);
      const ds = this.speed * dt;
      this.km += ds;
      // 铁桥提示
      if (this.mods && this.mods.indexOf('bridge') >= 0 && Z.World.bridge) {
        const onBr = this.km > Z.World.bridge.s0 - 40 && this.km < Z.World.bridge.s1 + 40;
        if (onBr && !this._onBridge) {
          this._onBridge = true;
          if (Z.UI) Z.UI.toast('上桥 · 两侧没有地面，尸群只能沿轨道来', 'warn');
        } else if (!onBr && this._onBridge) {
          this._onBridge = false;
          if (Z.UI) Z.UI.toast('下桥 · 小心两翼', 'info');
        }
      }
      this.fuel -= ds / 1000 * CFG.ECON.fuelPerKm * (this.buffs.tank ? CFG.BUFFS.tank.fuel : 1);
      if (this.fuel <= 0) { this.fuel = 0; }
      if (this.train) this.train.s = this.km;
      // 到站
      const st = this.nextStation();
      if (st != null && this.km >= st) {
        const nextIdx = this.stationIdx + 1;
        if (nextIdx >= CFG.STATION_AT.length - 1) {         // 最后一站 = 安全点，直接结算
          this.km = this.totalKm; this.state = 'win'; this.finish(true); return;
        }
        this.km = st; this.openStation(nextIdx);
      }
    },

    nextStation: function () {
      const at = CFG.STATION_AT;
      if (this.stationIdx + 1 < at.length) return at[this.stationIdx + 1] * this.totalKm;
      return null;
    },

    openStation: function (idx) {
      this.stationIdx = idx;
      this.station = { idx: idx, at: CFG.STATION_AT[idx] * this.totalKm, isStart: idx === 0, isFinal: false };
      this.speed = 0;
      this.state = 'station';
      this.boardAcc = 0;
      if (Z.Sound) Z.Sound.play('chime', { vol: 0.7 });
      if (idx > 0 && Z.Tips) Z.Tips.tip('station');
      if (Z.UI) Z.UI.openStation(this.station);
      if (Z.Save) Z.Save.save(this);
    },

    departStation: function () {
      if (this.state !== 'station') return;
      this.state = 'run';
      this.speed = Math.max(this.speed, 2);
      if (Z.UI) Z.UI.closeStation();
    },

    // 车厢受伤：统一入口（血量科技的"免死一次"在这里）
    damageCar: function (car, dmg) {
      if (!car || car.dead) return;
      car.hp = Math.max(0, car.hp - dmg);
      car.flash = 1;
      if (car.hp <= 0 && !car.revived && Z.Meta && Z.Meta.has5 && Z.Meta.has5('hp')) {
        car.hp = Math.round(car.maxHp * 0.15);
        car.revived = true;
        if (Z.UI) Z.UI.toast(CFG.CAR_TYPES[car.type].name + ' 撑住了（科技·免死）', 'good');
      }
      if (car.hp <= 0) {
        car.dead = true;
        Fx.boom(0, 0, 2.2, 10);
        Fx.shake = 1;
        if (Z.UI) Z.UI.toast(CFG.CAR_TYPES[car.type].name + ' 损毁', 'bad');
        if (Z.Tips) Z.Tips.tip('cardead');
      }
    },

    // ---- 难民 ----
    board: function (dt) {
      if (this.state !== 'station') return;
      const cap = this.capacity();
      if (this.refugees() >= cap) return;
      this.boardAcc += dt * CFG.REFUGEE.boardPerSec;
      while (this.boardAcc >= 1 && this.refugees() < cap) {
        this.boardAcc -= 1;
        for (const c of this.passengerCars()) {
          if (c.refugees < CFG.REFUGEE.perCar) { c.refugees++; break; }
        }
      }
    },
    checkRefugees: function () {
      const tiers = CFG.REFUGEE.tiers;
      for (const c of this.passengerCars()) {
        if (c.dead) continue;
        const frac = c.hp / c.maxHp;
        while (c.tier < tiers.length && frac < tiers[c.tier]) {
          c.tier++;
          const d = Math.min(c.refugees, CFG.REFUGEE.deathPerTier);
          c.refugees -= d;
          if (this.stats) this.stats.deaths += d;
          if (d > 0 && Z.Tips) Z.Tips.tip('refugee');
          if (d > 0 && Z.UI) Z.UI.toast('难民死亡 -' + d + '（车厢 ' + Math.round(frac * 100) + '%）', 'bad');
        }
        if (c.hp <= 0 && !c.dead) {
          c.dead = true; c.hp = 0;
          if (c.refugees > 0 && this.stats) this.stats.deaths += c.refugees;
          if (c.refugees > 0 && Z.UI) Z.UI.toast('人员车厢损毁，-' + c.refugees + ' 难民', 'bad');
          c.refugees = 0;
        }
      }
    },
    rescue: function () {
      let n = 0;
      for (const c of this.passengerCars()) {
        if (c.hp / c.maxHp >= 0.4) {
          const add = Math.min(CFG.REFUGEE.rescueRate, CFG.REFUGEE.perCar - c.refugees);
          if (add > 0) { c.refugees += add; n += add; }
        }
      }
      return n;
    },

    // ---- 车厢 ----
    checkCarGain: function () {
      if (this.offer) return;
      if (this.km < this.nextCarKm) return;
      this.nextCarKm += CFG.TRAIN.carGainKm * 1000;
      this.offer = this.rollCars();
      if (Z.Tips) Z.Tips.tip('caroffer');
      if (Z.UI) Z.UI.openCarOffer(this.offer);
    },
    rollCars: function () {
      const w = CFG.CAR_WEIGHT, pool = [];
      for (const k in w) for (let i = 0; i < w[k]; i++) pool.push(k);
      const picked = [];
      while (picked.length < 3) {
        const k = pool[(Math.random() * pool.length) | 0];
        if (picked.indexOf(k) < 0) picked.push(k);
      }
      // 前 3 关保底一个武器/人员
      if (this.level <= 3 && picked.indexOf('weapon') < 0 && picked.indexOf('passenger') < 0) {
        picked[Math.floor(Math.random() * 3)] = Math.random() < 0.5 ? 'weapon' : 'passenger';
      }
      return picked;
    },
    takeCar: function (type) {
      if (!this.offer) return;
      this.cars.push(new Car(type));
      this.offer = null;
      if (Z.Sound) Z.Sound.play('ui');
      if (Z.Save) Z.Save.save(this);
      if (Z.UI) { Z.UI.closeCarOffer(); Z.UI.toast('获得 ' + CFG.CAR_TYPES[type].name, 'good'); }
    },
    discardCar: function (idx) {
      const c = this.cars[idx];
      if (!c || this.cars.length <= 2) return false;
      this.cars.splice(idx, 1);
      const buff = { passenger: 'wrath', weapon: 'salvage', power: 'light', armor: 'recast', repair: 'medkit' }[c.type];
      const names = { wrath: '悲愤（攻速 +15%）', salvage: '回收（+400 废料）', light: '轻装（速度 +8%）', recast: '重铸（耐久上限 +12%）', medkit: '急救包（全车回 150）' };
      if (c.type === 'passenger') this.buffs.wrath = true;
      if (c.type === 'power') this.buffs.light = true;
      if (c.type === 'armor') for (const x of this.cars) if (!x.dead) { x.maxHp = Math.round(x.maxHp * 1.12); x.hp = Math.round(x.hp * 1.12); }
      if (c.type === 'repair') for (const x of this.cars) if (!x.dead) x.hp = Math.min(x.maxHp, x.hp + 150);
      if (c.type === 'weapon') this.scrap += 400;
      if (Z.UI) Z.UI.toast('丢弃 ' + CFG.CAR_TYPES[c.type].name + ' → ' + (names[buff] || ''), 'warn');
      return true;
    },

    // ---- 武器 ----
    addWeapon: function (carIdx, slotIdx, key) {
      const c = this.cars[carIdx];
      if (!c || c.dead || slotIdx >= c.slots.length) return false;
      const cost = W[key].cost;
      if (this.scrap < cost) return false;
      this.scrap -= cost;
      c.slots[slotIdx] = new Weapon(key, 1);
      return true;
    },
    upgradeWeapon: function (carIdx, slotIdx) {
      const w = this.cars[carIdx] && this.cars[carIdx].slots[slotIdx];
      if (!w || w.level >= CFG.WEAPON.maxLevel) return false;
      const cost = w.upgradeCost();
      if (this.scrap < cost) return false;
      this.scrap -= cost; w.level++;
      return true;
    },
    chooseForm: function (carIdx, slotIdx, form) {
      const w = this.cars[carIdx] && this.cars[carIdx].slots[slotIdx];
      if (!w || !w.canChooseForm()) return false;
      w.form = form;
      return true;
    },
    removeWeapon: function (carIdx, slotIdx) {
      const w = this.cars[carIdx] && this.cars[carIdx].slots[slotIdx];
      if (!w) return false;
      let back = Math.round(W[w.key].cost * 0.4 * w.level);
      this.scrap += back;
      this.cars[carIdx].slots[slotIdx] = null;
      return true;
    },

    // ---- 轨道 / 停车 ----
    ripTrack: function (amount) {
      if (this.state !== 'run') return;
      this.trackDamage = Math.min(100, this.trackDamage + amount);
      if (this.trackDamage >= 100) this.beginPark();
    },
    beginPark: function () {
      this.state = 'parked';
      this.speed = 0;
      this.parkT = 0;
      const metaRepair = Z.Meta ? Z.Meta.repairMul() : 1;
      this.parkDur = CFG.TRAIN.repairSec * metaRepair * ((Z.Meta && Z.Meta.has5 && Z.Meta.has5('repair')) ? 0.85 : 1);
      if (this.stats) this.stats.repairs++;
      if (Z.UI) Z.UI.toast('轨道被撬断 · 停车防守 ' + Math.round(this.parkDur) + ' 秒', 'bad');
      if (Z.Sound) Z.Sound.play('alarm');
      if (Z.Tips) Z.Tips.tip('repair');
      if (Z.Zombies) Z.Zombies.spawnMiniBossChance(this, CFG.PARK.miniBossChance);
      if (Z.Fx) Z.Fx.shake = 1;
    },
    endPark: function () {
      this.state = 'run';
      this.trackDamage = 0;
      this.parkT = 0;
      if (Z.UI) Z.UI.toast('轨道修好 · 自动出发', 'good');
      if (Z.Sound) Z.Sound.play('chime');
      if (Z.Save) Z.Save.save(this);
    },
    instantRepair: function () {
      if (this.state !== 'parked') return false;
      if (this.scrap < CFG.TRAIN.repairInstantCost) return false;
      this.scrap -= CFG.TRAIN.repairInstantCost;
      this.parkT = Math.max(this.parkT, this.parkDur - 3);
      return true;
    },

    // ---- Boss ----
    checkBosses: function () {
      if (!this.bossAt || this.bossSpawned >= this.bossAt.length) return;
      if (this.km >= this.bossAt[this.bossSpawned]) {
        this.bossSpawned++;
        if (Z.Zombies) Z.Zombies.spawnBoss(this, this.bossSpawned === 2 ? 'ripper' : (this.level % 3 === 1 ? 'armor' : (this.level % 3 === 2 ? 'caller' : 'ripper')));
        if (Z.UI) Z.UI.toast('Boss 出现！', 'bad');
        if (Z.Fx) Z.Fx.shake = 1;
      }
    },

    // ---- 胜负 ----
    checkWin: function () {
      if (this.state === 'win') return;
      if (this.km >= this.totalKm) { this.km = this.totalKm; this.state = 'win'; this.finish(true); }
    },
    gameOver: function () {
      if (this.state === 'over' || this.state === 'win') return;
      this.state = 'over';
      this.finish(false);
    },
    finish: function (win) {
      if (Z.Sound) Z.Sound.play(win ? 'win' : 'lose');
      if (Z.Sound) Z.Sound.rumble(0);
      const res = this.settle(win);
      if (Z.Save) {
        const prev = Z.Save.best ? Z.Save.best(this.level) : null;
        res.prevBest = prev;
        res.bestPoints = Math.max(prev ? prev.points : 0, res.points);
        res.isBest = !prev || res.points > prev.points;
        if (res.isBest && Z.Save.setBest) {
          Z.Save.setBest(this.level, {
            points: res.points, km: res.km, refugees: res.refugees,
            kills: res.kills, grade: res.grade, at: Date.now()
          });
        }
        Z.Save.clear();
      }
      if (Z.Meta) Z.Meta.addPoints(res.points);
      if (Z.UI) Z.UI.showResult(res, win);
    },

    // ---- 结算 ----
    settle: function (win) {
      const km = this.km / 1000;
      const ref = this.refugees();
      const miles = Math.round(km * 100);
      const esc = ref * 40;
      const combat = Math.round(this.kills * 0.5 + this.bossKills * 300);
      const deadCars = this.cars.filter(function (c) { return c.dead; }).length;
      const perfect = (deadCars === 0 ? 200 : 0) + (this.deadRefugees === 0 ? 150 : 0);
      const leftover = Math.round(this.scrap * 0.5 + this.ammo * 0.1 + this.fuel * 2);
      const penalty = deadCars * 120;
      const base = miles + esc + combat + perfect + leftover - penalty;
      const points = Math.max(0, Math.round(base * (win ? 1 : 0.35)));
      const st = this.stats || { t: 0, maxSpeed: 0, maxCars: this.cars.length, deaths: 0, repairs: 0 };
      const carLoss = this.cars.length ? deadCars / this.cars.length : 0;
      const refRate = ref / Math.max(1, this.capacity());
      let grade = '崩', line = '';
      if (carLoss <= 0.15 && refRate >= 0.5) {
        grade = '稳';
        line = '一节车厢都没丢，' + ref + ' 个人全须全尾进了墙。';
      } else if (carLoss <= 0.45 || refRate >= 0.25) {
        grade = '险';
        line = deadCars === 0
          ? '一节车厢都没丢，可只有 ' + ref + ' 个人赶上了车。'
          : '你丢了 ' + deadCars + ' 节车厢，但 ' + ref + ' 个人还是到了墙后。';
      } else {
        grade = '崩';
        line = '车散了不少，人也走散了——最后只有 ' + ref + ' 个人活着到站。';
      }
      return {
        grade: grade, line: line, stats: st, carLoss: carLoss, refRate: refRate,
        capacity: this.capacity(), deadRefugees: st.deaths, repairs: st.repairs,
        maxSpeed: st.maxSpeed, maxCars: st.maxCars, timeSec: st.t,
        win: !!win, km: km, refugees: ref, kills: this.kills, bossKills: this.bossKills,
        deadCars: deadCars, perfect: perfect, leftover: leftover, penalty: penalty,
        miles: miles, esc: esc, combat: combat, points: points,
        level: this.level
      };
    },

    // ---------------- 存档：只存"跑动中的这一局" ----------------
    snapshot: function () {
      const cars = this.cars.map(function (c) {
        return {
          t: c.type, hp: Math.round(c.hp), mhp: c.maxHp, tier: c.tier || 0,
          rf: c.refugees || 0, dead: !!c.dead,
          s: c.slots.map(function (w) { return w ? { k: w.key, lv: w.level, f: w.form || null } : null; })
        };
      });
      return {
        v: 1, t: Date.now(),
        level: this.level, km: Math.round(this.km), speed: Math.round(this.speed * 10) / 10,
        scrap: Math.round(this.scrap), ammo: Math.round(this.ammo), fuel: Math.round(this.fuel),
        kills: this.kills, shots: this.shots, bossKills: this.bossKills,
        buffs: this.buffs, state: this.state,
        stationIdx: this.stationIdx, station: this.station,
        parkT: this.parkT, parkDur: this.parkDur, trackDamage: this.trackDamage,
        bossSpawned: this.bossSpawned, nextCarKm: this.nextCarKm,
        cars: cars
      };
    },

    restore: function (snap) {
      const L = CFG.LEVELS[Math.min(CFG.LEVELS.length, Math.max(1, snap.level)) - 1];
      this.level = L.n; this.levelDef = L; this.totalKm = L.km * 1000;
      this.km = snap.km || 0; this.speed = snap.speed || 0;
      this.scrap = snap.scrap || 0; this.ammo = snap.ammo || 0; this.fuel = snap.fuel == null ? 100 : snap.fuel;
      this.kills = snap.kills || 0; this.shots = snap.shots || 0; this.bossKills = snap.bossKills || 0;
      this.buffs = snap.buffs || {};
      this.cars = (snap.cars || []).map(function (d) {
        const car = new Car(d.t);
        car.maxHp = d.mhp || car.maxHp;
        car.hp = Math.max(1, d.hp || car.maxHp);
        car.tier = d.tier || 0;
        car.refugees = d.rf || 0;
        car.dead = !!d.dead;
        car.slots = (d.s || []).map(function (w) {
          if (!w || !W[w.k]) return null;
          const wp = new Weapon(w.k, Math.min(CFG.WEAPON.maxLevel, Math.max(1, w.lv || 1)));
          wp.form = w.f || null;
          return wp;
        });
        return car;
      });
      if (!this.cars.length) this.cars = CFG.TRAIN.startCars.map(function (t) { return new Car(t); });
      this.train = new Z.Train(this);
      this.train.s = this.km;
      this.stationIdx = snap.stationIdx || 0;
      // 里程可能被拉到"已经过站"的位置：把已过站数对齐，否则一读档就会被拽回上一站
      let si = 0;
      for (let i = 0; i < CFG.STATION_AT.length; i++) {
        if (this.km >= CFG.STATION_AT[i] * this.totalKm - 1) si = i;
      }
      this.stationIdx = Math.max(this.stationIdx, si);
      this.station = snap.station || null;
      this.state = snap.state === 'parked' ? 'parked' : (snap.state === 'station' ? 'station' : 'run');
      this.parkT = snap.parkT || 0;
      this.parkDur = snap.parkDur || CFG.TRAIN.repairSec;
      this.trackDamage = snap.trackDamage || 0;
      this.bossAt = (L.bosses || []).map(function (p) { return p * L.km * 1000; });
      this.bossSpawned = snap.bossSpawned || 0;
      this.applyMods(L);
      this.nextCarKm = snap.nextCarKm || 1200;
      this.offer = null; this.levelUp = null; this.log = [];
      this.skills = { owned: [], cd: {}, active: {} };
      if (Z.Skills) Z.Skills.ensure(this, this.level);
      Z.World.generate(20261112 + L.n * 7, this.totalKm, L.biome, L.lm, (L.mods || []));
      if (Z.Zombies && Z.Zombies.reset) Z.Zombies.reset();
      return this;
    }
  };
})(window.ZT);
