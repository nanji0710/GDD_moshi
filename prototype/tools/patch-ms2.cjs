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

// ---------- state：把"车厢受伤"抽成可测试的方法 ----------
patch('js/state.js', [
  [`    // ---- 难民 ----`,
   `    // 车厢受伤：统一入口（血量科技的"免死一次"在这里）
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
      }
    },

    // ---- 难民 ----`]
]);

// ---------- zombies：改走 damageCar ----------
patch('js/zombies.js', [
  [`            car.hp = Math.max(0, car.hp - dmg);
            car.flash = 1;
            if (Z.Sound) Z.Sound.play('claw', { vol: 0.45 });
            Fx.shake = Math.min(1, Fx.shake + 0.05);
            Fx.text(tgt.x, tgt.y, 3.6, '-' + Math.round(dmg), '#ff8f8f');
            if (car.hp <= 0 && !car.revived && Z.Meta && Z.Meta.has5 && Z.Meta.has5('hp')) {
              car.hp = Math.round(car.maxHp * 0.15);
              car.revived = true;
              if (Z.UI) Z.UI.toast(CFG.CAR_TYPES[car.type].name + ' 撑住了（科技·免死）', 'good');
            }
            if (car.hp <= 0) {
              car.dead = true;
              if (Z.Sound) Z.Sound.play('boom', { vol: 0.8 });
              Fx.boom(tgt.x, tgt.y, 2.2, 10);
              Fx.shake = 1;
              if (Z.UI) Z.UI.toast(CFG.CAR_TYPES[car.type].name + ' 损毁', 'bad');
            }`,
   `            if (Z.Sound) Z.Sound.play('claw', { vol: 0.45 });
            Fx.shake = Math.min(1, Fx.shake + 0.05);
            Fx.text(tgt.x, tgt.y, 3.6, '-' + Math.round(dmg), '#ff8f8f');
            run.damageCar(car, dmg);
            if (car.dead) {
              if (Z.Sound) Z.Sound.play('boom', { vol: 0.8 });
              Fx.boom(tgt.x, tgt.y, 2.2, 10);
            }`]
]);

// ---------- ui：科技页显示质变说明 + 升级到 Lv5 时提示 ----------
patch('js/ui.js', [
  [`            h('b', null, m.name, m.milestone ? h('em', { class: 'milestone' }, 'Lv5 质变') : null),
            h('span', null, m.desc)),`,
   `            h('b', null, m.name, m.ms ? h('em', { class: 'milestone' }, 'Lv5') : null),
            h('span', null, m.desc),
            m.ms ? h('span', { class: 'ms' }, m.ms) : null),`],
  [`          onclick: function () {
            if (meta.buy(row.key)) { Z.UI.toast(m.name + ' 升到 Lv' + meta.levels[row.key], 'good'); Z.UI.showTech(); }
            else Z.UI.toast('里程点不足（需要 ' + row.cost + '）', 'bad');
          }`,
   `          onclick: function () {
            const before = meta.levels[row.key];
            if (meta.buy(row.key)) {
              const lv = meta.levels[row.key];
              if (before < 5 && lv >= 5 && m.ms) Z.UI.toast('质变解锁：' + m.ms, 'good');
              else Z.UI.toast(m.name + ' 升到 Lv' + lv, 'good');
              Z.UI.showTech();
            } else Z.UI.toast('里程点不足（需要 ' + row.cost + '）', 'bad');
          }`]
]);

console.log('done');
