import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = 'file:///' + join(HERE, 'index.html').replace(/\\/g, '/');
const OUT = join(HERE, 'shots');
mkdirSync(OUT, { recursive: true });
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9511, PROFILE = join(tmpdir(), 'zt3d-' + Date.now());
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader', '--mute-audio', '--no-first-run', '--hide-scrollbars',
  '--window-size=1280,800', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, PAGE], { stdio: 'ignore' });

let ws, seq = 0; const pending = new Map(); const errs = [];
function send(m, p) {
  const id = ++seq;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method: m, params: p || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + m)); } }, 20000);
  });
}
async function find() {
  for (let i = 0; i < 80; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(t => t.type === 'page' && t.url.startsWith('file:'));
      if (p) return p;
    } catch (e) {}
    await sleep(200);
  }
  throw new Error('no target');
}
async function ev(x) {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
}
try {
  const page = await find();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(m.params.args.map(a => a.value || a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || 'exception');
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  };
  await send('Runtime.enable');
  await sleep(3000);
  const info = await ev(`JSON.stringify({ gl: !!document.getElementById('cv').getContext('webgl'), n: document.querySelectorAll('.bar button').length })`);
  console.log('init:', info);
  const names = ['loco', 'cargo', 'weapon', 'zombie', 'building', 'consist'];
  for (let i = 0; i < 6; i++) {
    await ev(`document.querySelectorAll('.bar button')[${i}].click()`);
    await sleep(i === 5 ? 900 : 700);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, names[i] + '.png'), Buffer.from(shot.data, 'base64'));
    console.log('shot', names[i]);
  }
  console.log('console errors:', errs.length ? errs.slice(0, 4) : '无');
} catch (e) { console.error('ERR', e.message); }
finally { try { ws.close(); } catch (e) {} proc.kill(); await sleep(300); try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {} }
