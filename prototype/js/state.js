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
    // 形态总 DPS = 单发加成 × 射速加成 × 形态基准上修
    // （旧写法只乘 dmgMul，A 形态反而比不选形态更弱，看起来"没变化"）
    if (f) v *= (f.dmgMul || 1) * (f.rofMul || 1) * CFG.WEAPON.formDpsMul;
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
    let bHp = 1;
    if (Z.Meta && Z.Meta.hasBranch && Z.Meta.hasBranch('hp', 'A')) bHp = 1.10;
    this.maxHp = Math.round(t.hp * hpMul * bHp);
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
    hasEngine: function () {
      for (const c of this.cars) if (c.type === 'engine' && !c.dead) return true;
      return false;
    },
    speedCap: function () {
      if (!this.hasEngine()) return 0;          // 没有车头 = 没有牵引力
      // 只算"活着"的车厢：被打烂的车不再拖后腿，反而让你跑得更快
      const n = this.aliveCars();
      const t = CFG.TRAIN;
      const power = this.cars.filter(function (c) { return c.type === 'power' && !c.dead; }).length;
      // 不设上限、不设下限：纯由车厢数决定（越挂越慢，加速车厢往回拉）
      const perCar = (Z.Meta && Z.Meta.hasBranch && Z.Meta.hasBranch('speed', 'B')) ? 0.02 : t.speedPerCar;
      let v = t.maxSpeed * (1 - perCar * (n - 1)) * (1 + t.powerBonus * power);
      if (v < 0) v = 0;                      // 太重开不动（无尽模式里就是死局）
      if (this.buffs.tail) v *= CFG.BUFFS.tail.speed;
      if (this.straight) v *= CFG.STRAIGHT.speedMul;      // 长直道：地面好，能跑更快
      if (Z.Meta) v *= Z.Meta.mult('speed');
      if (Z.Meta && Z.Meta.hasBranch && Z.Meta.hasBranch('speed', 'A')) v *= 1.12;
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
      this.scrap = CFG.ECON.startScrap + (CFG.ECON.startScrapPerLevel || 0) * (L.n - 1);
      this.ammo = CFG.ECON.startAmmo;
      this.fuel = CFG.ECON.startFuel;
      this.kills = 0; this.shots = 0; this.bossKills = 0;
      // 从无尽模式切回闯关时必须清掉这些标记，否则关卡里不刷站台、终点会被判成失败
      this.endless = false;
      this.stallT = 0;
      this.noEngineT = 0;
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
    // 中后期随机一座废弃站台
    const af = CFG.ABANDON.atMin + Math.random() * (CFG.ABANDON.atMax - CFG.ABANDON.atMin);
    this.abandon = { f: af, s: af * this.totalKm, fired: false };
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
      // 关卡目标
      this.goal = (L && L.goal) ? Object.assign({}, L.goal) : { type: 'reach' };
      this.holdT = 0;
      this.sprintT = 0;
      this.goalFail = '';
      if (this.goal.type === 'escort') {
        this.cars.push(new Car('cargo'));
        if (Z.Tips) Z.Tips.tip('goalEscort');
      } else if (this.goal.type === 'sprint') {
        if (Z.Tips) Z.Tips.tip('goalSprint');
      } else if (this.goal.type === 'hold') {
        if (Z.Tips) Z.Tips.tip('goalHold');
      }
      if (Z.Skills) Z.Skills.reset(this);
      if (Z.Tips) Z.Tips.tip('start');
      return this;
    },

    // ---------------- 无尽模式 ----------------
    startEndless: function () {
      this.start(1);
      this.endless = true;
      this.totalKm = CFG.ENDLESS.pathKm * 1000;
      this.nextStationKm = CFG.ENDLESS.stationKm * 1000;
      this.nextBossKm = CFG.ENDLESS.bossKm * 1000;
      this.stallT = 0;
      this.level = 1; this.levelDef = CFG.LEVELS[0];
      // 一条很长的走廊（难度不按关卡，按里程）
      Z.World.generate(20261112 + 977, this.totalKm, 'loess', null, []);
      if (Z.World.setEndlessStations) Z.World.setEndlessStations(this.totalKm);
      this.train = new Z.Train(this);
      this.state = 'station';
      this.station = { idx: -1, endless: true, isStart: true };
      this.speed = 0;
      if (Z.Zombies && Z.Zombies.reset) Z.Zombies.reset();
      if (Z.UI) Z.UI.openStation(this.station);
      if (Z.Tips) Z.Tips.tip('endless');
      return this;
    },

    // 无尽模式里"第几关"由里程算出来
    endlessLevel: function () {
      return Math.min(CFG.LEVELS.length, 1 + Math.floor(this.km / (CFG.ENDLESS.lvlKm * 1000)));
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
      this._lastDt = dt;
      if (this.state === 'win' || this.state === 'over') return;
      this.checkWin();
      if (this.state === 'win' || this.state === 'over') return;
      // 目标判定要放在状态门之前：守站时 state 是 'hold'，否则永远轮不到倒计时
      this.checkGoal(dt);
      if (this.state === 'win' || this.state === 'over') return;
      if (this.state !== 'run' && this.state !== 'parked') return;
      if (this.stats) {
        this.stats.t += dt;
        if (this.speed > this.stats.maxSpeed) this.stats.maxSpeed = this.speed;
        if (this.cars.length > this.stats.maxCars) this.stats.maxCars = this.cars.length;
      }
      if (!this.hasEngine()) {
        this.noEngineT = (this.noEngineT || 0) + dt;
        if (this.noEngineT > 2.5 && this.state !== 'over') {
          if (Z.UI) Z.UI.toast('车头被打坏，列车停下', 'bad');
          this.gameOver();
          return;
        }
      } else this.noEngineT = 0;
      if (this.endless) {
        const lv = this.endlessLevel();
        if (lv !== this.level) { this.level = lv; this.levelDef = CFG.LEVELS[lv - 1]; }
        if (this.state === 'run') {
          if (this.speed < 0.6) this.stallT += dt; else this.stallT = 0;
          if (this.stallT > CFG.ENDLESS.stallSec) { this.gameOver(); return; }
        }
      }
      // 技能冷却
      if (Z.Skills) Z.Skills.update(this, dt);

      if (this.state === 'hold') {
        // 守站：车停着不动，但武器照常开火
        this.speed = 0;
        if (this.train) this.train.updateWeapons(dt, this);
      } else if (this.state === 'parked') {
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
      // 修理车厢：给相邻车厢持续回血
      for (let i = 0; i < this.cars.length; i++) {
        const rc = this.cars[i];
        if (rc.type !== 'repair' || rc.dead) continue;
        const rate = CFG.CAR_TYPES.repair.repairAura;
        for (const k of [i - 1, i + 1]) {
          const nb = this.cars[k];
          if (nb && !nb.dead && nb.hp < nb.maxHp) nb.hp = Math.min(nb.maxHp, nb.hp + rate * dt);
        }
      }
      let regen = Z.Meta ? Z.Meta.regen() : 0;
      if (regen > 0 && Z.Meta.hasBranch && Z.Meta.hasBranch('regen', 'A')) regen *= 1.375;
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
      const cap = this.hasEngine() ? this.speedCap() : 0;   // 车头没了就跑不动
      // 轨道损坏限速
      let limit = cap;
      if (this.trackDamage >= CFG.PARK.slowAtDamage) {
        limit = Math.min(limit, cap * (1 - (this.trackDamage - CFG.PARK.slowAtDamage) / 40 * 0.6));
      }
      if (this.skills.active.brake) limit = Math.min(limit, cap * 0.3);
      // 尸潮堵路：贴着车身的丧尸越多，车越难推进（不会完全停死）
      if (this.abandon && this.abandon.active && Z.Zombies && this.train) {
        const lay = this.train.layout(Z.World);
        let near = 0;
        for (const zb of Z.Zombies.list) {
          if (zb.dead) continue;
          for (let i2 = 0; i2 < lay.length; i2++) {
            const c = lay[i2];
            if (!c) continue;
            const dx = zb.x - c.x, dy = zb.y - c.y;
            if (dx * dx + dy * dy < 81) { near++; break; }
          }
        }
        this.blockCount = near;
        const k = Math.max(CFG.ABANDON.slowMin || 0.15, 1 - near * (CFG.ABANDON.slowPer || 0.014));
        limit = Math.min(limit, cap * k);
      } else {
        this.blockCount = 0;
      }
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
      if (!CFG.ECON.infiniteFuel) {
        this.fuel -= ds / 1000 * CFG.ECON.fuelPerKm * (this.buffs.tank ? CFG.BUFFS.tank.fuel : 1);
        if (this.fuel <= 0) { this.fuel = 0; }
      }
      if (this.train) this.train.s = this.km;
      // 无尽模式：固定里程一个补给站，跑到走廊尽头就结束
      if (this.endless) {
        if (this.km >= this.totalKm) { this.km = this.totalKm; this.gameOver(); return; }
        if (this.km >= this.nextStationKm) {
          this.nextStationKm += CFG.ENDLESS.stationKm * 1000;
          this.km = Math.round(this.km);
          this.openEndlessStation();
          return;
        }
        return;
      }
            // 废弃站台：车头进入范围就涌出尸潮（列车不停，但会被堵慢）
    if (this.abandon) {
      const halfTr = (this.cars.length * (CFG.TRAIN.carLenM + CFG.TRAIN.carGapM)) / 2;
      const front = this.km + halfTr;
      const a0 = this.abandon.s - (CFG.ABANDON.halfLen || 26);
      const a1 = this.abandon.s + (CFG.ABANDON.halfLen || 26);
      if (!this.abandon.fired && front >= a0) {
        this.abandon.fired = true;
        if (Z.Zombies && Z.Zombies.platformWave) {
          Z.Zombies.platformWave(this, this.abandon.s, Math.max(6, Math.round((CFG.ABANDON.entryWave || 26) * (this.abandon.waveScale || 1))), true);
        }
        if (Z.UI && Z.UI.toast) Z.UI.toast('废弃站台：尸潮从站台涌出！', 'bad');
        if (Z.Sound) Z.Sound.play('boom', { vol: 0.9 });
        if (Z.Fx) Z.Fx.shake = Math.min(1, (Z.Fx.shake || 0) + 0.5);
      }
      // 站台范围内：车速越慢，增援越狠（停下来就一直刷）
      const inside = front > (a0 - 120) && (this.km - halfTr) < (a1 + (CFG.ABANDON.exitPad || 180));
      this.abandon.active = inside;
      if (inside) {
        const dt2 = this._lastDt || 0.016;
        const stopped = (this.speed || 0) < (CFG.ABANDON.slowSpeed || 9);
        this.abandon.t = (this.abandon.t || 0) + dt2;
        const every = stopped ? (CFG.ABANDON.trickleEvery || 0.9) : (CFG.ABANDON.trickleEvery || 0.9) * 3.5;
        const cap = CFG.ABANDON.cap || 260;
        if (this.abandon.t >= every && Z.Zombies && Z.Zombies.list.length < cap) {
          this.abandon.t = 0;
          const n2 = Math.max(2, Math.round((CFG.ABANDON.trickle || 6) * (stopped ? 1.6 : 1) * (this.abandon.waveScale || 1)));
          Z.Zombies.platformWave(this, this.abandon.s, n2, false);
          if (stopped && Z.UI && Math.random() < 0.35) Z.UI.toast('站台尸群持续增援！', 'bad');
        }
      }
    }

      // 到站
      const st = this.nextStation();
      if (st != null && this.km >= st) {
    const nextIdx = this.stationIdx + 1;
        if (nextIdx >= CFG.STATION_AT.length - 1) {         // 最后一站 = 安全点
          if (this.goal && this.goal.type === 'hold' && !this.held) {
            this.enterHold(); return;
          }
          this.km = this.totalKm; this.state = 'win'; this.finish(true); return;
        }
        this.km = st; this.openStation(nextIdx);
      }
    },

    // 守站：最后一站变成限时防守
    enterHold: function () {
      if (this.state === 'hold') return;          // 只进一次，否则倒计时会被反复重置
      this.km = this.totalKm;
      this.speed = 0;
      this.state = 'hold';
      this.holdT = this.goal.sec || 60;
      this.boardAcc = 0;
      if (Z.UI) { Z.UI.toast('守住车站 ' + Math.round(this.holdT) + ' 秒！', 'bad'); Z.UI.closeStation(); }
      if (Z.Sound) Z.Sound.play('alarm');
      if (Z.Tips) Z.Tips.tip('goalHold');
    },

    checkGoal: function (dt) {
      const g = this.goal;
      if (!g) return;
      // 护送：货柜被打爆就失败
      if (g.type === 'escort') {
        let cargo = null;
        for (const c of this.cars) if (c.type === 'cargo') cargo = c;
        if (!cargo || cargo.dead) {
          this.goalFail = '货柜被打爆了';
          this.gameOver();
        }
        return;
      }
      // 限速：连续低于阈值累计 grace 秒就失败
      if (g.type === 'sprint' && this.state === 'run') {
        const kmh = this.speed * 3.6;
        if (kmh < (g.minKmh || 80)) this.sprintT += dt;
        else this.sprintT = Math.max(0, this.sprintT - dt * (CFG.GOAL.sprint.recover || 0.6));
        if (this.sprintT > (g.grace || CFG.GOAL.sprint.grace)) {
          this.goalFail = '速度掉到 ' + (g.minKmh || 80) + ' km/h 以下太久';
          this.gameOver();
        }
        return;
      }
      // 守站：倒计时结束就赢
      if (this.state === 'hold') {
        this.holdT -= dt;
        this.boardAcc = (this.boardAcc || 0) + dt;
        if (this.holdT <= 0) {
          this.held = true;
          this.state = 'win';
          this.finish(true);
        }
      }
    },

    openEndlessStation: function () {
      this.speed = 0;
      this.state = 'station';
      // 绑定到世界里真实存在的那个站台（名字/位置都从 World.stations 来）
      let match = null, best = 1e9;
      for (const st of (Z.World.stations || [])) {
        const d = Math.abs(st.s - this.km);
        if (d < best) { best = d; match = st; }
      }
      this.station = match
        ? { idx: match.idx, name: match.name, at: match.s, isStart: !!match.isStart, endless: true }
        : { idx: -1, endless: true, isStart: false };
      this.boardAcc = 0;
      if (Z.Sound) Z.Sound.play('chime', { vol: 0.7 });
      if (Z.UI) Z.UI.openStation(this.station);
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
      this.rescueDone = {};          // 每站每节人员车厢只能抢救一次
      if (Z.Sound) Z.Sound.play('chime', { vol: 0.7 });
      if (idx > 0 && Z.Tips) Z.Tips.tip('station');
      if (Z.UI) Z.UI.openStation(this.station);
      if (Z.Save) Z.Save.save(this);
    },

    departStation: function () {
      if (this.state !== 'station') return;
      this.state = 'run';
      this.speed = Math.max(this.speed, 2);
      this.station = null;                 // 站台只在停靠期间存在
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
      if (car.hp <= 0 && Z.Meta && Z.Meta.hasBranch && Z.Meta.hasBranch('regen', 'B') && !this.emergencyUsed) {
        this.emergencyUsed = true;
        for (const c of this.cars) if (!c.dead) c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.20);
        if (Z.UI) Z.UI.toast('应急供电：全场回复 20% 耐久', 'good');
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
      if (!this.rescueDone) this.rescueDone = {};
      let n = 0;
      for (const c of this.passengerCars()) {
        const key = this.cars.indexOf(c);
        if (this.rescueDone[key]) continue;                 // 本站已经抢救过
        if (c.hp / c.maxHp < 0.4) continue;                 // 受损太重，救不了
        const add = Math.min(CFG.REFUGEE.rescueRate, CFG.REFUGEE.perCar - c.refugees);
        if (add > 0) { c.refugees += add; n += add; this.rescueDone[key] = true; }
      }
      return n;
    },

    // 抢救按钮状态：能不能点、为什么不能点
    rescueState: function () {
      const list = this.passengerCars();
      if (!list.length) return { ok: false, reason: '没有人员车厢' };
      let usable = false, damaged = false, already = false;
      for (const c of list) {
        const key = this.cars.indexOf(c);
        if (this.rescueDone && this.rescueDone[key]) { already = true; continue; }
        if (c.hp / c.maxHp < 0.4) { damaged = true; continue; }
        if (c.refugees < CFG.REFUGEE.perCar) usable = true;
      }
      if (usable) return { ok: true, reason: '' };
      if (damaged && !already) return { ok: false, reason: '人员车厢受损（<40%），无法抢救' };
      if (already) return { ok: false, reason: '本班已抢救（每站一次）' };
      return { ok: false, reason: '车厢已满员' };
    },

    // 部分维修：按现有废料修到上限，优先修车头
    repairPartial: function (budget) {
      const list = [];
      let total = 0;
      for (const c of this.cars) {
        if (c.dead) continue;
        const d = c.maxHp - c.hp;
        if (d > 0.5) { list.push({ c: c, d: d }); total += d; }
      }
      if (!total) return { hp: 0, cost: 0 };
      const unit = CFG.ECON.repairCostPerHp || 0.6;
      const hp = Math.min(total, Math.floor(budget / unit));
      if (hp <= 0) return { hp: 0, cost: 0 };
      // 车头优先（第一节就是车头，玩家最容易被它判负）
      list.sort(function (a, b) { return (b.c.type === 'engine' ? 1 : 0) - (a.c.type === 'engine' ? 1 : 0); });
      let left = hp;
      for (const it of list) {
        if (left <= 0) break;
        const take = Math.min(it.d, left);
        it.c.hp += take; it.c.tier = 0; left -= take;
      }
      return { hp: Math.round(hp), cost: Math.round(hp * unit) };
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
    // 站台里调整编组顺序（车头永远在最前）
    moveCar: function (idx, dir) {
      if (this.state !== 'station') return false;
      const j = idx + dir;
      if (idx <= 0 || j <= 0) {
        if (Z.UI) Z.UI.toast('车头必须留在最前面', 'bad');
        return false;
      }
      if (j < 0 || j >= this.cars.length) return false;
      const tmp = this.cars[idx];
      this.cars[idx] = this.cars[j];
      this.cars[j] = tmp;
      if (Z.Save) Z.Save.save(this);
      return true;
    },

    discardCar: function (idx) {
      const c = this.cars[idx];
      if (!c || this.cars.length <= 2) return false;
      if (c.type === 'engine') {
        if (Z.UI) Z.UI.toast('车头丢不得——没有它列车根本走不了', 'bad');
        return false;
      }
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
      let repairCars = 0;
      for (const c of this.cars) if (c.type === 'repair' && !c.dead) repairCars++;
      const parkBonus = Math.max(0.55, 1 - CFG.CAR_TYPES.repair.parkSpeedup * repairCars);
      this.parkDur = CFG.TRAIN.repairSec * metaRepair
        * ((Z.Meta && Z.Meta.has5 && Z.Meta.has5('repair')) ? 0.85 : 1)
        * parkBonus;
      if (this.stats) this.stats.repairs++;
      if (Z.UI) Z.UI.toast('轨道被撬断 · 停车防守 ' + Math.round(this.parkDur) + ' 秒', 'bad');
      if (Z.Sound) Z.Sound.play('alarm');
      if (Z.Tips) Z.Tips.tip('repair');
      if (Z.Zombies) Z.Zombies.spawnMiniBossChance(this, CFG.PARK.miniBossChance);
      if (Z.Fx) Z.Fx.shake = 1;
    },
    endPark: function () {
      if (Z.Meta && Z.Meta.hasBranch && Z.Meta.hasBranch('repair', 'B')) {
        for (const c of this.cars) if (!c.dead) c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.15);
        if (Z.UI) Z.UI.toast('备件整备：全场 +15% 耐久', 'good');
      }
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
      if (this.endless) {
        if (this.km >= this.nextBossKm) {
          this.nextBossKm += CFG.ENDLESS.bossKm * 1000;
          if (Z.Zombies) Z.Zombies.spawnBoss(this, 'armor');
          if (Z.UI) Z.UI.toast('Boss 出现！', 'bad');
          if (Z.Fx) Z.Fx.shake = 1;
        }
        return;
      }
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
      if (this.endless) return;
      if (this.state === 'win') return;
      if (this.state === 'hold') return;          // 守站中：交给 checkGoal 计时，别再触发一次
      if (this.km >= this.totalKm) {
        // 守站关：到终点先守站，倒计时结束才算赢
        if (this.goal && this.goal.type === 'hold' && !this.held) { this.enterHold(); return; }
        this.km = this.totalKm; this.state = 'win'; this.finish(true);
      }
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
      if (this.endless) {
        res.endless = true;
        if (Z.Save && Z.Save.endlessBest) {
          const prev = Z.Save.endlessBest();
          res.prevBest = prev;
          res.isBest = !prev || res.km > prev.km;
          res.bestPoints = prev ? Math.max(prev.km, res.km) : res.km;
          if (res.isBest) Z.Save.setEndlessBest({ km: res.km, kills: res.kills, cars: res.maxCars, at: Date.now() });
        }
        if (Z.Meta) Z.Meta.addPoints(res.points);
        if (Z.UI) Z.UI.showResult(res, false);
        return;
      }
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
      const engineDead = !!(this.cars[0] && this.cars[0].dead);
      const st = this.stats || { t: 0, maxSpeed: 0, maxCars: this.cars.length, deaths: 0, repairs: 0 };
      // 完美奖励与结算面板的「伤亡」同源：都用 st.deaths（此前误用从未赋值的 this.deadRefugees，
      // 导致 +150 永远发不出来）。见 docs/评审-代码与交互-v1.md P0-1。
      const perfect = (deadCars === 0 ? 200 : 0) + ((st.deaths || 0) === 0 ? 150 : 0);
      // 弹药/燃料已无限（ECON.infinite*），折算只算真正花得掉的资源；
      // 否则「剩余折算」会变成每局固定 +320 的常数，和打法无关。见 docs/评审-代码与交互-v1.md P0-2。
      const leftover = Math.round(this.scrap * 0.5);
      const penalty = deadCars * 120;
      const base = miles + esc + combat + perfect + leftover - penalty;
      const points = Math.max(0, Math.round(base * (win ? 1 : 0.35)));
      const carLoss = this.cars.length ? deadCars / this.cars.length : 0;
      const refRate = ref / Math.max(1, this.capacity());
      if (this.endless) {
        const endLine = '列车开不动了——你在铁轨上撑了 ' + km.toFixed(1) + ' 公里，挂了 ' + this.cars.length + ' 节车厢。';
        return {
          endless: true, grade: '崩', line: endLine, stats: st, km: km, refugees: ref, kills: this.kills,
          bossKills: this.bossKills, capacity: this.capacity(), deadCars: deadCars, repairs: st.repairs,
          maxSpeed: st.maxSpeed, maxCars: st.maxCars, timeSec: st.t, points: Math.round(km * 120 + this.kills * 0.5),
          miles: Math.round(km * 120), esc: 0, combat: 0, perfect: 0, leftover: 0, penalty: 0, level: this.level
        };
      }
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
      if (this.goalFail) line = this.goalFail + '。' + line;
      else if (this.goal && this.goal.type !== 'reach' && win) {
        line = (this.goal.type === 'escort' ? '货柜 intact' : this.goal.type === 'sprint' ? '全程没有掉速' : '守住了车站') + '。' + line;
      }
      return {
        grade: grade, line: line, goalFail: this.goalFail || '', stats: st, carLoss: carLoss, refRate: refRate,
        capacity: this.capacity(), deadRefugees: st.deaths, repairs: st.repairs,
        maxSpeed: st.maxSpeed, maxCars: st.maxCars, timeSec: st.t,
        win: !!win, km: km, refugees: ref, kills: this.kills, bossKills: this.bossKills,
        deadCars: deadCars, engineDead: engineDead, perfect: perfect, leftover: leftover, penalty: penalty,
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
