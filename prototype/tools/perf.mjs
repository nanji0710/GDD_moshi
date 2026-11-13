/**
 * 首屏性能实测（零依赖 CDP，只用系统 Edge）：#4 的唯一验收工具。
 *
 * 三轮，全部 file:// 冷启动（?perf=nonce 防缓存），CPU 4× 降速：
 *   A. 干净首屏：用 CDP Network 事件统计「DCL 之前发起的请求」字节（= 同步传输），
 *      以及 DCL / 首次内容绘制 / 标题可交互时间；models-data.js 若在 DCL 之后才请求，单列异步。
 *   B. 加载态取证：重新导航，用 Fetch 域名拦截把 js/main.js 挂起，截图「启动 loading」，
 *      再放行；随后挂起 assets/models-data.js，验证「模型资源加载中…」可见、
 *      此时切 3D 被拦下（不出现空 3D），放行后 3D 就绪、40 个网格。
 *   C. file:// 实点：主菜单 → 选关 → 站台，统计 console 报错 / 404 / CORS 失败。
 *
 * 用法：
 *   node tools/perf.mjs                 # 默认 CPU 4×
 *   CPU_RATE=1 node tools/perf.mjs      # 关掉降速
 *   SHOTS=1 node tools/perf.mjs         # 额外截图到 tools/shots-perf/
 *
 * 注：file:// 页面拿不到 PerformanceResourceTiming（Chrome 返回空数组），所以字节数用
 *     Network.loadingFinished.encodedDataLength，请求先后顺序用 requestWillBeSent.wallTime
 *     换算到页面 timeOrigin；两者都来自 CDP 实测，不估算。
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join as pjoin } from 'node:path'
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import netMod from 'node:net'

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const CPU_RATE = Number(process.env.CPU_RATE || 4)
const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE_URL = 'file:///' + pjoin(HERE, '..', 'index.html').replace(/\\/g, '/') + '?perf=' + Date.now().toString(36)
const SHOTS = !!process.env.SHOTS
const MODE = process.env.MODE || 'full'    // full | a（只跑首屏段，用于 3 次中位对照）
const SHOT_DIR = pjoin(HERE, 'shots-perf')

async function freePort() {
  return await new Promise((res, rej) => {
    const s = netMod.createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
  })
}
const PORT = Number(process.env.PORT || await freePort())
const PROFILE = pjoin(tmpdir(), 'zt-perf-' + Date.now().toString(36))

const proc = spawn(EDGE, ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  '--mute-audio', '--no-first-run', '--hide-scrollbars', '--window-size=1500,860',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, 'about:blank'], { stdio: 'ignore' })

async function killTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    await new Promise(res => { const k = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); k.on('exit', res); k.on('error', res) })
  } else { try { process.kill(pid, 'SIGKILL') } catch (e) {} }
}

let ws, seq = 0
const pending = new Map()
let consoleErrors = []
let allErrors = []             // 跨轮累计（判定用）
let allFails = []
let allInfos = []              // [GLB] 日志
let requests = []              // 本轮导航的请求
let reqById = new Map()
let paused = []                // Fetch 拦截挂起的请求
let holdMatch = ''             // 当前要挂起的 URL 关键字（空 = 全部放行）

function send(m, p) {
  const id = ++seq
  return new Promise((res, rej) => {
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method: m, params: p || {} }))
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + m)) } }, 20000)
  })
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
  return r.result?.value
}
async function waitFor(expr, timeout = 20000, step = 100) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try { if (await ev(expr)) return true } catch (e) {}
    await sleep(step)
  }
  return false
}
async function findTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()
      const p = list.find(t => t.type === 'page')
      if (p) return p
    } catch (e) {}
    await sleep(200)
  }
  throw new Error('no target on port ' + PORT)
}
async function shot(name) {
  if (!SHOTS) return
  const s = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(pjoin(SHOT_DIR, name), Buffer.from(s.data, 'base64'))
  console.log('   截图 tools/shots-perf/' + name)
}
async function setHold(match) {
  holdMatch = match || ''
}
// Fetch 会话只开一次：反复 disable/enable 会让后续请求绕过拦截（实测），所以全程保持开启，
// 只切换 holdMatch 决定挂起谁、其余一律放行。
async function fetchOn() {
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
}
async function releasePaused() {
  const list = paused; paused = []
  for (const p of list) { try { await send('Fetch.continueRequest', { requestId: p.id }) } catch (e) {} }
  return list.length
}
const kb = n => (n / 1024).toFixed(1)
const fmt = n => n.toLocaleString('en-US')
function diskSize(url) {
  try { return statSync(decodeURIComponent(url.replace(/^file:\/\/\//, '').split('?')[0])).size } catch (e) { return 0 }
}
// 100ms 采样：启动 loading / 模型 pill / 标题 / 模型就绪
async function sample() {
  return await ev(`(() => {
    const b = document.getElementById('boot-loading');
    const a = document.getElementById('asset-loading');
    const vis = el => !!el && getComputedStyle(el).display !== 'none' && +getComputedStyle(el).opacity > 0.01;
    return { t: performance.now(), boot: vis(b), pill: vis(a) && !a.classList.contains('hidden'),
      title: !!document.querySelector('.start-root'), glb: !!(window.ZT && ZT.GLB && ZT.GLB.ready) };
  })()`)
}
async function sampleUntil(cond, out, timeout = 25000, step = 30) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const s = await sample()
    out.push(s)
    if (cond(s)) return s
    await sleep(step)
  }
  return null
}

try {
  const page = await findTarget()
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = e => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id)
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result)
      return
    }
    const P = m.params
    if (m.method === 'Runtime.exceptionThrown') {
      const d = P.exceptionDetails
      const msg = 'exception: ' + (d.exception?.description || d.text || '').split('\n')[0]
      consoleErrors.push(msg); allErrors.push(msg)
    } else if (m.method === 'Runtime.consoleAPICalled' && P.type === 'error') {
      const msg = 'console.error: ' + P.args.map(a => a.value ?? a.description).join(' ')
      consoleErrors.push(msg); allErrors.push(msg)
    } else if (m.method === 'Runtime.consoleAPICalled' && P.type === 'info') {
      const msg = P.args.map(a => a.value ?? a.description).join(' ')
      if (String(msg).startsWith('[GLB]')) allInfos.push(msg)
    } else if (m.method === 'Network.requestWillBeSent') {
      const r = { url: P.request.url, type: P.type, wall: P.wallTime, ts: P.timestamp, bytes: 0, status: 0, failed: '',
        initiator: (P.initiator && P.initiator.type) || '' }
      requests.push(r); reqById.set(P.requestId, r)
    } else if (m.method === 'Network.responseReceived') {
      const r = reqById.get(P.requestId); if (r) r.status = P.response.status
    } else if (m.method === 'Network.loadingFinished') {
      const r = reqById.get(P.requestId)
      if (r) r.bytes = P.encodedDataLength || diskSize(r.url)
    } else if (m.method === 'Network.loadingFailed') {
      const r = reqById.get(P.requestId); if (r) { r.failed = P.errorText; r.canceled = !!P.canceled }
      if (!P.canceled) allFails.push(P.requestId + ' ' + P.errorText)
    } else if (m.method === 'Fetch.requestPaused') {
      const url = P.request.url
      if (holdMatch && url.includes(holdMatch)) paused.push({ id: P.requestId, url })
      else send('Fetch.continueRequest', { requestId: P.requestId }).catch(() => {})
    }
  }

  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
  // 冷启动口径：禁缓存，避免 file:// 复跑时命中内存缓存导致 Fetch 拦截失效/字节数为 0
  await send('Network.setCacheDisabled', { cacheDisabled: true })
  await send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE })
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__perf = { titleAt: 0 };try{var rec=function(){if(!window.__perf.titleAt&&document.querySelector('.start-root'))window.__perf.titleAt=performance.now()};new MutationObserver(rec).observe(document,{childList:true,subtree:true});document.addEventListener('DOMContentLoaded',rec)}catch(e){}`
  })
  if (SHOTS) { mkdirSync(SHOT_DIR, { recursive: true }) }

  // ================= A. 干净首屏 =================
  console.log('== A. 首屏（file:// 冷启动，CPU ' + CPU_RATE + '× 降速）==')
  console.log('   URL ' + PAGE_URL)
  requests = []; reqById = new Map(); consoleErrors = []
  const samples = []
  const t0 = Date.now()
  await send('Page.navigate', { url: PAGE_URL })
  await sampleUntil(s => s.title, samples)
  const nav = await ev(`(() => { const n = performance.getEntriesByType('navigation')[0]; return {
    timeOrigin: performance.timeOrigin, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd,
    interactive: n.domInteractive, fcp: (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0,
    titleAt: window.__perf ? window.__perf.titleAt : 0
  } })()`)
  const firstTitleSample = samples.find(s => s.title)
  if (nav.titleAt === 0 && firstTitleSample) nav.titleAt = firstTitleSample.t
  if (process.env.DEBUG_BOOT) console.log('   [boot 时间戳] ' + await ev('JSON.stringify(window.__b || [])'))
  await shot('01-title.png')
  for (const r of requests) r.start = r.wall * 1000 - nav.timeOrigin
  const sync = requests.filter(r => r.start <= nav.dcl)
  const sum = a => a.reduce((s, r) => s + (r.bytes || 0), 0)
  const syncBytes = sum(sync)
  console.log('   资源明细（DCL=' + nav.dcl.toFixed(0) + 'ms 为界，按字节降序）：')
  for (const r of [...requests].sort((a, b) => b.bytes - a.bytes)) {
    console.log('     ' + (r.start <= nav.dcl ? '同步' : '异步') + '  ' + String(r.bytes).padStart(9) + ' B  ' +
      (r.start.toFixed(0) + 'ms').padStart(7) + '  ' + String(r.type).padEnd(10) + ' ' +
      r.url.replace(/^.*\/prototype\//, '').split('?')[0])
  }
  console.log('   ----')
  console.log('   首屏同步传输：' + fmt(syncBytes) + ' B（' + kb(syncBytes) + ' KB，' + sync.length + ' 个请求，DCL 之前发起）')
  console.log('   DOMContentLoaded: ' + nav.dcl.toFixed(0) + ' ms ｜ load: ' + nav.load.toFixed(0) + ' ms ｜ FCP: ' + nav.fcp.toFixed(0) + ' ms ｜ 标题可交互: ' + nav.titleAt.toFixed(0) + ' ms')
  console.log('   DCL ≤ 1500ms：' + (nav.dcl <= 1500 ? 'PASS' : 'FAIL') + '（' + nav.dcl.toFixed(0) + ' ms）')
  console.log('   同步 ≤ 900KB(921,600 B)：' + (syncBytes <= 921600 ? 'PASS' : 'FAIL') + '（' + fmt(syncBytes) + ' B = ' + kb(syncBytes) + ' KiB）')
  console.log('   同步 ≤ 900,000 B 口径：' + (syncBytes <= 900000 ? 'PASS' : 'FAIL'))
  await fetchOn()
  if (MODE !== 'a') {

  // ================= C1. 干净加载下的实点流程 =================
  console.log('== C1. file:// 实点：主菜单 → 选关 → 站台（干净加载）==')
  const glbAtTitle = await ev('!!(window.ZT.GLB && ZT.GLB.ready)')
  const clickedStart = await ev(`(() => { const b = [...document.querySelectorAll('.start-btn')].find(x => /开始游戏/.test(x.textContent)); if (!b) return false; b.click(); return true })()`)
  const mapOk = clickedStart && await waitFor('!!document.querySelector(".panel-map")', 8000)
  const picked = await ev(`(() => { const n = document.querySelector('.map-city.current') || document.querySelector('.map-city'); if (!n) return false; n.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true })()`)
  const cardOk = picked && await waitFor(`[...document.querySelectorAll('.mc-acts .btn')].some(b => /出发/.test(b.textContent))`, 5000)
  const go = cardOk && await ev(`(() => { const b = [...document.querySelectorAll('.mc-acts .btn')].find(x => /出发/.test(x.textContent)); if (!b) return false; b.click(); return true })()`)
  const stationOk = go && await waitFor('window.ZT.Run.state === "station"', 15000)
  await sleep(300)
  const drawer = await ev('window.ZT.UI.drawerState')
  await shot('02-station.png')
  console.log('   点「开始游戏」' + (clickedStart ? '✅' : '❌') + ' → 关卡地图' + (mapOk ? '✅' : '❌') +
    ' → 选关' + (cardOk ? '✅' : '❌') + ' → 点「出发」' + (go ? '✅' : '❌') +
    ' → Run.state=' + await ev('window.ZT.Run.state') + '，站台面板=' + drawer)
  console.log('   标题时模型就绪=' + glbAtTitle + '，进站台后模型就绪=' + await ev('!!(window.ZT.GLB && ZT.GLB.ready)'))

  // 模型数据请求的时间线（异步性证明）
  for (const r of requests) r.start = r.wall * 1000 - nav.timeOrigin
  const md = requests.find(r => /models-data\.js/.test(r.url))
  if (md) {
    console.log('   时间线原始数据：DCL=' + nav.dcl.toFixed(2) + 'ms ｜ 标题可见=' + nav.titleAt.toFixed(2) + 'ms');
    console.log('   models-data requestWillBeSent：ts(monotonic)=' + md.ts + 's wallTime=' + md.wall + 's → 页面 ' +
      md.start.toFixed(0) + 'ms ｜ initiator=' + md.initiator + ' ｜ type=' + md.type + ' ｜ bytes=' + fmt(md.bytes))
    console.log('   → 异步判定：start=' + md.start.toFixed(0) + 'ms ' + (md.start > nav.titleAt ? '>' : '<=') +
      ' 标题可见=' + nav.titleAt.toFixed(0) + 'ms，initiator 非 parser = ' + (md.initiator !== 'parser') +
      '；models-data 不在 index.html 同步 script 里')
    const t3d = Date.now()
    await ev('window.ZT.UI.toggle3D()')
    await waitFor('!!window.ZT.World3D.on', 15000); await sleep(300)
    console.log('   模型就绪后切 3D：on=' + await ev('!!window.ZT.World3D.on') + '，网格数=' +
      await ev('Object.keys(window.ZT.World3D.mesh || {}).length') + '（' + (Date.now() - t3d) + ' ms）')
    await shot('03-3d.png')
  }

  // ================= B. 加载态取证（Fetch 挂起） =================
  console.log('== B. 加载态取证（Fetch 拦截挂起，模拟慢网）==')
  requests = []; reqById = new Map(); consoleErrors = []
  await setHold('js/main.js')
  await send('Page.navigate', { url: PAGE_URL + '-load' })
  await sleep(700)
  const bootSamples = []
  await sampleUntil(s => s.boot, bootSamples)   // 等启动 loading 出现（<=1s）
  const boot = await sample()
  console.log('   启动 loading：可见=' + boot.boot + '（采样 ' + (bootSamples.length ? '命中' : '未命中') + '，t=' + boot.t.toFixed(0) + 'ms）')
  await shot('04-boot-loading.png')
  const heldMain = paused.length
  await releasePaused()
  await setHold('')
  await waitFor('!!document.querySelector(".start-root")', 15000)
  console.log('   挂起请求 ' + heldMain + ' 个后放行 → 标题出现；console 报错=' + consoleErrors.length +
    '；GLB=' + await ev('JSON.stringify({ready:!!(window.ZT.GLB&&window.ZT.GLB.ready),loading:!!(window.ZT.GLB&&window.ZT.GLB.loading)})') +
    '；GLB 日志=' + JSON.stringify(allInfos))

  // ================= D. 模型异步加载 + 3D 门禁 =================
  console.log('== D. 模型数据异步加载 + 首次切 3D 门禁 ==')
  await setHold('models-data.js')
  const tStart = Date.now()
  const clickedStart2 = await ev(`(() => { const b = [...document.querySelectorAll('.start-btn')].find(x => /开始游戏/.test(x.textContent)); if (!b) return false; b.click(); return true })()`)
  const mapOk2 = clickedStart2 && await waitFor('!!document.querySelector(".panel-map")', 8000)
  await ev(`(() => { const n = document.querySelector('.map-city.current') || document.querySelector('.map-city'); if (!n) return false; n.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true })()`)
  await waitFor(`[...document.querySelectorAll('.mc-acts .btn')].some(b => /出发/.test(b.textContent))`, 5000)
  await ev(`(() => { const b = [...document.querySelectorAll('.mc-acts .btn')].find(x => /出发/.test(x.textContent)); if (!b) return false; b.click(); return true })()`)
  await waitFor('window.ZT.Run.state === "station"', 15000)
  // 等 Fetch 真正挂住 models-data.js，再断言加载态（否则本地盘读太快，断言会空转）
  const tPause = Date.now()
  while (paused.length === 0 && Date.now() - tPause < 5000) await sleep(50)
  const glbState = await ev(`JSON.stringify({ ready: !!(window.ZT.GLB && ZT.GLB.ready), loading: !!(window.ZT.GLB && ZT.GLB.loading), req: (window.ZT.GLB ? 'ensure' : 'none') })`)
  const pillShown = await waitFor(`(() => { const a = document.getElementById('asset-loading'); return !!a && !a.classList.contains('hidden') })()`, 5000)
  const pillText = await ev(`(() => { const a = document.getElementById('asset-loading'); return a ? a.textContent : '' })()`)
  console.log('   进游戏后模型加载中 pill：' + (pillShown ? '可见' : '不可见') + '，文案=' + JSON.stringify(pillText) +
    '，挂起请求数=' + paused.length + '，GLB 状态=' + glbState)
  console.log('   GLB 日志=' + JSON.stringify(allInfos))
  await shot('05-asset-loading.png')
  const toastBefore = await ev(`(() => { const t = document.querySelector('.toast'); return t ? t.textContent : '' })()`)
  const onBefore = await ev('!!window.ZT.World3D.on')
  await ev('window.ZT.UI.toggle3D()')
  await sleep(220)
  const onWhileLoading = await ev('!!window.ZT.World3D.on')
  const toast3d = await ev(`(() => { const t = document.querySelector('.toast'); return t ? t.textContent : '' })()`)
  console.log('   模型未就绪时切 3D：World3D.on ' + onBefore + ' → ' + onWhileLoading + '（应 false）；提示=' + JSON.stringify(toast3d || toastBefore))
  const released = await releasePaused()
  const readyOk = await waitFor('!!(window.ZT.GLB && window.ZT.GLB.ready)', 15000)
  const pillAfter = await ev(`(() => { const a = document.getElementById('asset-loading'); return !!a && !a.classList.contains('hidden') })()`)
  console.log('   放行 ' + released + ' 个请求 → 模型就绪=' + readyOk + '，pill 消失=' + !pillAfter + '（' + (Date.now() - tStart) + ' ms）')
  await ev('window.ZT.UI.toggle3D()')
  await waitFor('!!window.ZT.World3D.on', 15000); await sleep(300)
  console.log('   就绪后切 3D：on=' + await ev('!!window.ZT.World3D.on') + '，网格数=' + await ev('Object.keys(window.ZT.World3D.mesh || {}).length'))
  await shot('06-3d-ready.png')

  // ================= 汇总 =================
  const bad = requests.filter(r => r.failed && !r.canceled)
  const four04 = requests.filter(r => r.status === 404)
  console.log('== 汇总 ==')
  console.log('   console 报错（全程累计）：' + allErrors.length + (allErrors.length ? '\n     ' + allErrors.join('\n     ') : ''))
  console.log('   请求失败/CORS（全程累计）：' + allFails.length + (allFails.length ? '\n     ' + allFails.join('\n     ') : ''))
  console.log('   404（本轮）：' + four04.length + (four04.length ? '\n     ' + four04.map(r => r.url).join('\n     ') : '') +
    ' ｜ 本轮失败：' + bad.length)
  console.log('   结论：console 0 = ' + (allErrors.length === 0) + ' ｜ 0 个 404 = ' + (four04.length === 0) +
    ' ｜ 0 个 CORS/失败 = ' + (allFails.length === 0) + ' ｜ 可开局到站台 = ' + !!stationOk + '（' + drawer + '）')
  } else { console.log('   （MODE=a：只跑首屏段）') }
} catch (e) {
  console.error('PERF ERR', e && e.stack || e)
  process.exitCode = 1
} finally {
  try { ws && ws.close() } catch (e) {}
  await killTree(proc.pid)
  await sleep(300)
  for (let i = 0; i < 8; i++) { try { rmSync(PROFILE, { recursive: true, force: true }); break } catch (e) { await sleep(250) } }
}
