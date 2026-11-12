/**
 * v3 截图与运行期报错审计（Edge headless + CDP，零依赖）。
 * 用法：node tools/shoot.mjs [输出目录]
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = Number(process.env.PORT || 9477)
const OUT = process.argv[2] || 'tools/shots'
const PROFILE = join(tmpdir(), 'zt-shoot3-' + Date.now())
mkdirSync(OUT, { recursive: true })

const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--no-first-run', '--window-size=1600,900', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, 'file:///' + join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html').replace(/\\/g, '/')], { stdio: 'ignore' })

let ws = null, seq = 0
const pending = new Map()
const logs = []

function send(method, params) {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params: params || {} }))
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)) } }, 20000)
  })
}
async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()
      const p = list.find(t => t.type === 'page' && t.url.startsWith('file:'))
      if (p) return p
    } catch (e) {}
    await sleep(250)
  }
  throw new Error('no target')
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, name + '.png'), Buffer.from(r.data, 'base64'))
  console.log('  shot ->', join(OUT, name + '.png'))
}
async function evJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || ''))
  return r.result && r.result.value
}

try {
  const page = await findTarget()
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id)
      if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result)
      return
    }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
      logs.push('[' + m.params.type + '] ' + (m.params.args || []).map(a => a.value ?? a.description).join(' '))
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text))
    }
  }
  await send('Runtime.enable'); await send('Page.enable')
  await sleep(2200)

  console.log('场景 1：标题 + 局外成长')
  await shot('01-title')

  console.log('场景 2：站台（停靠 · 购物暂停）')
  await evJs('window.ZT.Game.startLevel(1)')
  await sleep(700)
  await shot('02-station')

  console.log('场景 3：出发后装弹开打')
  await evJs(`(() => {
    const R = ZT.Run;
    // 人工装配：给现有车厢挂武器，并补几节车厢
    R.scrap = 6000; R.ammo = 9000;
    for (let i = 0; i < 2; i++) R.cars.push(new ZT.Car('weapon'));
    R.cars.push(new ZT.Car('power'));
    const keys = ['mg','flak','flamer','tesla','mortar','mg','flak','flamer'];
    let n = 0;
    for (const c of R.cars) for (let j = 0; j < c.slots.length; j++) {
      const k = keys[n++ % keys.length];
      c.slots[j] = new ZT.Weapon(k, 1 + (n % 6));
      if (c.slots[j].level >= 3) c.slots[j].form = (n % 2) ? 'A' : 'B';
    }
    document.querySelector('.drawer').classList.add('hidden');
    R.state = 'run'; R.speed = 20; R.km = 260; R.stationIdx = 0;
    ZT.Game.setSpeed(3);
    return 1;
  })()`)
  await sleep(3200)
  await shot('03-play')

  console.log('场景 4：车厢三选一')
  await evJs(`(() => { const R = ZT.Run; R.offer = null; R.nextCarKm = R.km; R.checkCarGain(); return 1 })()`)
  await sleep(600)
  await shot('04-offer')
  await evJs(`(() => { const R = ZT.Run; if (R.offer) R.takeCar(R.offer[0]); return 1 })()`)
  await sleep(300)

  console.log('场景 5：改装抽屉')
  await evJs(`(() => { ZT.Game.setSpeed(0); ZT.UI.openRefit(3); return 1 })()`)
  await sleep(700)
  await shot('05-refit')
  await evJs('window.ZT.Game.setSpeed(3)')

  console.log('场景 6：停车防守')
  await evJs(`(() => { const R = ZT.Run; R.closeStation && R.closeStation(); R.ripTrack(120); return 1 })()`)
  await sleep(900)
  await shot('06-parked')

  console.log('场景 7：结算')
  await evJs(`(() => { const R = ZT.Run; R.endPark(); R.km = R.totalKm; return 1 })()`)
  await sleep(900)
  await shot('07-result')

  console.log('场景 8：受损特写（四阶）')
  await evJs(`(() => {
    ZT.Game.startLevel(2);
    const R = ZT.Run;
    R.scrap = 9000; R.ammo = 9000; R.nextCarKm = 1e9;
    for (const t of ['weapon','power','armor','repair','passenger']) R.cars.push(new ZT.Car(t));
    R.cars.forEach(function (c, i) {
      if (i === 1) c.hp = c.maxHp * 0.72;
      if (i === 2) c.hp = c.maxHp * 0.46;
      if (i === 3) c.hp = c.maxHp * 0.18;
      if (i >= 4 && c.type === 'weapon') { c.slots[0] = new ZT.Weapon('flak', 4); c.slots[0].form = 'B'; }
    });
    document.querySelector('.drawer').classList.add('hidden');
    R.state = 'run'; R.speed = 12; R.km = 400;
    ZT.R.cam.zoom = 4.2;
    return 1;
  })()`)
  await sleep(1400)
  await shot('08-damage')

  console.log('场景 9：刷新后「继续上一局」')
  await evJs(`(() => {
    ZT.Game.startLevel(3);
    const R = ZT.Run;
    R.scrap = 2400; R.ammo = 5200; R.km = 4200; R.state = 'run'; R.stationIdx = 1; R.speed = 25;
    R.cars[0].slots[0] = new ZT.Weapon('tesla', 5); R.cars[0].slots[0].form = 'A';
    if (R.cars[1]) R.cars[1].refugees = 9;
    ZT.Save.save(R);
    return 1;
  })()`)
  await sleep(400)
  await send('Page.reload', {})
  await sleep(2400)
  await shot('09-resume')
  await evJs('window.ZT.Game.continueRun()')
  await sleep(1200)
  await shot('10-resumed')
  const resumed = await evJs(`JSON.stringify({ level: ZT.Run.level, km: Math.round(ZT.Run.km), cars: ZT.Run.cars.length, lv: ZT.Run.cars[0].slots[0] && ZT.Run.cars[0].slots[0].level })`)
  console.log('  读档结果：', resumed)

  for (const [lv, name, label] of [[6, '11-night', '夜战'], [7, '12-tunnel', '隧道'], [10, '13-rain', '雨战']]) {
    console.log('场景：' + label + '（第 ' + lv + ' 关）')
    await evJs(`(() => {
      ZT.Game.startLevel(${lv});
      const R = ZT.Run;
      R.scrap = 9000; R.ammo = 9000;
      for (const t of ['weapon','weapon','power','armor','passenger']) R.cars.push(new ZT.Car(t));
      const keys = ['mg','flak','flamer','tesla','mortar','mg'];
      let n = 0;
      for (const c of R.cars) for (let j = 0; j < c.slots.length; j++) {
        c.slots[j] = new ZT.Weapon(keys[n++ % keys.length], 4);
        if (c.slots[j].level >= 3) c.slots[j].form = (n % 2) ? 'A' : 'B';
      }
      document.querySelector('.drawer').classList.add('hidden');
      R.state = 'run'; R.stationIdx = 1; R.km = R.totalKm * 0.34; R.train.s = R.km; R.speed = 22; R.nextCarKm = 1e9; R.offer = null; ZT.UI.closeCarOffer(); const lay = R.train.layout(ZT.World); const mid = lay[(lay.length/2)|0]; if (mid) { ZT.R.cam.cx = mid.x; ZT.R.cam.cy = mid.y; } ZT.R.compute();
      ZT.Game.setSpeed(2);
      return 1;
    })()`)
    await sleep(2600)
    await shot(name)
  }

  console.log('场景：铁桥（第 2 关）')
  await evJs(`(() => {
    ZT.Game.startLevel(2);
    const R = ZT.Run;
    R.scrap = 9000; R.ammo = 9000; R.nextCarKm = 1e9;
    for (const t of ['weapon','weapon','power','passenger']) R.cars.push(new ZT.Car(t));
    const keys = ['mg','flak','flamer','tesla','mortar'];
    let n = 0;
    for (const c of R.cars) for (let j = 0; j < c.slots.length; j++) {
      c.slots[j] = new ZT.Weapon(keys[n++ % keys.length], 4);
    }
    document.querySelector('.drawer').classList.add('hidden');
    const mid = (ZT.World.bridge.s0 + ZT.World.bridge.s1) / 2;
    R.state = 'run'; R.km = mid; R.train.s = mid; R.speed = 18; R.stationIdx = 1;
    const lay = R.train.layout(ZT.World);
    const c0 = lay[(lay.length / 2) | 0];
    ZT.R.cam.cx = c0.x; ZT.R.cam.cy = c0.y; ZT.R.compute();
    ZT.Game.setSpeed(2);
    return 1;
  })()`)
  await sleep(2600)
  await shot('14-bridge')

  for (const [lv, name, label] of [[1, '15-biome-temperate', '江南'], [3, '15-biome-loess', '中原'], [9, '15-biome-mountain', '山城'], [12, '15-biome-desert', '荒漠']]) {
    console.log('场景：' + label + '（第 ' + lv + ' 关）')
    await evJs(`(() => {
      ZT.Game.startLevel(${lv});
      const R = ZT.Run;
      R.scrap = 9000; R.ammo = 9000; R.nextCarKm = 1e9;
      for (const t of ['weapon','weapon','power','passenger']) R.cars.push(new ZT.Car(t));
      const keys = ['mg','flak','flamer','tesla','mortar'];
      let n = 0;
      for (const c of R.cars) for (let j = 0; j < c.slots.length; j++) c.slots[j] = new ZT.Weapon(keys[n++ % keys.length], 4);
      document.querySelector('.drawer').classList.add('hidden');
      R.state = 'run'; R.stationIdx = 3; const L = ZT.CFG.LEVELS[${lv} - 1]; R.km = (L.lm ? L.lm.s : 0.42) * R.totalKm; R.train.s = R.km; R.speed = 20;
      const lay = R.train.layout(ZT.World); const c0 = lay[(lay.length / 2) | 0];
      ZT.R.cam.cx = c0.x; ZT.R.cam.cy = c0.y; ZT.R.compute();
      ZT.Game.setSpeed(1);
      return 1;
    })()`)
    await sleep(2200)
    await shot(name)
  }

  console.log('场景：长直道（第 11 关）')
  await evJs(`(() => {
    ZT.Game.startLevel(11);
    const R = ZT.Run;
    R.scrap = 9000; R.ammo = 9000; R.nextCarKm = 1e9;
    for (const t of ['weapon','weapon','power','passenger']) R.cars.push(new ZT.Car(t));
    const keys = ['mg','flak','flamer','tesla','mortar'];
    let n = 0;
    for (const c of R.cars) for (let j = 0; j < c.slots.length; j++) c.slots[j] = new ZT.Weapon(keys[n++ % keys.length], 5);
    document.querySelector('.drawer').classList.add('hidden');
    R.state = 'run'; R.stationIdx = 3; R.km = R.totalKm * 0.45; R.train.s = R.km; R.speed = 30;
    for (let i = 0; i < 26; i++) ZT.Zombies.spawnOne(R);
    const lay = R.train.layout(ZT.World); const c0 = lay[(lay.length / 2) | 0];
    ZT.R.cam.cx = c0.x; ZT.R.cam.cy = c0.y; ZT.R.compute();
    ZT.Game.setSpeed(1);
    return 1;
  })()`)
  await sleep(2000)
  await shot('16-straight')

  console.log('场景：连续弯道（第 9 关）')
  await evJs(`(() => {
    ZT.Game.startLevel(9);
    const R = ZT.Run;
    R.scrap = 9000; R.ammo = 9000; R.nextCarKm = 1e9;
    for (const t of ['weapon','weapon','power','passenger']) R.cars.push(new ZT.Car(t));
    const keys = ['mg','flak','flamer','tesla','mortar'];
    let n = 0;
    for (const c of R.cars) for (let j = 0; j < c.slots.length; j++) c.slots[j] = new ZT.Weapon(keys[n++ % keys.length], 5);
    document.querySelector('.drawer').classList.add('hidden');
    R.state = 'run'; R.stationIdx = 3; R.km = R.totalKm * 0.5; R.train.s = R.km; R.speed = 26;
    for (let i = 0; i < 30; i++) ZT.Zombies.spawnOne(R);
    const lay = R.train.layout(ZT.World); const c0 = lay[(lay.length / 2) | 0];
    ZT.R.cam.cx = c0.x; ZT.R.cam.cy = c0.y; ZT.R.compute();
    ZT.Game.setSpeed(1);
    return 1;
  })()`)
  await sleep(2200)
  await shot('17-canyon')

  const stat = await evJs(`(() => {
    const R = ZT.Run, Z = window.ZT;
    return JSON.stringify({ state: R.state, level: R.level, cars: R.cars.length, weapons: R.weaponCount(),
      speedCap: +R.speedCap().toFixed(1), refugees: R.refugees(), kills: R.kills, points: Z.Meta.points });
  })()`)
  console.log('  运行状态：', stat)
} catch (e) {
  console.error('失败：', e.message)
  process.exitCode = 1
} finally {
  try { ws && ws.close() } catch (e) {}
  proc.kill()
  await sleep(600)
  try { rmSync(PROFILE, { recursive: true, force: true }) } catch (e) {}
  console.log('--- 运行期 console 报错（' + logs.length + '）---')
  for (const l of logs.slice(0, 20)) console.log(String(l).split('\n')[0])
  if (!logs.length) console.log('无')
}
