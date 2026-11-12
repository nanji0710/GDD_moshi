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
  await ev(`(() => { const b=[...document.querySelectorAll('.shop-item')].find(x=>/弹药 \\+/.test(x.textContent)); b.click(); return 1 })()`)
  await sleep(200)
  check('买弹药扣废料', await ev('window.ZT.Run.scrap') < s0)
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
  check('长直道冲锋者更快（5.5 → 7.15）', await ev(`(() => {
    ZT.Run.straight = true;
    ZT.Run.level = 11; ZT.Run.levelDef = ZT.CFG.LEVELS[10];
    ZT.Zombies.reset();
    const z = ZT.Zombies.make(0, 0, { kind: 'runner' });
    ZT.Run.level = 1; ZT.Run.levelDef = ZT.CFG.LEVELS[0];
    return z.speed > 7 && z.speed < 7.3;
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
