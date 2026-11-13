import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { rmSync, writeFileSync } from "node:fs"; import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = 'file:///' + join(HERE, '..', 'index.html').replace(/\\/g, '/');
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9523, PROFILE = join(tmpdir(), 'ztw3-' + Date.now());
const proc = spawn(EDGE, ['--headless=new','--disable-gpu','--enable-unsafe-swiftshader','--use-angle=swiftshader','--mute-audio','--no-first-run','--hide-scrollbars','--window-size=1280,760','--remote-debugging-port='+PORT,'--user-data-dir='+PROFILE,PAGE], { stdio: 'ignore' });
let ws, seq=0; const pending=new Map(); const errs=[];
function send(m,p){ const id=++seq; return new Promise((res,rej)=>{ pending.set(id,{res,rej}); ws.send(JSON.stringify({id,method:m,params:p||{}})); setTimeout(()=>{ if(pending.has(id)){pending.delete(id);rej(new Error('timeout '+m));} },20000); }); }
async function find(){ for(let i=0;i<80;i++){ try{ const l=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json(); const p=l.find(t=>t.type==='page'&&t.url.startsWith('file:')); if(p) return p; }catch(e){} await sleep(200);} throw new Error('no target'); }
async function ev(x){ const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) return 'ERR '+(r.exceptionDetails.exception?.description||r.exceptionDetails.text); return r.result?.value; }
try {
  const page = await find(); ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  ws.onmessage=e=>{ const m=JSON.parse(e.data);
    if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error') errs.push(m.params.args.map(a=>a.value||a.description).join(' '));
    if(m.method==='Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description||'exception');
    if(m.id&&pending.has(m.id)){ const p=pending.get(m.id); pending.delete(m.id); m.error?p.rej(new Error(m.error.message)):p.res(m.result);} };
  await send('Runtime.enable'); await sleep(2600);
  console.log('open3d:', await ev(`(() => { ZT.Game.startLevel(1); const ok = ZT.World3D.setMode(true); return JSON.stringify({ok, on: ZT.World3D.on}); })()`));
  await ev(`(() => { const R = ZT.Run; R.scrap = 4000; R.nextCarKm = 1e9;
    for (const t of ['weapon','passenger','power','weapon']) R.cars.push(new ZT.Car(t));
    for (const c of R.cars) for (let i=0;i<c.slots.length;i++) c.slots[i] = new ZT.Weapon('mg', 3);
    document.querySelector('.drawer').classList.add('hidden');
    R.state='run'; R.stationIdx=3; R.km = R.totalKm*0.35; R.train.s = R.km; R.speed = 26;
    return 1; })()`);
  await sleep(2200);
  const shot = await send('Page.captureScreenshot', { format:'png' });
  writeFileSync(join(HERE,'shots','world3d-1.png'), Buffer.from(shot.data,'base64'));
  console.log('shot world3d-1');
  console.log('errors:', errs.length?errs.slice(0,3):'无');
} catch(e){ console.error('ERR', e.message); } finally { try{ws.close();}catch(e){} proc.kill(); await sleep(300); try{rmSync(PROFILE,{recursive:true,force:true});}catch(e){} }
