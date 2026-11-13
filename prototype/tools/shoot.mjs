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
import { createHash } from 'node:crypto'
import net from 'node:net'

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
// A1：随机端口 + 每次运行唯一 nonce，截图工具也能并发/被占用端口时安全重跑
async function freePort() {
  return await new Promise((res, rej) => {
    const s = net.createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
  })
}
const PORT = Number(process.env.PORT || await freePort())
const NONCE = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
const OUT = process.argv[2] || 'tools/shots'
const PROFILE = join(tmpdir(), 'zt-shoot3-' + NONCE)
const PAGE_URL = 'file:///' + join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html').replace(/\\/g, '/') + '?zt=' + NONCE
mkdirSync(OUT, { recursive: true })

const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--no-first-run', '--window-size=1600,900', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, PAGE_URL], { stdio: 'ignore' })

async function killTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    await new Promise(res => {
      const k = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
      k.on('exit', res); k.on('error', res)
    })
  } else {
    try { process.kill(pid, 'SIGKILL') } catch (e) {}
  }
}
async function cleanupProfile() {
  for (let i = 0; i < 8; i++) {
    try { rmSync(PROFILE, { recursive: true, force: true }); return } catch (e) { await sleep(250) }
  }
}

let ws = null, seq = 0
const pending = new Map()
const logs = []
const manifest = []
function flushManifest() {
  try {
    writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
      tool: 'shoot.mjs', generatedAt: new Date().toISOString(), nonce: NONCE,
      page: PAGE_URL, window: '1600x900', shots: manifest
    }, null, 2))
  } catch (e) {}
}

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
      const p = list.find(t => t.type === 'page' && t.url.includes(NONCE))
      if (p) return p
    } catch (e) {}
    await sleep(250)
  }
  throw new Error('no target on port ' + PORT + ' (nonce ' + NONCE + ')')
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const buf = Buffer.from(r.data, 'base64')
  const file = name + '.png'
  writeFileSync(join(OUT, file), buf)
  let vp = {}
  try { vp = JSON.parse(await evJs(`JSON.stringify({w:innerWidth,h:innerHeight,dpr:devicePixelRatio})`)) } catch (e) {}
  manifest.push({ id: name, file: file, width: vp.w, height: vp.h, dpr: vp.dpr, bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'), at: new Date().toISOString() })
  flushManifest()
  console.log('  shot ->', join(OUT, file))
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

  console.log('场景 1b：关卡地图')
  await evJs('ZT.Meta.selectedLevel = 4; window.ZT.UI.showLevels(4)')
  await sleep(800)
  await shot('01b-map')

  console.log('场景 1d：节点信息卡')
  await evJs(`(() => { const n = document.querySelector('.map-city[data-level="2"]'); if (n) n.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 1 })()`)
  await sleep(500)
  await shot('01d-card')

  console.log('场景 1c：科技')
  await evJs('ZT.Meta.levels.speed = 5; ZT.Meta.levels.dmg = 5; ZT.Meta.branch = {}; window.ZT.UI.showTech()')
  await sleep(500)
  await shot('01c-tech')
  console.log('场景 1e：设置')
  await evJs('window.ZT.UI.showSettings()')
  await sleep(400)
  await shot('01e-settings')

  console.log('场景 1f：危险操作确认框')
  await evJs(`ZT.UI.confirm('清除全部进度？', '关卡解锁、里程点、涂装与最佳记录都会清空，且不可恢复。', '确认清除', function () {})`)
  await sleep(350)
  await shot('01f-confirm')
  await evJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(250)

  await evJs('window.ZT.UI.showStart()')
  await sleep(300)

  console.log('场景 2：站台（停靠 · 购物暂停）')
  await evJs('window.ZT.Game.startLevel(1)')
  await sleep(700)
  await shot('02-station')

  console.log('场景 2b：收起站台，FAB 常驻')
  await evJs(`(() => { const b = document.querySelector('.drawer .dw-close'); if (b) b.click(); return 1 })()`)
  await sleep(600)
  await shot('02b-station-closed')

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
    ZT.UI.closeStation();
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
  await evJs('ZT.UI.closeDrawer(); ZT.Game.setSpeed(2)')   // 改装面板自己会恢复暂停，不能只 setSpeed

  console.log('场景 6：停车防守')
  await evJs(`(() => { const R = ZT.Run; R.ripTrack(120); return 1 })()`)
  await sleep(900)
  await shot('06-parked')

  console.log('场景 7：结算')
  await evJs(`(() => { const R = ZT.Run; if (ZT.UI.drawerState) ZT.UI.closeStation(); R.endPark(); ZT.Game.paused = false; R.km = R.totalKm; return 1 })()`)
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
    ZT.UI.closeStation();
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
    R.nextCarKm = 1e9; R.offer = null; ZT.UI.closeCarOffer();
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
      ZT.UI.closeStation();
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
    ZT.UI.closeStation();
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
      ZT.UI.closeStation();
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
    ZT.UI.closeStation();
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
    ZT.UI.closeStation();
    R.state = 'run'; R.stationIdx = 3; R.km = R.totalKm * 0.5; R.train.s = R.km; R.speed = 26;
    for (let i = 0; i < 30; i++) ZT.Zombies.spawnOne(R);
    const lay = R.train.layout(ZT.World); const c0 = lay[(lay.length / 2) | 0];
    ZT.R.cam.cx = c0.x; ZT.R.cam.cy = c0.y; ZT.R.compute();
    ZT.Game.setSpeed(1);
    return 1;
  })()`)
  await sleep(2200)
  await shot('17-canyon')

  console.log('场景：手机横屏 844x390')
  await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true })
  await evJs(`(() => {
    ZT.Game.startLevel(1);
    const R = ZT.Run;
    R.scrap = 2000; R.ammo = 3000; R.nextCarKm = 1e9;
    for (const t of ['weapon','power','passenger']) R.cars.push(new ZT.Car(t));
    let n = 0;
    for (const c of R.cars) for (let j = 0; j < c.slots.length; j++) { c.slots[j] = new ZT.Weapon(['mg','flak','flamer'][n++ % 3], 3); }
    ZT.UI.closeStation();
    R.state = 'run'; R.stationIdx = 1; R.km = R.totalKm * 0.3; R.train.s = R.km; R.speed = 22;
    const lay = R.train.layout(ZT.World); const c0 = lay[(lay.length / 2) | 0];
    ZT.R.cam.cx = c0.x; ZT.R.cam.cy = c0.y; ZT.R.compute();
    ZT.Game.setSpeed(2);
    return 1;
  })()`)
  await sleep(1500)
  await shot('18-mobile-landscape')

  console.log('场景：手机竖屏 390x844')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await sleep(1200)
  await shot('19a-portrait-prompt')
  await evJs(`(() => { const b = [...document.querySelectorAll('.rotate-card .btn')].find(x => /继续竖屏/.test(x.textContent)); if (b) b.click(); return 1 })()`)
  await sleep(500)
  await shot('19-mobile-portrait')
  await send('Emulation.clearDeviceMetricsOverride')
  await sleep(500)

  console.log('场景：武器形态特写（左 A 双联 / 右 B 重管）')
  await evJs(`(() => {
    ZT.Game.startLevel(1);
    const R = ZT.Run;
    R.nextCarKm = 1e9; R.scrap = 9999;
    R.cars = [new ZT.Car('engine'), new ZT.Car('weapon'), new ZT.Car('weapon')];
    R.cars[1].slots[0] = new ZT.Weapon('mg', 6); R.cars[1].slots[0].form = 'A';
    R.cars[2].slots[0] = new ZT.Weapon('mg', 6); R.cars[2].slots[0].form = 'B';
    R.cars[2].slots[1] = new ZT.Weapon('flak', 6); R.cars[2].slots[1].form = 'B';
    ZT.UI.closeStation();
    R.state = 'run'; R.stationIdx = 3; R.km = R.totalKm * 0.45; R.train = new ZT.Train(R); R.train.s = R.km; R.speed = 14;
    ZT.Zombies.list.length = 0;
    for (let i = 0; i < 10; i++) ZT.Zombies.spawnOne(R);
    const lay = R.train.layout(ZT.World);
    const z0 = ZT.Zombies.list[0];
    if (z0) { z0.x = ZT.U.posAt(ZT.World.path, R.km, {}).x + 6; z0.y = ZT.U.posAt(ZT.World.path, R.km, {}).y + 10; z0.phase = 0.8; }
    const c0 = (z0 && Math.random() < 2) ? z0 : lay[1];
    ZT.R.cam.cx = c0.x; ZT.R.cam.cy = c0.y; ZT.R.cam.zoom = 9.0; ZT.R.compute();
    ZT.Game.setSpeed(1);
    return 1;
  })()`)
  await sleep(1800)
  await shot('20-forms')
  await evJs('ZT.R.cam.zoom = ZT.CFG.CAM.zoom; ZT.R.compute()')

  console.log('场景：爆炸特效（冲击波环 / 火星 / 焦痕）')
  await evJs(`(() => {
    ZT.Game.startLevel(1);
    const R = ZT.Run;
    R.nextCarKm = 1e9;
    R.cars = [new ZT.Car('engine'), new ZT.Car('weapon'), new ZT.Car('power'), new ZT.Car('armor')];
    R.cars[1].slots[0] = new ZT.Weapon('mortar', 6);
    ZT.UI.closeStation();
    R.state = 'run'; R.stationIdx = 3; R.km = R.totalKm * 0.4;
    R.train = new ZT.Train(R); R.train.s = R.km; R.speed = 18;
    const lay = R.train.layout(ZT.World); const c0 = lay[1];
    ZT.R.cam.cx = c0.x; ZT.R.cam.cy = c0.y - 7; ZT.R.cam.zoom = 4.4; ZT.R.compute();
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05;
      ZT.Fx.boom(c0.x + Math.cos(a) * (12 + i * 2), c0.y + Math.sin(a) * 9, 1.4, 8 + i * 2);
    }
    ZT.Game.setSpeed(1);
    return 1;
  })()`)
  await sleep(130)
  await shot('21-boom')

  console.log('场景：Boss 蓄力预警')
  await evJs(`(() => {
    ZT.Game.startLevel(6);
    const R = ZT.Run;
    R.nextCarKm = 1e9;
    ZT.UI.closeStation();
    R.state = 'run'; R.stationIdx = 3; R.km = R.totalKm * 0.34;
    R.train = new ZT.Train(R); R.train.s = R.km; R.speed = 22;
    const me = ZT.U.posAt(ZT.World.path, R.km, {});
    ZT.Zombies.list.length = 0;
    const p = ZT.U.posAt(ZT.World.path, R.km + 58, {});
    const zb = ZT.Zombies.make(p.x + 6, p.y + 8, {});
    zb.boss = true; zb.hp = zb.maxHp; zb.mode = 'windup'; zb.modeT = 0.55; zb.nextMode = 'charge'; zb.aiCd = 0.05;
    ZT.Zombies.list.push(zb);
    for (let i = 0; i < 14; i++) {
      const q = ZT.U.posAt(ZT.World.path, R.km + 8 + i * 4, {});
      const w = ZT.Zombies.make(q.x + (i % 2 ? 9 : -9), q.y + (i % 2 ? 6 : -6), {});
      if (i % 3 === 0) { w.burn = 3.4; w.burnDps = 7; }
      ZT.Zombies.list.push(w);
    }
    ZT.R.cam.cx = me.x + 14; ZT.R.cam.cy = me.y - 8; ZT.R.cam.zoom = 4.6; ZT.R.compute();
    ZT.Game.setSpeed(1);
    return 1;
  })()`)
  await sleep(220)
  await shot('22-boss')

  console.log('场景：守站（倒计时 + 尸潮）')
  await evJs(`(() => {
    ZT.Game.startLevel(10);
    const R = ZT.Run;
    R.nextCarKm = 1e9;
    ZT.UI.closeStation();
    R.state = 'run'; R.speed = 18; R.km = R.totalKm * 0.55;
    R.train = new ZT.Train(R); R.train.s = R.km;
    const me = ZT.U.posAt(ZT.World.path, R.km, {});
    ZT.Zombies.list.length = 0;
    for (let i = 0; i < 26; i++) {
      const a = i * 0.9;
      const zb = ZT.Zombies.make(me.x + Math.cos(a) * (18 + (i % 5) * 6), me.y + Math.sin(a) * (14 + (i % 4) * 5), { kind: i % 7 === 0 ? 'runner' : 'walker' });
      ZT.Zombies.list.push(zb);
    }
    R.enterHold();
    ZT.R.cam.cx = me.x; ZT.R.cam.cy = me.y - 4; ZT.R.cam.zoom = 3.4; ZT.R.compute();
    ZT.Game.setSpeed(1);
    return 1;
  })()`)
  await sleep(700)
  await shot('23-hold')

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
  await killTree(proc.pid)
  await sleep(400)
  await cleanupProfile()
  flushManifest()
  console.log('--- 运行期 console 报错（' + logs.length + '）---')
  for (const l of logs.slice(0, 20)) console.log(String(l).split('\n')[0])
  if (!logs.length) console.log('无')
  console.log('  manifest ->', join(OUT, 'manifest.json'), '(' + manifest.length + ' 张)')
}
