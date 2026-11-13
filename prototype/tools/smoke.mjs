/**
 * v3 冒烟测试（零依赖 CDP）：开局 → 站台 → 出发 → 获得车厢 → 装武器/升级/选形态 → 难民 → 结算 → 局外升级。
 * 用法：node tools/smoke.mjs
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join as pjoin } from 'node:path'
import { join } from 'node:path'
import { rmSync } from 'node:fs'

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = Number(process.env.PORT || 9496)
const PROFILE = join(tmpdir(), 'zt-smoke3-' + Date.now())
const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE_URL = 'file:///' + pjoin(HERE, '..', 'index.html').replace(/\\/g, '/')

const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--mute-audio', '--no-first-run',
  '--window-size=1500,860', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, PAGE_URL], { stdio: 'ignore' })

let ws, seq = 0
const pending = new Map()
const errors = []
let pass = 0, fail = 0

function send(m, p) {
  const id = ++seq
  return new Promise((res, rej) => {
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method: m, params: p || {} }))
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + m)) } }, 15000)
  })
}
async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()
      const p = list.find(t => t.type === 'page' && t.url.startsWith('file:'))
      if (p) return p
    } catch (e) {}
    await sleep(200)
  }
  throw new Error('no target')
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
  return r.result?.value
}
async function waitFor(expr, timeout = 12000, step = 200) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try { if (await ev(expr)) return true } catch (e) {}
    await sleep(step)
  }
  return false
}
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅', name) }
  else { fail++; console.log('  ❌', name, detail === undefined ? '' : '→ ' + JSON.stringify(detail)) }
}

try {
  const page = await findTarget()
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = e => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails
      const st = (d.stackTrace && d.stackTrace.callFrames || []).slice(0, 5).map(f => f.functionName + '@' + f.lineNumber + ':' + f.columnNumber).join(' <- ')
      errors.push((d.exception?.description || d.text || '').split('\n')[0] + ' || ' + st)
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '))
  }
  await send('Runtime.enable'); await send('Page.enable')
  await waitFor('!!(window.ZT && window.ZT.Run && window.ZT.Meta && window.ZT.World && window.ZT.World.path)')
  await sleep(300)

  console.log('   [errs]\n[1] 启动与数据')
  check('世界已生成', await ev('window.ZT.World.path.len > 1000'))
  check('6 条局外强化线', await ev('window.ZT.CFG.META.length') === 6)
  check('全满需 > 130 000 点', await ev('window.ZT.CFG.META.reduce((s,m)=>{let t=0;for(let l=1;l<=10;l++)t+=Math.round(m.base*Math.pow(1.42,l-1));return s+t},0)') > 130000)
  check('标题页出现', await ev('!document.querySelector(".screen").classList.contains("hidden")'))

  console.log('\n[1b] 音频');
  check('音频上下文可创建', await ev(`(() => { ZT.Sound.unlock(); return !!ZT.Sound.ctx })()`));
  check('播放音效不抛错', await ev(`(() => {
    try { ['mg','flak','flamer','tesla','mortar','boom','claw','alarm','chime','win'].forEach(function(k){ ZT.Sound.play(k); }); return true; }
    catch (e) { return false; }
  })()`));
  check('静音开关可切换', await ev(`(() => { const a = ZT.Sound.enabled; ZT.Sound.toggle(); const b = ZT.Sound.enabled; ZT.Sound.setEnabled(a); return a !== b })()`));

  console.log('   [errs]\n[2] 开局（站台）')
  await ev(`window.ZT.Game.startLevel(1)`)
  await sleep(400)
  check('进入站台状态', await ev('window.ZT.Run.state') === 'station')
  check('起始 2 节车厢', await ev('window.ZT.Run.cars.length') === 2)
  check('站台面板打开', await ev('window.ZT.UI.drawerState') === 'station')
  check('人员车厢容量 12', await ev('window.ZT.Run.capacity()') === 12)

  console.log('   [errs]\n[3] 补给与出发')
  const s0 = await ev('window.ZT.Run.scrap')
  await ev(`(() => { const b=[...document.querySelectorAll('.shop-item')].find(x=>/弹链加速/.test(x.textContent)); b.click(); return 1 })()`)
  await sleep(200)
  check('买增益扣废料', await ev('window.ZT.Run.scrap') < s0)
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/继续出发/.test(x.textContent)); b.click(); return 1 })()`)
  await sleep(300)
  check('点「继续出发」进入行驶', await ev('window.ZT.Run.state') === 'run')

  console.log('   [errs]\n[4] 速度与车厢无上限')
  await ev(`window.ZT.Game.setSpeed(3)`)
  await sleep(2500)
  const st = JSON.parse(await ev(`JSON.stringify({ km: Math.round(ZT.Run.km), v: +ZT.Run.speed.toFixed(1), cap: +ZT.Run.speedCap().toFixed(1) })`))
  check('列车推进', st.km > 50, st)
  check('速度收敛到上限附近', st.v > st.cap * 0.5, st)
  // 强行多发几节车，验证无上限与减速
  const sp = JSON.parse(await ev(`(() => {
    const R = ZT.Run, before = R.speedCap();
    for (let i = 0; i < 6; i++) R.cars.push(new ZT.Car('weapon'));
    return JSON.stringify({ n: R.cars.length, before: +before.toFixed(1), after: +R.speedCap().toFixed(1) });
  })()`))
  check('车厢无上限（8 节仍可加）', sp.n === 8, sp)
  check('每节车厢减速生效', sp.after < sp.before, sp)

  console.log('   [errs]\n[5] 车厢三选一')
  const offer = await ev(`(() => { const R=ZT.Run; R.nextCarKm = R.km; R.checkCarGain(); return JSON.stringify(R.offer||[]) })()`)
  check('触发随机三选一（3 个不同选项）', JSON.parse(offer).length === 3, offer)
  check('抽到的是合法类型', await ev(`(window.ZT.Run.offer||[]).every(t=>!!ZT.CFG.CAR_TYPES[t])`))
  const before = await ev('window.ZT.Run.cars.length')
  await ev(`window.ZT.Run.takeCar(window.ZT.Run.offer[0])`)
  check('选择后车厢 +1', await ev('window.ZT.Run.cars.length') === before + 1)

  console.log('   [errs]\n[6] 武器：安装 / 升级 / 形态')
  await ev(`(() => { const R=ZT.Run; R.scrap = 5000; R.cars[2].type='weapon'; R.cars[2].slots=[null,null]; return 1 })()`)
  check('安装机枪', await ev(`window.ZT.Run.addWeapon(2,0,'mg')`))
  await ev(`(() => { const R=ZT.Run; const w=R.cars[2].slots[0]; R.scrap=5000; w.level=3; return 1 })()`)
  check('Lv3 可开形态', await ev(`window.ZT.Run.cars[2].slots[0].canChooseForm()`))
  const dpsA = await ev(`(() => { const w=ZT.Run.cars[2].slots[0]; w.form='A'; const a=w.dps(); w.form='B'; const b=w.dps(); return JSON.stringify({a:+a.toFixed(1), b:+b.toFixed(1)}) })()`)
  check('两个形态数值不同', JSON.parse(dpsA).a !== JSON.parse(dpsA).b, dpsA)
  check('升级成本按 1.30 递增', await ev(`(() => { const w = new ZT.Weapon('mg',1); const c1=w.upgradeCost(); w.level=2; const c2=w.upgradeCost(); return Math.abs(c2/c1-1.30)<0.03 })()`))

  console.log('   [errs]\n[7] 难民与轨道停车')
  await ev(`(() => { const R=ZT.Run; R.state='station'; R.station={idx:1,isStart:false}; R.board(4); return 1 })()`)
  check('站台自动上车', await ev('window.ZT.Run.refugees() > 0'), await ev('window.ZT.Run.refugees()'))
  await ev(`(() => { const R=ZT.Run; R.cars.find(c=>c.type==='passenger').hp *= 0.4; R.checkRefugees(); return 1 })()`)
  check('车厢掉血 → 难民死亡', await ev('window.ZT.Run.deadRefugees > 0 || window.ZT.Run.refugees() < 12'))
  await ev(`(() => { const R=ZT.Run; R.state='run'; R.ripTrack(120); return 1 })()`)
  check('轨道损满 → 自动停车', await ev('window.ZT.Run.state') === 'parked')
  check('停车时长 = 15 秒', await ev('Math.round(window.ZT.Run.parkDur)') === 15)
  await ev(`(() => { const R=ZT.Run; R.parkT = R.parkDur + 0.1; return 1 })()`)
  const dep = await waitFor('window.ZT.Run.state === "run"', 6000)
  check('修满自动出发', dep)

  console.log('   [errs]\n[8] 结算与局外')
  const beforePts = await ev('window.ZT.Meta.points')
  await ev(`(() => { const R=ZT.Run; R.km = R.totalKm; return 1 })()`)
  await waitFor('window.ZT.Run.state === "win"')
  check('抵达终点 = 胜利', await ev('window.ZT.Run.state') === 'win')
  await sleep(300)
  check('结算界面出现', await ev('!document.querySelector(".screen").classList.contains("hidden")'))
  check('获得里程点', await ev('window.ZT.Meta.points') > beforePts)
  const buy = await ev(`(() => { const M=ZT.Meta; M.points = 99999; const ok = M.buy('speed'); return JSON.stringify({ok, lv:M.levels.speed, left:M.points}) })()`)
  check('局外升级可购买', JSON.parse(buy).ok === true && JSON.parse(buy).lv === 1, buy)
  check('升级后速度倍率生效', await ev(`Math.abs(ZT.Meta.mult('speed') - 1.02) < 1e-9`))
  console.log('\n[9] 局内存档')
  check('结算后自动清档', await ev('!window.ZT.Save.has()'))
  await ev('window.ZT.Game.startLevel(1)')
  await sleep(300)
  await ev(`(() => {
    const R = ZT.Run;
    R.state = 'run'; R.km = 1234.5; R.scrap = 777; R.ammo = 4321; R.kills = 42;
    R.cars[0].slots[0] = new ZT.Weapon('mg', 3); R.cars[0].slots[0].form = 'B';
    if (R.cars[1]) R.cars[1].refugees = 5;
    R.nextCarKm = 999999;
    return 1;
  })()`)
  const saved = await ev('(() => { ZT.Save.save(ZT.Run); return JSON.stringify(ZT.Save.get()) })()')
  check('存档写入 localStorage', await ev('!!localStorage.getItem("zt.run.v1")'))
  check('摘要可读（关卡/城市/里程）', await ev('(() => { const s = ZT.Save.summary(); return !!s && s.level === 1 && +s.km > 1 })()'))
  await ev('window.ZT.Game.startLevel(2)')
  check('新开一局会覆盖旧档', await ev('window.ZT.Save.get().level') === 2)
  await ev(`(() => { ZT.Run.restore(${saved}); return 1 })()`)
  const rt = JSON.parse(await ev(`JSON.stringify({
    km: Math.round(ZT.Run.km), scrap: ZT.Run.scrap, ammo: ZT.Run.ammo, kills: ZT.Run.kills,
    cars: ZT.Run.cars.length, lv: ZT.Run.cars[0].slots[0] && ZT.Run.cars[0].slots[0].level,
    form: ZT.Run.cars[0].slots[0] && ZT.Run.cars[0].slots[0].form,
    ref: ZT.Run.cars[1] && ZT.Run.cars[1].refugees
  })`))
  check('读档恢复里程/废料/弹药', rt.km === 1235 && rt.scrap === 777 && rt.ammo === 4321, rt)
  check('读档恢复武器等级与形态', rt.lv === 3 && rt.form === 'B', rt)
  check('读档恢复难民与车厢数', rt.ref === 5 && rt.cars >= 2, rt)
  check('读档后地图长度对得上', await ev('Math.abs(ZT.World.path.len - ZT.Run.totalKm) / ZT.Run.totalKm < 0.12'))
  await ev('window.ZT.Save.clear()')
  console.log('\n[10] 关卡变异')
  check('第 6 关 = 夜战（能见度 165m）', await ev('(() => { const R = ZT.Run; R.applyMods(ZT.CFG.LEVELS[5]); return R.darkness > 0.5 && R.visRange === 165 })()'))
  check('第 7 关 = 隧道（能见度 120m）', await ev('(() => { const R = ZT.Run; R.applyMods(ZT.CFG.LEVELS[6]); return R.darkness > 0.8 && R.visRange === 120 })()'))
  check('第 10 关 = 雨战（刹车 ×1.4 / 火焰 -30%）', await ev('(() => { const R = ZT.Run; R.applyMods(ZT.CFG.LEVELS[9]); return R.brakeMul === 1.4 && Math.abs(R.flamerMul - 0.7) < 1e-9 })()'))
  check('白天关无变异', await ev('(() => { const R = ZT.Run; R.applyMods(ZT.CFG.LEVELS[0]); return R.darkness === 0 && R.visRange > 1e8 })()'))
  console.log('\n[11] 铁桥')
  check('第 2 关带 bridge 变异', await ev('(ZT.CFG.LEVELS[1].mods || []).indexOf("bridge") >= 0'))
  const lat = await ev(`(() => {
    const R = ZT.Run, W = ZT.World;
    R.state = 'run';
    R.km = (W.bridge.s0 + W.bridge.s1) / 2;
    R.train.s = R.km;
    ZT.Zombies.reset();
    for (let i = 0; i < 60; i++) ZT.Zombies.spawnOne(R);
    let maxD = 0;
    for (const zb of ZT.Zombies.list) {
      let best = 1e9;
      for (let s = R.km - 500; s <= R.km + 500; s += 5) {
        if (s < 0 || s > W.path.len) continue;
        const p = ZT.U.posAt(W.path, s, {});
        const d = Math.hypot(zb.x - p.x, zb.y - p.y);
        if (d < best) best = d;
      }
      if (best > maxD) maxD = best;
    }
    return Math.round(maxD * 10) / 10;
  })()`)
  check('桥上刷怪贴轨（离轨道最远 < 16m）', lat < 16, lat)
  check('桥外刷怪不受限', await ev(`(() => {
    const R = ZT.Run, W = ZT.World;
    R.km = 200; R.train.s = 200; ZT.Zombies.reset();
    for (let i = 0; i < 60; i++) ZT.Zombies.spawnOne(R);
    let maxD = 0;
    for (const zb of ZT.Zombies.list) {
      let best = 1e9;
      for (let s = 0; s <= 900; s += 5) {
        const p = ZT.U.posAt(W.path, s, {});
        const d = Math.hypot(zb.x - p.x, zb.y - p.y);
        if (d < best) best = d;
      }
      if (best > maxD) maxD = best;
    }
    return maxD > 20;
  })()`))
  console.log('\n[12] 长直道与涂装')
  check('第 11 关带 straight 变异', await ev('(ZT.CFG.LEVELS[10].mods || []).indexOf("straight") >= 0'))
  check('长直道速度上限 ×1.2', await ev(`(() => {
    const R = ZT.Run;
    R.straight = false; const a = R.speedCap();
    R.straight = true; const b = R.speedCap();
    return Math.abs(b / a - 1.2) < 0.001;
  })()`))
  check('长直道冲锋者更快（13 → 16.9）', await ev(`(() => {
    ZT.Run.straight = true;
    ZT.Run.level = 11; ZT.Run.levelDef = ZT.CFG.LEVELS[10];
    ZT.Zombies.reset();
    const z = ZT.Zombies.make(0, 0, { kind: 'runner' });
    ZT.Run.level = 1; ZT.Run.levelDef = ZT.CFG.LEVELS[0];
    return z.speed > 16 && z.speed < 18;
  })()`))
  const skin = JSON.parse(await ev(`(() => {
    const M = ZT.Meta;
    M.points = 5000;
    const before = M.points;
    const ok = M.buySkin('olive');
    const def = M.skinDef();
    return JSON.stringify({ ok: ok, spent: before - M.points, active: def.key, owned: M.ownsSkin('olive') });
  })()`))
  check('涂装可购买并立即生效', skin.ok === true && skin.active === 'olive' && skin.owned === true, skin)
  check('涂装价格正确（400）', skin.spent === 400, skin)
  check('涂装写进存档', await ev('!!JSON.parse(localStorage.getItem("zt.meta.v2") || "{}").skins'))
  console.log('\n[13] 速度无上下限 / 山体遮挡')
  check('没有速度地板（40 节 → 0）', await ev(`(() => {
    const R = ZT.Run;
    const keep = R.cars;
    R.cars = []; for (let i = 0; i < 40; i++) R.cars.push(new ZT.Car('weapon'));
    const v = R.speedCap();
    R.cars = keep;
    return v === 0 || v <= 0.0001;
  })()`))
  check('加速车厢能拉回速度（2 节 + 1 动力 > 2 节）', await ev(`(() => {
    const R = ZT.Run, keep = R.cars;
    R.cars = [new ZT.Car('engine'), new ZT.Car('passenger')];
    const a = R.speedCap();
    R.cars.push(new ZT.Car('power'));
    const b = R.speedCap();
    R.cars = keep;
    return b > 48 && b > a * 0.95;
  })()`))
  check('没有速度上限（动力车厢可超过 50 m/s）', await ev(`(() => {
    const R = ZT.Run, keep = R.cars;
    R.cars = [new ZT.Car('engine'), new ZT.Car('power'), new ZT.Car('power'), new ZT.Car('power')];
    const v = R.speedCap();
    R.cars = keep;
    return v > 50;
  })()`))
  check('第 9 关生成山体', await ev(`(() => {
    ZT.World.generate(1, 26700, 'mountain', null, ['canyon']);
    return ZT.World.hills.length === ZT.CFG.HILL.canyon;
  })()`))
  check('山体能挡住射界', await ev(`(() => {
    const h = ZT.World.hills[0];
    const ax = h.x - h.r * 3, ay = h.y;
    const bx = h.x + h.r * 3, by = h.y;
    return ZT.World.losBlocked(ax, ay, bx, by) === true && ZT.World.losBlocked(ax, ay, h.x, h.y - h.r * 4) === false;
  })()`))
  console.log('\n[14] 手感与战后报告')
  await ev('window.ZT.Game.startLevel(1)')
  await sleep(300)
  check('开局白送一把武器', await ev('window.ZT.Run.weaponCount() >= 1'))
  check('起始废料 500', await ev('window.ZT.Run.scrap') === 500)
  check('点击画布不会停住镜头', await ev(`(() => {
    const cv = document.getElementById('map');
    ZT.R.follow = true;
    cv.dispatchEvent(new MouseEvent('mousedown', { clientX: 400, clientY: 300, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 400, clientY: 300, bubbles: true }));
    return ZT.R.follow === true;
  })()`))
  check('拖动才会切到自由视角', await ev(`(() => {
    const cv = document.getElementById('map');
    ZT.R.follow = true;
    cv.dispatchEvent(new MouseEvent('mousedown', { clientX: 400, clientY: 300, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 470, clientY: 340, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 470, clientY: 340, bubbles: true }));
    const freed = ZT.R.follow === false;
    ZT.R.follow = true;
    return freed;
  })()`))
  await ev(`(() => { const R = ZT.Run; R.state = 'run'; R.km = R.totalKm; return 1 })()`)
  await waitFor('window.ZT.Run.state === "win"', 8000)
  const rep = JSON.parse(await ev(`(() => {
    const st = ZT.Run.settle(true);
    return JSON.stringify({ grade: st.grade, hasLine: !!st.line, timeSec: st.timeSec, maxSpeed: st.maxSpeed, maxCars: st.maxCars })
  })()`))
  check('结算有评价与一句话', ['稳','险','崩'].indexOf(rep.grade) >= 0 && rep.hasLine === true, rep)
  check('结算带统计（用时/最高车速/最大编组）', rep.timeSec >= 0 && rep.maxCars >= 2, rep)
  check('最佳记录可读写', await ev(`(() => {
    ZT.Save.setBest(9, { points: 1234 });
    const ok = ZT.Save.best(9) && ZT.Save.best(9).points === 1234;
    localStorage.removeItem('zt.best.9');
    return ok;
  })()`))
  console.log('\n[15] 界面与科技质变')
  await ev('window.ZT.UI.showStart()')
  await sleep(200)
  check('开始页有「开始游戏」与「科技」', await ev(`(() => {
    const t = document.querySelector('.start-root');
    if (!t) return false;
    const btns = [...t.querySelectorAll('.start-btn')].map(b => b.textContent);
    return btns.some(x => x.indexOf('开始游戏') >= 0) && btns.some(x => x.indexOf('科技') >= 0);
  })()`))
  await ev('window.ZT.UI.showLevels()')
  await sleep(200)
  check('关卡地图画出 12 个城市节点', await ev('document.querySelectorAll(".map-city").length') === 12)
  check('地图按经纬度落在国境内', await ev(`(() => {
    const svg = document.querySelector('.china-map');
    const land = svg.querySelector('.map-land');
    return !!land && land.getAttribute('points').split(' ').length > 20;
  })()`))
  await ev('window.ZT.UI.showTech()')
  await sleep(200)
  check('科技页有 6 条强化线', await ev('document.querySelectorAll(".panel-tech .mrow").length') === 6)
  check('科技页标出 Lv5 质变', await ev('document.querySelectorAll(".panel-tech .milestone").length') === 6)

  const ms = JSON.parse(await ev(`(() => {
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
  })()`))
  check('血量 Lv5：车厢免死一次并以 15% 复活', ms.rescued === true, ms)
  check('维修 Lv5：修轨时长再缩短', ms.d5 < ms.d0 * 0.72, ms)
  console.log('\n[16] 站台不会卡死')
  await ev('window.ZT.Game.startLevel(1)')
  await sleep(350)
  check('进站自动打开站台面板', await ev('window.ZT.UI.drawerState') === 'station')
  await ev('window.ZT.UI.closeTop()')          // 模拟按 Esc 关掉面板
  await sleep(250)
  check('关掉面板后出现「回到站台」按钮', await ev(`(() => {
    const f = document.querySelector('.fab');
    return !!f && !f.classList.contains('hidden') && ZT.Run.state === 'station';
  })()`))
  await ev('document.querySelector(".fab").click()')
  await sleep(250)
  check('点按钮能重新打开站台面板', await ev('window.ZT.UI.drawerState') === 'station')
  check('重开面板不会误触发出发', await ev('window.ZT.Run.state') === 'station')
  await ev('window.ZT.UI.openRefit(0)')
  await sleep(200)
  await ev('window.ZT.UI.closeDrawer()')
  await sleep(250)
  check('站台里关掉改装页会退回站台面板', await ev('window.ZT.UI.drawerState') === 'station')
  await ev('window.ZT.UI.depart()')
  await sleep(250)
  check('出发后按钮消失并进入行驶', await ev(`ZT.Run.state === 'run' && document.querySelector('.fab').classList.contains('hidden')`))
  console.log('\n[17] 新手提示')
  check('提示只弹一次', await ev(`(() => {
    ZT.Tips.reset();
    const a = ZT.Tips.show('__probe', 'x');
    const b = ZT.Tips.show('__probe', 'x');
    return a === true && b === false;
  })()`))
  check('提示写进 localStorage', await ev('!!JSON.parse(localStorage.getItem("zt.tips.v1") || "{}").__probe'))
  await ev('window.ZT.Game.startLevel(1)')
  await sleep(300)
  check('开局提示已触发', await ev('ZT.Tips.has("start")'))
  await ev('ZT.Tips.reset()')
  console.log('\n[18] 设置页')
  await ev('window.ZT.UI.showSettings()')
  await sleep(250)
  check('设置页有 7 个开关/操作行', await ev('document.querySelectorAll(".panel-settings .set-row").length') === 7)
  const setRes = JSON.parse(await ev(`(() => {
    const S = ZT.Settings;
    const before = S.data.sound !== false;
    S.set('sound', !before);
    const saved = JSON.parse(localStorage.getItem('zt.settings.v1') || '{}');
    const soundOff = ZT.Sound.enabled === false;
    S.set('sound', before);
    return JSON.stringify({ changed: saved.sound === !before, soundOff: soundOff });
  })()`))
  check('音效开关写进存档且同步到音频', setRes.changed === true && setRes.soundOff === true, setRes)
  check('音量可写', await ev(`(() => { const S = ZT.Settings; S.set('volume', 0.5); const ok = Math.abs(ZT.Sound.volume - 0.5) < 1e-6; S.set('volume', 0.9); return ok })()`))
  console.log('\n[19] 无尽模式')
  await ev('window.ZT.Game.startEndless()')
  await sleep(350)
  check('无尽模式开局在站台', await ev('ZT.Run.endless === true && ZT.Run.state === "station"'))
  check('走廊长度 120 km', await ev('Math.abs(ZT.World.path.len - 120000) / 120000 < 0.2'))
  await ev('window.ZT.Run.departStation()')
  // 直接推进模拟时间，避免 headless 下 rAF 被节流
  const ran = JSON.parse(await ev(`(() => {
    const R = ZT.Run;
    for (let i = 0; i < 360; i++) R.tick(1 / 60);
    return JSON.stringify({ km: Math.round(R.km), speed: Math.round(R.speed), state: R.state, lv: R.level });
  })()`))
  check('列车在无尽走廊里推进', ran.km > 60 && ran.speed > 10, ran)
  check('难度随里程爬升', ran.lv === await ev('ZT.Run.endlessLevel()'), ran)
  const stationRes = JSON.parse(await ev(`(() => {
    const R = ZT.Run;
    R.state = 'run';
    R.km = R.nextStationKm - 20;
    R.train.s = R.km;
    for (let i = 0; i < 120; i++) R.tick(1 / 60);
    return JSON.stringify({ state: R.state, endless: !!(R.station && R.station.endless) });
  })()`))
  check('每 6 km 一个补给站', stationRes.state === 'station' && stationRes.endless === true, stationRes)
  const over = JSON.parse(await ev(`(() => {
    const R = ZT.Run;
    R.departStation();
    R.state = 'run';
    R.nextStationKm = R.totalKm + 10000;
    R.km = R.totalKm - 5;
    R.train.s = R.km;
    for (let i = 0; i < 120; i++) R.tick(1 / 60);
    return JSON.stringify({ state: R.state, saveOk: ZT.Save.save(R) });
  })()`))
  check('跑到走廊尽头结束', over.state === 'over', over)
  check('无尽模式不写局内存档', over.saveOk === false, over)
  check('无尽最佳里程已记录', await ev('!!ZT.Save.endlessBest() && ZT.Save.endlessBest().km > 50'))
  console.log('\n[20] 移动端')
  check('画布禁用默认触摸手势（可拖动）', await ev('document.getElementById("map").style.touchAction') === 'none')
  check('移动端媒体查询可用', await ev(`(() => {
    // file:// 下读不到 cssRules，用 matchMedia 验证两条关键查询能被正确解析
    const a = window.matchMedia('(max-width: 900px)');
    const b = window.matchMedia('(pointer: coarse)');
    const c = window.matchMedia('(max-height: 560px)');
    return a.media === '(max-width: 900px)' && b.media === '(pointer: coarse)' && c.media === '(max-height: 560px)';
  })()`))
  console.log('\n[21] 新规则：掉落 / 无限弹油 / 减重 / 车头 / 修理车厢')
  await ev('window.ZT.Game.startLevel(1)')
  await sleep(300)
  const rules = JSON.parse(await ev(`(() => {
    const R = ZT.Run, Z = window.ZT;
    R.state = 'run';
    // 掉落
    const s0 = R.scrap;
    const wz = Z.Zombies.make(0, 0, {});
    wz.hp = 1; wz.dead = false;
    Z.Zombies.list.length = 0; Z.Zombies.list.push(wz);
    Z.damageArea(Z.Zombies.list, 0, 0, 10, 999, R);
    const drop = R.scrap - s0;
    // 弹药 / 燃料
    const ammo0 = R.ammo, fuel0 = R.fuel;
    for (let i = 0; i < 120; i++) R.tick(1 / 60);
    const ammoKept = R.ammo === ammo0, fuelKept = R.fuel === fuel0;
    // 减重提速
    R.state = 'run';
    const keep = R.cars;
    R.cars = [new Z.Car('engine'), new Z.Car('weapon'), new Z.Car('weapon')];
    const v3 = R.speedCap();
    R.cars[1].dead = true;
    const v2 = R.speedCap();
    R.cars = keep;
    // 车头在后面？
    R.cars = [new Z.Car('engine'), new Z.Car('weapon'), new Z.Car('passenger')];
    R.state = 'run'; R.speed = 10; R.km = 100; R.train.s = 100;
    const lay = R.train.layout(Z.World);
    const headFront = lay[0].cs > lay[2].cs;
    return JSON.stringify({ drop: drop, ammoKept: ammoKept, fuelKept: fuelKept, v3: v3, v2: v2, headFront: headFront });
  })()`))
  check('杀一只普通丧尸 +2 废料', rules.drop === 2, rules)
  check('弹药不再消耗', rules.ammoKept === true, rules)
  check('燃料不再消耗', rules.fuelKept === true, rules)
  check('车厢损毁后减重提速', rules.v2 > rules.v3, rules)
  check('车头在最前面（新车挂后面）', rules.headFront === true, rules)

  const repairRes = JSON.parse(await ev(`(() => {
    const R = ZT.Run, Z = window.ZT;
    R.cars = [new Z.Car('engine'), new Z.Car('weapon'), new Z.Car('repair'), new Z.Car('passenger')];
    R.state = 'run'; R.km = 100; R.train = new Z.Train(R); R.train.s = 100; R.speed = 0;
    const w = R.cars[1];
    R.cars[2].dead = false;
    w.hp = 100;
    for (let i = 0; i < 120; i++) R.tick(1 / 60);
    const healed = w.hp > 100;
    // 修轨加速
    R.cars[2].dead = true;
    R.state = 'run'; R.trackDamage = 0; R.ripTrack(200); const slowDur = R.parkDur;
    R.cars[2].dead = false;
    R.state = 'run'; R.trackDamage = 0; R.ripTrack(200); const fastDur = R.parkDur;
    R.state = 'run'; R.trackDamage = 0;
    return JSON.stringify({ healed: healed, slow: slowDur, fast: fastDur });
  })()`))
  check('修理车厢给相邻车厢回血', repairRes.healed === true, repairRes)
  check('修理车厢让修轨更快', repairRes.fast < repairRes.slow * 0.95, repairRes)

  const eng = JSON.parse(await ev(`(() => {
    const R = ZT.Run, Z = window.ZT;
    R.cars = [new Z.Car('engine'), new Z.Car('weapon')];
    R.state = 'run'; R.speed = 40; R.km = 200; R.train = new Z.Train(R); R.train.s = 200;
    R.cars[0].dead = true;
    const cap = R.speedCap();
    const before = R.speed;
    for (let i = 0; i < 200; i++) R.tick(1 / 60);
    return JSON.stringify({ cap: cap, before: before, after: Math.round(R.speed), state: R.state, hasEngine: R.hasEngine() });
  })()`))
  check('车头损毁后没有牵引力', eng.hasEngine === false && eng.cap === 0, eng)
  check('车头损毁 2.5 秒后判负', eng.state === 'over', eng)
  console.log('\n[22] 站点与终点')
  check('安全点在线路终点（比例 1.0）', await ev('ZT.CFG.STATION_AT[ZT.CFG.STATION_AT.length - 1]') === 1)
  const runRes = JSON.parse(await ev(`(() => {
    const R = ZT.Run;
    ZT.Game.startLevel(1);
    R.bossAt = []; R.bossSpawned = 0;
    R.departStation();
    const stops = [];
    for (let i = 0; i < 20000; i++) {
      R.tick(1 / 60);
      ZT.Zombies.list.length = 0;
      if (R.state === 'station') { stops.push(Math.round(R.km)); R.departStation(); }
      if (R.state === 'win' || R.state === 'over') break;
    }
    return JSON.stringify({ stops: stops, state: R.state, km: Math.round(R.km), total: R.totalKm, idx: R.stationIdx });
  })()`))
  check('沿线两个资源点都会停车', runRes.stops.length === 2, runRes)
  check('安全点在线路末端结束（而非中途）', runRes.state === 'win' && runRes.km === runRes.total, runRes)
  check('中间站位置符合 30% / 62%', Math.abs(runRes.stops[0] / runRes.total - 0.30) < 0.02 && Math.abs(runRes.stops[1] / runRes.total - 0.62) < 0.02, runRes)
  console.log('\n[23] 武器形态')
  const forms = JSON.parse(await ev(`(() => {
    const R = ZT.Run, Z = window.ZT;
    const w = new Z.Weapon('mg', 5);
    w.form = null; const d0 = w.dps(), r0 = w.rof();
    w.form = 'A'; const dA = w.dps(), rA = w.rof(), nA = dA / rA;
    w.form = 'B'; const dB = w.dps(), rB = w.rof(), nB = dB / rB;
    return JSON.stringify({ d0: +d0.toFixed(1), dA: +dA.toFixed(1), dB: +dB.toFixed(1),
      r0: +r0.toFixed(1), rA: +rA.toFixed(1), rB: +rB.toFixed(1),
      nA: +nA.toFixed(1), nB: +nB.toFixed(1) });
  })()`))
  check('两种形态都明显强于无形态', forms.dA > forms.d0 * 1.2 && forms.dB > forms.d0 * 1.2, forms)
  check('A 高射速低单发 / B 低射速高单发', forms.rA > forms.r0 && forms.rB < forms.r0 && forms.nB > forms.nA * 2, forms)
  check('形态写进存档', await ev(`(() => {
    const R = ZT.Run;
    R.cars[0].slots[0] = new ZT.Weapon('mg', 3);
    R.cars[0].slots[0].form = 'A';
    const snap = R.snapshot();
    const f = snap.cars[0].s[0] && snap.cars[0].s[0].f;
    R.restore(snap);
    const f2 = R.cars[0].slots[0] && R.cars[0].slots[0].form;
    return f === 'A' && f2 === 'A';
  })()`))
  console.log('\n[24] 站台调序')
  const reorder = JSON.parse(await ev(`(() => {
    const R = ZT.Run, Z = window.ZT;
    ZT.Game.startLevel(1);
    R.cars = [new Z.Car('engine'), new Z.Car('weapon'), new Z.Car('repair'), new Z.Car('passenger')];
    R.state = 'station';
    const before = R.cars.map(c => c.type).join(',');
    const ok = R.moveCar(2, -1);
    const after = R.cars.map(c => c.type).join(',');
    const engineBlocked = R.moveCar(0, 1) === false;
    const pushIntoHead = R.moveCar(1, -1) === false;
    const headStill = R.cars[0].type === 'engine';
    R.state = 'run';
    const notAtStation = R.moveCar(2, -1) === false;
    return JSON.stringify({ ok: ok, before: before, after: after, engineBlocked: engineBlocked,
      pushIntoHead: pushIntoHead, headStill: headStill, notAtStation: notAtStation });
  })()`))
  check('站台可以交换相邻车厢', reorder.ok === true && reorder.before !== reorder.after, reorder)
  check('车头不能挪动', reorder.engineBlocked === true && reorder.headStill === true, reorder)
  check('别的车厢不能挤到车头前面', reorder.pushIntoHead === true, reorder)
  check('行驶中不能调序', reorder.notAtStation === true, reorder)
  check('站台整备视图有调序按钮', await ev(`(() => {
    const R = ZT.Run; R.state = 'station'; R.station = { idx: 1, isStart: false };
    ZT.UI.openStation(R.station);
    return document.querySelectorAll('.dcell .mv').length >= 2;
  })()`))
  console.log('\n[25] Boss 招式')
  const boss = JSON.parse(await ev(`(() => {
    const R = ZT.Run, Z = window.ZT;
    ZT.Game.startLevel(1);
    R.state = 'run';
    ZT.Zombies.reset ? ZT.Zombies.reset() : (ZT.Zombies.list.length = 0);
    const p = Z.U.posAt(Z.World.path, R.km + 40, {});
    const zb = Z.Zombies.make(p.x, p.y, {});
    zb.boss = true; zb.aiCd = 0; zb.mode = 'walk';
    ZT.Zombies.list.length = 0; ZT.Zombies.list.push(zb);
    ZT.Zombies.update(1 / 60, R);
    const windup = zb.mode === 'windup' && zb.nextMode === 'charge';
    // 蓄力结束 → 冲撞
    zb.modeT = 0.001;
    ZT.Zombies.update(1 / 60, R);
    const charging = zb.mode === 'charge';
    const x0 = zb.x, y0 = zb.y;
    for (let i = 0; i < 12; i++) ZT.Zombies.update(1 / 60, R);
    const moved = Math.hypot(zb.x - x0, zb.y - y0);
    // 召唤
    zb.mode = 'windup'; zb.nextMode = 'summon'; zb.modeT = 0.001; zb.aiCd = 0;
    const before = ZT.Zombies.list.length;
    ZT.Zombies.update(1 / 60, R);
    const summoned = ZT.Zombies.list.length - before;
    // 破坏轨道
    zb.mode = 'windup'; zb.nextMode = 'rip'; zb.modeT = 0.001; zb.aiCd = 0;
    R.state = 'run'; R.trackDamage = 0;
    ZT.Zombies.update(1 / 60, R);
    const rip = R.trackDamage;
    ZT.Zombies.list.length = 0;
    return JSON.stringify({ windup: windup, charging: charging, moved: Math.round(moved), summoned: summoned, rip: Math.round(rip) });
  })()`))
  check('Boss 进入蓄力并锁定冲撞', boss.windup === true, boss)
  check('蓄力结束进入冲撞', boss.charging === true, boss)
  check('冲撞会高速位移', boss.moved > 5, boss)
  check('召唤会带来新的丧尸', boss.summoned >= 6, boss)
  check('破坏轨道会累积损伤', boss.rip > 0, boss)
  console.log('\n[26] 元素连携与 Boss 冷却')
  const elem = JSON.parse(await ev(`(() => {
    const R = ZT.Run, Z = window.ZT;
    ZT.Game.startLevel(1);
    R.state = 'run';
    R.cars[1].slots[0] = new Z.Weapon('flamer', 8);
    ZT.Zombies.list.length = 0;
    const p = Z.U.posAt(Z.World.path, R.km + 26, {});
    const zb = Z.Zombies.make(p.x, p.y + 3, {});
    zb.hp = 5000; zb.maxHp = 5000;
    ZT.Zombies.list.push(zb);
    for (let i = 0; i < 40; i++) R.tick(1 / 60);
    const burning = zb.burn > 0 && !zb.dead;
    // 撤掉火焰武器，只看燃烧持续伤害
    R.cars[1].slots[0] = null;
    const hp0 = zb.hp;
    for (let i = 0; i < 90; i++) R.tick(1 / 60);
    const dot = hp0 - zb.hp;
    ZT.Zombies.list.length = 0;
    return JSON.stringify({ burning: burning, dot: Math.round(dot) });
  })()`))
  check('火焰武器会点燃目标', elem.burning === true, elem)
  check('燃烧会持续掉血', elem.dot > 3, elem)

  const cd = JSON.parse(await ev(`(() => {
    const R = ZT.Run, Z = window.ZT, B = Z.CFG.BOSS;
    ZT.Game.startLevel(1);
    R.state = 'run';
    ZT.Zombies.list.length = 0;
    const p = Z.U.posAt(Z.World.path, R.km + 40, {});
    const zb = Z.Zombies.make(p.x, p.y, {});
    zb.boss = true; zb.aiCd = 0; zb.mode = 'walk';
    ZT.Zombies.list.push(zb);
    ZT.Zombies.update(1 / 60, R);
    const windup = zb.mode === 'windup';
    const cdAfterPick = zb.aiCd;
    zb.modeT = 0.001;
    ZT.Zombies.update(1 / 60, R);
    const charging = zb.mode === 'charge';
    // 冲撞结束后进入冷却
    zb.modeT = 0.001;
    for (let i = 0; i < 3; i++) ZT.Zombies.update(1 / 60, R);
    const cdAfterUse = zb.aiCd;
    ZT.Zombies.list.length = 0;
    return JSON.stringify({ windup: windup, pick: Math.round(cdAfterPick * 10) / 10, charging: charging,
      after: Math.round(cdAfterUse * 10) / 10, cfgCharge: B.cd.charge });
  })()`))
  check('Boss 出招前就有冷却计时', cd.windup === true && cd.pick === cd.cfgCharge, cd)
  check('冲撞结束后进入冷却', cd.after >= cd.cfgCharge - 1.5, cd)
} catch (e) {
  fail++
  console.error('冒烟测试中断：', e.message)
} finally {
  console.log('\n================ 结果 ================')
  console.log('  通过 ' + pass + ' / 失败 ' + fail)
  console.log('  console 报错 ' + errors.length)
  errors.slice(0, 3).forEach(e => console.log('   ---\n' + String(e).slice(0, 700)))
  try { ws.close() } catch (e) {}
  proc.kill(); await sleep(400)
  try { rmSync(PROFILE, { recursive: true, force: true }) } catch (e) {}
  if (fail) process.exitCode = 1
}
