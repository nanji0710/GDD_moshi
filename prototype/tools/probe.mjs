/**
 * 运行期探针：加载原型、按固定节奏取样列车状态，用于排查「车不动 / 里程不涨」这类问题。
 * 用法：node tools/probe.mjs
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9488
const PROFILE = join(tmpdir(), 'zt-probe-' + Date.now())
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--mute-audio', '--no-first-run',
  '--window-size=1400,800', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
  'file:///E:/github/sss/prototype/index.html'], { stdio: 'ignore' })

let ws, seq = 0
const pending = new Map()
const logs = []
function send(method, params) {
  const id = ++seq
  return new Promise((res, rej) => {
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params: params || {} }))
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)) } }, 15000)
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
  if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result?.value
}
try {
  const page = await findTarget()
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = e => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return }
    if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map(a => a.value ?? a.description).join(' '))
  }
  await send('Runtime.enable'); await send('Page.enable')
  await sleep(2500)
  console.log('boot:', await ev(`(() => {
    const G = window.ZT.Game, W = window.ZT.World;
    return JSON.stringify({
      stations: W.stations.map(s => Math.round(s.s)),
      pathLen: Math.round(W.path.len),
      trainS: Math.round(G.train.s), nextIdx: G.train.nextIdx, state: G.train.state, dockT: Math.round(G.train.dockT),
      buildings: W.ruins.length, trees: W.trees.length
    });
  })()`))
  console.log('click 发车:', await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/发车/.test(x.textContent)); if(!b) return 'MISS'; b.click(); return 'OK' })()`))
  await sleep(400)
  console.log('begin:', await ev(`(() => { const G=window.ZT.Game; return JSON.stringify({state:G.state, speed:G.speed, dockT:Math.round(G.train.dockT), nextIdx:G.train.nextIdx}) })()`))
  // 直接出站并加速取样
  await ev(`(() => { const G=window.ZT.Game; G.departSoon(); G.speed=2; window.ZT.UI.closeDrawer(); return 1 })()`)
  for (let i = 0; i < 6; i++) {
    await sleep(1000)
    console.log(i + 's:', await ev(`(() => {
      const G = window.ZT.Game, t = G.train;
      return JSON.stringify({ s: Math.round(t.s), od: Math.round(t.odometer), v: +t.v.toFixed(2), st: t.state, next: t.nextIdx, fuel: +G.fuel.toFixed(1), dockT: +t.dockT.toFixed(1), hp: t.cars.map(c=>Math.round(c.hp)) });
    })()`))
  }
} catch (e) { console.error('ERR', e.message) } finally {
  console.log('--- console errors ---'); logs.slice(0, 10).forEach(l => console.log(l))
  try { ws.close() } catch (e) {}
  proc.kill(); await sleep(400)
  try { rmSync(PROFILE, { recursive: true, force: true }) } catch (e) {}
}
