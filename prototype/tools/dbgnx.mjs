import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { rmSync } from "node:fs"; import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = 'file:///' + join(HERE, '..', 'index.html').replace(/\\/g, '/');
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9679, PROFILE = join(tmpdir(), 'ztnx-' + Date.now());
const proc = spawn(EDGE, ['--headless=new','--disable-gpu','--enable-unsafe-swiftshader','--mute-audio','--no-first-run','--window-size=900,560','--remote-debugging-port='+PORT,'--user-data-dir='+PROFILE,PAGE], { stdio: 'ignore' });
let ws, seq=0; const pending=new Map();
function send(m,p){ const id=++seq; return new Promise((res,rej)=>{ pending.set(id,{res,rej}); ws.send(JSON.stringify({id,method:m,params:p||{}})); setTimeout(()=>{ if(pending.has(id)){pending.delete(id);rej(new Error('timeout'));} },15000); }); }
async function find(){ for(let i=0;i<80;i++){ try{ const l=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json(); const p=l.find(t=>t.type==='page'&&t.url.startsWith('file:')); if(p) return p; }catch(e){} await sleep(200);} throw new Error('no target'); }
async function ev(x){ const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) return 'ERR '+(r.exceptionDetails.exception?.description||'').split('\n')[0]; return r.result?.value; }
try {
  const page = await find(); ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  ws.onmessage=e=>{ const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){ const p=pending.get(m.id); pending.delete(m.id); m.error?p.rej(new Error(m.error.message)):p.res(m.result);} };
  await send('Runtime.enable'); await sleep(2500);
  console.log(await ev(`(() => {
    ZT.Game.startLevel(1);
    const R = ZT.Run;
    R.state = 'run'; R.speed = 0;
    R.km = R.totalKm * 0.5; R.train.s = R.km;
    const st = ZT.World.stations;
    return JSON.stringify({
      totalKm: Math.round(R.totalKm),
      km: Math.round(R.km),
      stationIdx: R.stationIdx,
      stations: st.map(s => Math.round(s.km)),
      nextByIdx: st[R.stationIdx+1] ? Math.round(st[R.stationIdx+1].km) : null,
      nextFn: R.nextStation ? Math.round(R.nextStation()) : null,
      at: ZT.CFG.STATION_AT
    });
  })()`));
} catch(e){ console.error('ERR', e.message); } finally { try{ws.close();}catch(e){} proc.kill(); await sleep(300); try{rmSync(PROFILE,{recursive:true,force:true});}catch(e){} }
