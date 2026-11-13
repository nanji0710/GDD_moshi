import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { rmSync, writeFileSync } from "node:fs"; import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = 'file:///' + join(HERE, '..', 'index.html').replace(/\\/g, '/');
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9531, PROFILE = join(tmpdir(), 'ztruin-' + Date.now());
const proc = spawn(EDGE, ['--headless=new','--disable-gpu','--enable-unsafe-swiftshader','--mute-audio','--no-first-run','--hide-scrollbars','--window-size=1280,760','--remote-debugging-port='+PORT,'--user-data-dir='+PROFILE,PAGE], { stdio: 'ignore' });
let ws, seq=0; const pending=new Map();
function send(m,p){ const id=++seq; return new Promise((res,rej)=>{ pending.set(id,{res,rej}); ws.send(JSON.stringify({id,method:m,params:p||{}})); setTimeout(()=>{ if(pending.has(id)){pending.delete(id);rej(new Error('timeout '+m));} },20000); }); }
async function find(){ for(let i=0;i<80;i++){ try{ const l=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json(); const p=l.find(t=>t.type==='page'&&t.url.startsWith('file:')); if(p) return p; }catch(e){} await sleep(200);} throw new Error('no target'); }
async function ev(x){ const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) return 'ERR '+(r.exceptionDetails.exception?.description||r.exceptionDetails.text); return r.result?.value; }
try {
  const page = await find(); ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  ws.onmessage=e=>{ const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){ const p=pending.get(m.id); pending.delete(m.id); m.error?p.rej(new Error(m.error.message)):p.res(m.result);} };
  await send('Runtime.enable'); await sleep(2600);
  console.log(await ev(`(() => {
    ZT.Game.startLevel(1);
    const R = ZT.Run, W = ZT.World;
    R.state='run'; R.stationIdx=3; R.km = R.totalKm*0.4; R.train.s = R.km; R.speed = 18;
    const me = ZT.U.posAt(W.path, R.km, {});
    // 找几栋最近的废墟，强制成着火的破楼
    const near = W.ruins.map(b => ({ b, d: Math.hypot(b.x-me.x, b.y-me.y) })).sort((a,b)=>a.d-b.d).slice(0,4);
    near.forEach((o, i) => { o.b.fire = i < 2; o.b.dmg = 0.85; o.b.h = Math.max(9, o.b.h); });
    ZT.R.follow = false; const nb = near[0].b; ZT.R.cam.cx = nb.x; ZT.R.cam.cy = nb.y - 4; ZT.R.cam.zoom = 6.5; ZT.R.compute();
    R.offer = null; R.nextCarKm = 1e9; ZT.UI.closeDrawer(); ZT.UI.hideScreen(); ZT.UI.showHUD(true);
    return JSON.stringify({ near: near.map(o=>Math.round(o.d)) });
  })()`));
  await sleep(1400);
  const shot = await send('Page.captureScreenshot', { format:'png' });
  writeFileSync(join(HERE,'shots','ruins2d.png'), Buffer.from(shot.data,'base64'));
  console.log('shot ruins2d');
} catch(e){ console.error('ERR', e.message); } finally { try{ws.close();}catch(e){} proc.kill(); await sleep(300); try{rmSync(PROFILE,{recursive:true,force:true});}catch(e){} }
