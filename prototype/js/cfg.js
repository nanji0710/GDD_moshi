'use strict';
// 全部可调参数（GDD v1.2）。改数值只改这里。
window.ZT = window.ZT || {};
(function (Z) {
  Z.CFG = {
    VERSION: '3.0.0',

    CAM: { zoom: 2.4, minZ: 1.0, maxZ: 6.0, tilt: 0.58, tiltMin: 0, followRate: 4.2, lookAhead: 40, hScale: 1.6 },

    TIME: { fixed: 1 / 60, speeds: [0, 1, 2, 3] },

    // ---------------- 列车 ----------------
    TRAIN: {
      carLenM: 22, carGapM: 2.2, carHalfW: 3.4, heightM: 4.6,
      maxSpeed: 50,            // 基础最高速 m/s（180 km/h）
      accel: 5.0, brake: 7.0,
      speedPerCar: 0.03,       // 每节 -3%（不设上限，也不设下限）
      powerBonus: 0.08,        // 动力/加速车厢 +8%
      repairSec: 15,           // 修轨基础时长
      repairInstantCost: 150,  // 紧急抢修（-3 秒）
      carGainKm: 2.0,          // 每 2.0 km 获得一节车厢
      startCars: ['engine', 'passenger']
    },

    // 车厢类型（同类型可重复获取）
    CAR_TYPES: {
      engine:    { name: '车头',     hp: 800,  slots: 1, mass: 1, color: '#8f9aa8' },
      passenger: { name: '人员车厢', hp: 700,  slots: 1, mass: 1, color: '#7f8f6a', refugees: 12 },
      weapon:    { name: '武器车厢', hp: 600,  slots: 2, mass: 1, color: '#7d8794' },
      power:     { name: '动力车厢', hp: 500,  slots: 0, mass: 1, color: '#8a7a5e', power: 1 },
      armor:     { name: '装甲车厢', hp: 1400, slots: 1, mass: 1, color: '#5f6b78', adjacentGuard: 0.4 },
      repair:    { name: '修理车厢', hp: 500,  slots: 0, mass: 1, color: '#7a8a74',
                   repairAura: 9,      // 每秒给相邻车厢回 9 点
                   parkSpeedup: 0.15 } // 停车修轨再快 15%（多节可叠加，最多 45%）
    },
    // 随机三选一权重
    CAR_WEIGHT: { weapon: 32, passenger: 26, power: 16, armor: 16, repair: 10 },

    // ---------------- 武器 ----------------
    // dps = 理论每秒伤害（已修正"把 dps 当单发"的旧 bug）；rof = 每秒发数
    WEAPONS: {
      mg: {
        name: '12.7mm 机枪塔', short: '机枪', cost: 90, tier: 1,
        range: 95, dps: 68, rof: 9, ammoPerShot: 1, mode: 'hitscan', color: '#ffd479', aimRate: 5.0,
        forms: {
          A: { name: '双联装', rofMul: 1.9, dmgMul: 0.55, desc: '泼水式压制，打群' },
          B: { name: '重弹', rofMul: 0.65, dmgMul: 1.7, desc: '点爆，打精英' }
        }
      },
      flamer: {
        name: '凝固汽油喷射器', short: '喷火', cost: 160, tier: 2,
        range: 42, dps: 150, rof: 8, ammoPerShot: 7, mode: 'cone', coneDeg: 52, targets: 6, color: '#ff7a2f', aimRate: 2.4,
        forms: {
          A: { name: '广域', coneMul: 1.63, rangeMul: 0.85, desc: '一片烧过去' },
          B: { name: '聚焦', rangeMul: 1.45, coneMul: 0.6, desc: '一条火龙，烧 Boss' }
        }
      },
      flak: {
        name: '35mm 近防火炮', short: '近防', cost: 220, tier: 2,
        range: 175, dps: 60, rof: 4, ammoPerShot: 3, mode: 'burst', burst: 3, color: '#9fe0ff', aimRate: 2.0,
        forms: {
          A: { name: '高频', rofMul: 1.5, dmgMul: 0.72, desc: '弹幕压小怪' },
          B: { name: '重炮', rofMul: 0.55, dmgMul: 2.3, desc: '拆装甲' }
        }
      },
      tesla: {
        name: '电磁弧塔', short: '电磁', cost: 260, tier: 3,
        range: 70, dps: 62, rof: 2.2, ammoPerShot: 1, mode: 'chain', chain: 3, color: '#b79bff', aimRate: 3.4,
        forms: {
          A: { name: '链式', chainAdd: 2, desc: '一发串五个' },
          B: { name: '过载', dmgMul: 1.8, stun: 1.5, chainAdd: -2, desc: '单体控场' }
        }
      },
      mortar: {
        name: '82mm 迫击炮', short: '迫击', cost: 300, tier: 3,
        range: 230, dps: 38, rof: 0.6, ammoPerShot: 1, mode: 'shell', splash: 30, color: '#ffb347', aimRate: 1.2,
        forms: {
          A: { name: '集束', salvo: 3, dmgMul: 0.5, splashMul: 0.6, desc: '三连覆盖' },
          B: { name: '重型', dmgMul: 2.0, splashMul: 1.5, rofMul: 0.75, desc: '一发拆迁' }
        }
      }
    },
    WEAPON_ORDER: ['mg', 'flamer', 'flak', 'tesla', 'mortar'],

    // 10 级成长：Lv3 选形态，Lv4-10 纯数值
    WEAPON: {
      maxLevel: 10,
      formLevel: 3,
      costBase: 25, costGrowth: 1.30,
      dpsPerLevel: 0.12,       // Lv2 起每级 +12%
      rangePerLevel: 0.02,
      formDpsMul: 1.35         // 形态整体上修（形态是"定性"而非"定量"）
    },

    // ---------------- 丧尸 ----------------
    ZOMBIE: {
      hp: 26, speed: 2.5, attack: 7, attackRate: 1.1, attackRange: 6,
      maxAliveBase: 120, maxAlivePerLevel: 18,
      scrap: 2, eliteScrap: 5, burnDps: 7, bossScrap: 250, miniScrap: 200,
      eliteHpMul: 3.4, eliteAtkMul: 2.2
    },
    WAVE: { baseInterval: 28, intervalPerLevel: 1.2, minInterval: 12 },
    DENSITY: { base: 90, perLevel: 10 },     // 每公里击杀数 90 → 200

    // 撬轨（意外停车）
    PARK: {
      trackDurability: 100,
      ripPerSec: 11,
      slowAtDamage: 60,        // 损到 60 限速
      spawnMul: 2.2,           // 停车时刷怪倍率
      miniBossChance: 0.10,    // 每次停车判定一次
      miniBossHp: 600,
      miniBossScrap: 150,
      scrapMul: 0.6            // 停车时击杀废料系数
    },

    // 难民
    REFUGEE: {
      perCar: 12,
      tiers: [0.8, 0.6, 0.4, 0.2],   // 跌破即死 2 人
      deathPerTier: 2,
      boardPerSec: 2,                 // 站台每 0.5 秒 1 人 → 每秒 2 人
      rescueRate: 3
    },

    // ---------------- 局内经济 ----------------
    ECON: {
      startScrap: 500, startAmmo: 1200, startFuel: 100,
      infiniteAmmo: true, infiniteFuel: true,   // 不再为弹药/燃料发愁，废料是唯一资源
      starterWeapon: 'mg',      // 开局白送一把，否则第一个站之前杀不了怪 = 没有收入
      fuelPerKm: 9.5,
      ammoBuy: { size: 300, cost: 75 },
      fuelBuy: { size: 25, cost: 55 },
      repairCostPerHp: 0.6,
      stationBonus: 80,             // 每站通关奖励
      supplyPerStation: 190         // 设计用：每站必要补给开销
    },

    // 站台 buff（本关生效）
    BUFFS: {
      belt:    { name: '弹链加速', cost: 120, desc: '全车射速 +15%', rof: 1.15 },
      ap:      { name: '穿甲弹',   cost: 150, desc: '对精英/Boss 伤害 +25%', ap: 1.25 },
      tank:    { name: '备用油箱', cost: 90,  desc: '燃料消耗 -30%', fuel: 0.7 },
      plate:   { name: '临时装甲', cost: 140, desc: '本关首次车厢损毁免伤', plate: 1 },
      wrench:  { name: '老练扳手', cost: 70,  desc: '修轨速度 +50%', repair: 1.5 },
      tail:    { name: '顺风',     cost: 60,  desc: '最高速度 +12%', speed: 1.12 }
    },

    // 技能卡（第 2/3/4 关固定发，第 5 关起三选一）
    SKILLS: [
      { key: 'brake', name: '紧急制动', key2: 'Q', cd: 25, dur: 3, color: '#6fb6e0', desc: '速度压到 30%，3 秒' },
      { key: 'salvo', name: '全弹齐射', key2: 'W', cd: 40, dur: 5, color: '#ffb347', desc: '射速 ×2，5 秒' },
      { key: 'over',  name: '强制过载', key2: 'E', cd: 45, dur: 6, color: '#e05a4a', desc: '伤害 ×1.6、弹药 ×2，6 秒' }
    ],

    // ---------------- 12 关 ----------------
    // km / 每公里击杀 / 精英率 / Boss（比例位置）/ 招牌
    LEVELS: [
      { n: 1,  city: '温州',     lon: 120.70, lat: 28.00, km: 10.7,  dens: 90,  elite: 0.020, bosses: [0.55], tag: '教学', biome: 'temperate', lm: { s: 0.62, type: 'tower', side: 1, off: 95 } },
      { n: 2,  city: '芜湖',     lon: 118.43, lat: 31.33, km: 12.7,  dens: 100, elite: 0.024, bosses: [0.55], tag: '第一座铁桥', mods: ['bridge'], biome: 'temperate', lm: { s: 0.64, type: 'twin', side: 1, off: 100 } },
      { n: 3,  city: '合肥',     lon: 117.23, lat: 31.82, km: 14.7,  dens: 110, elite: 0.028, bosses: [0.55], tag: '双波夹击', biome: 'temperate', lm: { s: 0.60, type: 'tower', side: -1, off: 100 } },
      { n: 4,  city: '徐州',     lon: 117.18, lat: 34.26, km: 16.7,  dens: 120, elite: 0.032, bosses: [0.55], tag: '编组场', biome: 'loess', lm: { s: 0.70, type: 'cluster', side: 1, off: 105 } },
      { n: 5,  city: '洛阳',     lon: 112.45, lat: 34.62, km: 18.7,  dens: 130, elite: 0.036, bosses: [0.55], tag: '首次撬轨', biome: 'loess', lm: { s: 0.66, type: 'twin', side: -1, off: 110 } },
      { n: 6,  city: '南昌',     lon: 115.89, lat: 28.68, km: 20.7,  dens: 140, elite: 0.040, bosses: [0.55], tag: '夜间段', mods: ['night'], biome: 'temperate', lm: { s: 0.64, type: 'cluster', side: 1, off: 100 } },
      { n: 7,  city: '长沙',     lon: 112.94, lat: 28.23, km: 22.7,  dens: 150, elite: 0.044, bosses: [0.40, 0.78], tag: '隧道群', mods: ['tunnel'], biome: 'mountain', lm: { s: 0.58, type: 'twin', side: 1, off: 120 } },
      { n: 8,  city: '贵阳',     lon: 106.63, lat: 26.65, km: 24.7,  dens: 160, elite: 0.048, bosses: [0.40, 0.78], tag: '高桥', biome: 'mountain', lm: { s: 0.62, type: 'cluster', side: -1, off: 110 } },
      { n: 9,  city: '重庆',     lon: 106.55, lat: 29.56, km: 26.7,  dens: 170, elite: 0.052, bosses: [0.40, 0.78], tag: '连续弯道', mods: ['canyon'], biome: 'mountain', lm: { s: 0.72, type: 'cluster', side: 1, off: 130 } },
      { n: 10, city: '昆明',     lon: 102.83, lat: 24.88, km: 28.7,  dens: 180, elite: 0.056, bosses: [0.40, 0.78], tag: '雨战', mods: ['rain'], biome: 'mountain', lm: { s: 0.66, type: 'tower', side: 1, off: 95 } },
      { n: 11, city: '兰州',     lon: 103.83, lat: 36.06, km: 30.7,  dens: 190, elite: 0.060, bosses: [0.40, 0.78], tag: '长直道', mods: ['straight'], biome: 'loess', lm: { s: 0.68, type: 'twin', side: -1, off: 105 } },
      { n: 12, city: '乌鲁木齐', lon: 87.62,  lat: 43.83, km: 32.7,  dens: 200, elite: 0.064, bosses: [0.40, 0.78], tag: '终章', biome: 'desert', lm: { s: 0.70, type: 'dome', side: 1, off: 120 } }
    ],

    // 每关站台（按比例放在里程上）
    // 站台位置（按里程比例）：0 = 出发站，最后一项 = 安全点（必须在线路终点 1.0）
    STATION_AT: [0, 0.30, 0.62, 1.0],

    // 城市色调（明度都压在地面 10–18% / 建筑 20–28%）
    PAL: {
      temperate: { name: '江南', fog: 'rgba(120,150,120,0.045)', g1: '#242419', g2: '#2e2e22', g3: '#1e1e16', g4: '#2a2a1e',
                   patch: ['#33331f', '#1a1a11', '#2b2b1b'], tree: ['#2b3a2b', '#33442f', '#26332b'],
                   wall: ['#2e2d26', '#292720', '#262c34'], roof: ['#403e34', '#3a372e', '#39404a'] },
      loess:     { name: '中原', fog: 'rgba(170,140,80,0.05)', g1: '#28241c', g2: '#332d22', g3: '#211d16', g4: '#2e281e',
                   patch: ['#3a3226', '#1d1913', '#302a20'], tree: ['#33341f', '#3c3a24', '#2a2c1a'],
                   wall: ['#322c22', '#2b261e', '#2f2a20'], roof: ['#46402f', '#3f392a', '#4a4234'] },
      mountain:  { name: '山城', fog: 'rgba(90,120,160,0.055)', g1: '#20261f', g2: '#2a3227', g3: '#19201a', g4: '#252c23',
                   patch: ['#2c3a2c', '#16201a', '#243026'], tree: ['#26382a', '#2e4231', '#1f2c22'],
                   wall: ['#2a2e2c', '#242826', '#2c3130'], roof: ['#37403c', '#333b37', '#3c453f'] },
      desert:    { name: '荒漠', fog: 'rgba(200,160,90,0.06)', g1: '#2b2820', g2: '#36322a', g3: '#221f19', g4: '#312d24',
                   patch: ['#3d3930', '#1f1c17', '#33302a'], tree: ['#33301f', '#3b3826', '#2a2818'],
                   wall: ['#332f26', '#2c2922', '#35312a'], roof: ['#4a4436', '#433d30', '#4f483a'] }
    },

    // 关卡变异：黑暗度 / 能见度上限（米）/ 天气系数
    VIS: { night: 0.80, tunnel: 0.90, rain: 0.22 },
    VIS_RANGE: { night: 165, tunnel: 120 },
    WEATHER: { rainBrake: 1.4, rainFlamer: 0.7 },
    BRIDGE: { spawnMul: 1.3, latMax: 7, rampM: 60 },   // 桥上只能沿轨道来
    STRAIGHT: { speedMul: 1.2, rateMul: 1.15, runnerChance: 0.32, aheadMin: 320, aheadMax: 700 },
    // Boss 招式：前摇 + 冷却（秒）
    BOSS: {
      windup: { charge: 0.9, summon: 0.7, rip: 0.6 },
      cd: { charge: 9, summon: 12, rip: 10 },
      chargeSpeed: 46, chargeMul: 9, summonCount: 6, ripMul: 1.4
    },

    ENDLESS: {
      pathKm: 120,        // 一条 120 km 的走廊，跑到头就算结束
      stationKm: 6,       // 每 6 km 一个补给站
      bossKm: 10,         // 每 10 km 一个 Boss
      lvlKm: 6,           // 每 6 km 视为 +1 关（难度爬升）
      stallSec: 3         // 速度接近 0 持续 3 秒 → 结束
    },
    HILL: { canyon: 34, mountain: 20, rMin: 34, rMax: 88, offMin: 46, offMax: 124 },

    // ---------------- 局外：6 条独立强化线 ----------------
    // 价格 = base × 1.42^(lv-1)；满一条 = base × 77.4
    // 设计约束：12 关全通一次约 62 000 点，**不足以点满 6 条**（需约 132 000）
    META: [
      { key: 'speed',  name: '列车速度', base: 375, per: 0.02, max: 0.20, unit: '%', desc: '最高速度 +2%/级', ms: 'Lv5：起步加速度 +40%' },
      { key: 'hp',     name: '列车血量', base: 505, per: 0.03, max: 0.30, unit: '%', desc: '车厢耐久 +3%/级', ms: 'Lv5：每节车厢每局免死一次（15% 复活）' },
      { key: 'rof',    name: '武器攻速', base: 375, per: 0.02, max: 0.20, unit: '%', desc: '全武器射速 +2%/级', ms: 'Lv5：换目标间隔 0.25 → 0.12 秒' },
      { key: 'dmg',    name: '武器攻击力', base: 505, per: 0.03, max: 0.30, unit: '%', desc: '全武器伤害 +3%/级', ms: 'Lv5：对精英/Boss 额外 +20%' },
      { key: 'repair', name: '维修速度', base: 265, per: 0.04, max: 0.40, unit: '%', desc: '修轨时长 -4%/级', ms: 'Lv5：修轨时长再 -15%' },
      { key: 'regen',  name: '列车自动回血', base: 265, per: 0.4, max: 4, unit: 'HP/s', desc: '每节车厢 +0.4 HP/s', ms: 'Lv5：停车时回血 ×2.5' }
    ],
    META_GROWTH: 1.42,

    // 涂装：只改车身，不改车顶的类型色（保证"一眼认出这是什么车厢"）
    SKINS: [
      { key: 'rust',   name: '锈铁',   cost: 0,   hull: '#4b5765', desc: '默认 · 战后拼装' },
      { key: 'olive',  name: '军绿',   cost: 400, hull: '#4a5240', desc: '残军涂装' },
      { key: 'night',  name: '夜行',   cost: 600, hull: '#2f3338', desc: '低可视度' },
      { key: 'rescue', name: '救援白', cost: 800, hull: '#767d85', desc: '红十字会旧涂装' }
    ],

    DEBUG: { showRanges: false }
  };

  // 派生：元升级总花费（用于文档/自检）
  Z.metaTotals = function () {
    const out = {};
    for (const m of Z.CFG.META) {
      let sum = 0;
      for (let lv = 1; lv <= 10; lv++) sum += Math.round(m.base * Math.pow(Z.CFG.META_GROWTH, lv - 1));
      out[m.key] = sum;
    }
    return out;
  };
})(window.ZT);
