import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { rmSync, writeFileSync } from "node:fs"; import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = 'file:///' + join(HERE, '..', 'index.html').replace(/\\/g, '/');
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9551, PROFILE = join(tmpdir(), 'ztcmp-' + Date.now());
const proc = spawn(EDGE, ['--headless=new','--disable-gpu','--enable-unsafe-swiftshader','--use-angle=swiftshader','--mute-audio','--no-first-run','--hide-scrollbars','--window-size=1280,760','--remote-debugging-port='+PORT,'--user-data-dir='+PROFILE,PAGE], { stdio: 'ignore' });
let ws, seq=0; const pending=new Map();
function send(m,p){ const id=++seq; return new Promise((res,rej)=>{ pending.set(id,{res,rej}); ws.send(JSON.stringify({id,method:m,params:p||{}})); setTimeout(()=>{ if(pending.has(id)){pending.delete(id);rej(new Error('timeout '+m));} },20000); }); }
async function find(){ for(let i=0;i<80;i++){ try{ const l=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json(); const p=l.find(t=>t.type==='page'&&t.url.startsWith('file:')); if(p) return p; }catch(e){} await sleep(200);} throw new Error('no target'); }
async function ev(x){ const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) return 'ERR '+(r.exceptionDetails.exception?.description||r.exceptionDetails.text); return r.result?.value; }
async function shot(name){ const s=await send('Page.captureScreenshot',{format:'png'}); writeFileSync(join(HERE,'shots',name), Buffer.from(s.data,'base64')); console.log('shot',name); }
try {
  const page = await find(); ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  ws.onmessage=e=>{ const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){ const p=pending.get(m.id); pending.delete(m.id); m.error?p.rej(new Error(m.error.message)):p.res(m.result);} };
  await send('Runtime.enable'); await sleep(2600);
  const setup = `(() => {
    ZT.Game.startLevel(1);
    const R = ZT.Run;
    R.nextCarKm = 1e9; R.offer = null;
    for (const t of ['weapon','weapon','passenger','power']) R.cars.push(new ZT.Car(t));
    for (const c of R.cars) for (let i = 0; i < c.slots.length; i++) c.slots[i] = new ZT.Weapon('mg', 5);
    R.state='run'; R.stationIdx=3; R.km = R.totalKm*0.35; R.train.s = R.km; R.speed = 22;
    ZT.UI.closeDrawer(); ZT.UI.hideScreen(); ZT.UI.showHUD(false);
    const me = ZT.U.posAt(ZT.World.path, R.km, {});
    ZT.Zombies.list.length = 0;
    for (let i = 0; i < 34; i++) {
      const a2 = i * 0.62, rr = 12 + (i % 6) * 8;
      const zb = ZT.Zombies.make(me.x + Math.cos(a2) * rr, me.y + Math.sin(a2) * rr, { kind: i % 7 === 0 ? 'runner' : 'walker' });
      if (i % 11 === 0) zb.elite = true;
      ZT.Zombies.list.push(zb);
    }
    ZT.R.follow = true; ZT.R.cam.zoom = 2.0; ZT.R.compute();
    return 'ok';
  })()`;
  console.log('setup:', await ev(setup));
  await sleep(900);
  await shot('cmp-2d.png');
  console.log('3d:', await ev(`(() => { ZT.World3D.setMode(true); return ZT.World3D.on; })()`));
  await sleep(1000);
  await shot('cmp-3d.png');
  await ev(`(() => { const W=ZT.World3D; W.camNear=true; return 1; })()`);
  await sleep(400);
  await shot('cmp-3d-close.png');
} catch(e){ console.error('ERR', e.message); } finally { try{ws.close();}catch(e){} proc.kill(); await sleep(300); try{rmSync(PROFILE,{recursive:true,force:true});}catch(e){} }
