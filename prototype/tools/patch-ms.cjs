const fs = require('fs');
const P = 'E:/github/sss/prototype/';
function patch(file, pairs) {
  const f = P + file;
  let s = fs.readFileSync(f, 'utf8');
  let n = 0; const miss = [];
  for (const [a, b] of pairs) {
    if (!s.includes(a)) { miss.push(a.slice(0, 60)); continue; }
    s = s.split(a).join(b); n++;
  }
  fs.writeFileSync(f, s);
  console.log(file, '->', n, miss.length ? ('MISS ' + JSON.stringify(miss)) : '');
}

// ---------- cfg：给每条线写清 Lv5 质变 ----------
patch('js/cfg.js', [
  [`{ key: 'speed',  name: '列车速度', base: 375, per: 0.02, max: 0.20, unit: '%', desc: '最高速度 +2%/级' },`,
   `{ key: 'speed',  name: '列车速度', base: 375, per: 0.02, max: 0.20, unit: '%', desc: '最高速度 +2%/级', ms: 'Lv5：起步加速度 +40%' },`],
  [`{ key: 'hp',     name: '列车血量', base: 505, per: 0.03, max: 0.30, unit: '%', desc: '车厢耐久 +3%/级' },`,
   `{ key: 'hp',     name: '列车血量', base: 505, per: 0.03, max: 0.30, unit: '%', desc: '车厢耐久 +3%/级', ms: 'Lv5：每节车厢每局免死一次（15% 复活）' },`],
  [`{ key: 'rof',    name: '武器攻速', base: 375, per: 0.02, max: 0.20, unit: '%', desc: '全武器射速 +2%/级' },`,
   `{ key: 'rof',    name: '武器攻速', base: 375, per: 0.02, max: 0.20, unit: '%', desc: '全武器射速 +2%/级', ms: 'Lv5：换目标间隔 0.25 → 0.12 秒' },`],
  [`{ key: 'dmg',    name: '武器攻击力', base: 505, per: 0.03, max: 0.30, unit: '%', desc: '全武器伤害 +3%/级' },`,
   `{ key: 'dmg',    name: '武器攻击力', base: 505, per: 0.03, max: 0.30, unit: '%', desc: '全武器伤害 +3%/级', ms: 'Lv5：对精英/Boss 额外 +20%' },`],
  [`{ key: 'repair', name: '维修速度', base: 265, per: 0.04, max: 0.40, unit: '%', desc: '修轨时长 -4%/级' },`,
   `{ key: 'repair', name: '维修速度', base: 265, per: 0.04, max: 0.40, unit: '%', desc: '修轨时长 -4%/级', ms: 'Lv5：修轨时长再 -15%' },`],
  [`{ key: 'regen',  name: '列车自动回血', base: 265, per: 0.4, max: 4, unit: 'HP/s', desc: '每节车厢 +0.4 HP/s' }`,
   `{ key: 'regen',  name: '列车自动回血', base: 265, per: 0.4, max: 4, unit: 'HP/s', desc: '每节车厢 +0.4 HP/s', ms: 'Lv5：停车时回血 ×2.5' }`]
]);

// ---------- meta：里程碑判定 ----------
patch('js/meta.js', [
  [`    maxed: function (key) { return this.levels[key] >= 10; },`,
   `    maxed: function (key) { return this.levels[key] >= 10; },
    has5: function (key) { return (this.levels[key] || 0) >= 5; },`]
]);

// ---------- state：起步加速 / 停车回血 / 修轨再减 ----------
patch('js/state.js', [
  [`      const t = CFG.TRAIN;
      if (this.speed < limit) this.speed = Math.min(limit, this.speed + t.accel * dt);`,
   `      const t = CFG.TRAIN;
      const accelMul = (Z.Meta && Z.Meta.has5 && Z.Meta.has5('speed')) ? 1.4 : 1;
      if (this.speed < limit) this.speed = Math.min(limit, this.speed + t.accel * accelMul * dt);`],
  [`      const regen = Z.Meta ? Z.Meta.regen() : 0;
      if (regen > 0) for (const c of this.cars) if (!c.dead && c.hp < c.maxHp) c.hp = Math.min(c.maxHp, c.hp + regen * dt);`,
   `      let regen = Z.Meta ? Z.Meta.regen() : 0;
      if (regen > 0 && this.state === 'parked' && Z.Meta && Z.Meta.has5 && Z.Meta.has5('regen')) regen *= 2.5;
      if (regen > 0) for (const c of this.cars) if (!c.dead && c.hp < c.maxHp) c.hp = Math.min(c.maxHp, c.hp + regen * dt);`],
  [`      this.parkDur = CFG.TRAIN.repairSec * metaRepair;`,
   `      this.parkDur = CFG.TRAIN.repairSec * metaRepair * ((Z.Meta && Z.Meta.has5 && Z.Meta.has5('repair')) ? 0.85 : 1);`]
]);

// ---------- train：换目标更快 / 打精英更疼 ----------
patch('js/train.js', [
  [`          w.retarget = 0.25;`,
   `          w.retarget = (Z.Meta && Z.Meta.has5 && Z.Meta.has5('rof')) ? 0.12 : 0.25;`],
  [`  function hit(zb, dmg, run) {
    if (!zb || zb.dead) return;
    if (Z.Sound) Z.Sound.play('hit', { vol: 0.35 });`,
   `  function hit(zb, dmg, run) {
    if (!zb || zb.dead) return;
    // 攻击力 Lv5：对精英/Boss 额外 +20%
    if ((zb.elite || zb.boss || zb.mini) && Z.Meta && Z.Meta.has5 && Z.Meta.has5('dmg')) dmg *= 1.2;
    if (Z.Sound) Z.Sound.play('hit', { vol: 0.35 });`]
]);

// ---------- zombies：血量 Lv5 的"免死一次" ----------
patch('js/zombies.js', [
  [`            if (car.hp <= 0) {
              car.dead = true;`,
   `            if (car.hp <= 0 && !car.revived && Z.Meta && Z.Meta.has5 && Z.Meta.has5('hp')) {
              car.hp = Math.round(car.maxHp * 0.15);
              car.revived = true;
              if (Z.UI) Z.UI.toast(CFG.CAR_TYPES[car.type].name + ' 撑住了（科技·免死）', 'good');
            }
            if (car.hp <= 0) {
              car.dead = true;`]
]);

console.log('done');
