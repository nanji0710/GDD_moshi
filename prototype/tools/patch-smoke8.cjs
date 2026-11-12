const fs = require('fs');
const f = 'E:/github/sss/prototype/tools/smoke.mjs';
let s = fs.readFileSync(f, 'utf8');
if (s.includes('[15] 界面与科技质变')) { console.log('already'); process.exit(0); }
const anchor = "} catch (e) {\n  fail++";
const i = s.indexOf(anchor);
const block = `  console.log('\\n[15] 界面与科技质变')
  await ev('window.ZT.UI.showStart()')
  await sleep(200)
  check('开始页有「开始游戏」与「科技」', await ev(\`(() => {
    const t = document.querySelector('.start-root');
    if (!t) return false;
    const btns = [...t.querySelectorAll('.start-btn')].map(b => b.textContent);
    return btns.some(x => x.indexOf('开始游戏') >= 0) && btns.some(x => x.indexOf('科技') >= 0);
  })()\`))
  await ev('window.ZT.UI.showLevels()')
  await sleep(200)
  check('关卡地图画出 12 个城市节点', await ev('document.querySelectorAll(".map-city").length') === 12)
  check('地图按经纬度落在国境内', await ev(\`(() => {
    const svg = document.querySelector('.china-map');
    const land = svg.querySelector('.map-land');
    return !!land && land.getAttribute('points').split(' ').length > 20;
  })()\`))
  await ev('window.ZT.UI.showTech()')
  await sleep(200)
  check('科技页有 6 条强化线', await ev('document.querySelectorAll(".panel-tech .mrow").length') === 6)
  check('科技页标出 Lv5 质变', await ev('document.querySelectorAll(".panel-tech .milestone").length') === 6)

  const ms = JSON.parse(await ev(\`(() => {
    const M = ZT.Meta, R = ZT.Run;
    const keep = JSON.parse(JSON.stringify(M.levels));
    M.levels.hp = 5;
    const car = R.cars[0];
    const wasDead = car.dead;
    car.dead = false; car.revived = false; car.hp = car.maxHp;
    R.damageCar(car, 999999);
    const rescued = !car.dead && Math.abs(car.hp / car.maxHp - 0.15) < 0.06;
    M.levels.hp = 0;
    car.dead = wasDead; car.revived = false; car.hp = car.maxHp;
    M.levels.repair = 0;
    R.state = 'run'; R.ripTrack(200); const d0 = R.parkDur;
    M.levels.repair = 5;
    R.state = 'run'; R.trackDamage = 0; R.ripTrack(200); const d5 = R.parkDur;
    M.levels = keep;
    R.state = 'run'; R.trackDamage = 0;
    return JSON.stringify({ rescued: rescued, d0: d0, d5: d5 });
  })()\`))
  check('血量 Lv5：车厢免死一次并以 15% 复活', ms.rescued === true, ms)
  check('维修 Lv5：修轨时长再缩短', ms.d5 < ms.d0 * 0.72, ms)
`;
s = s.slice(0, i) + block + s.slice(i);
fs.writeFileSync(f, s);
console.log('milestone checks added');
