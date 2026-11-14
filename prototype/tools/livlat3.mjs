import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { rmSync } from "node:fs"; import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
async function testLive(label, rate, port) {
  const PROFILE = join(tmpdir(), 'ztl3-' + Date.now());
  const proc = spawn(EDGE, ['--headless=new','--disable-gpu','--mute-audio','--no-first-run','--hide-scrollbars','--window-size=1400,860','--remote-debugging-port='+port,'--user-data-dir='+PROFILE,'https://last-train-87y.pages.dev/'], { stdio: 'ignore' });
  let ws, seq=0; const pending=new Map();
  const send=(m,p)=>{ const id=++seq; return new Promise((res,rej)=>{ pending.set(id,{res,rej}); ws.send(JSON.stringify({id,method:m,params:p||{}})); setTimeout(()=>{ if(pending.has(id)){pending.delete(id);rej(new Error('timeout'));} },30000); }); };
  const find=async()=>{ for(let i=0;i<120;i++){ try{ const l=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json(); const p=l.find(t=>t.type==='page'); if(p) return p; }catch(e){} await sleep(200);} throw new Error('no target'); };
  const ev=async x=>{ const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) return 'ERR '+(r.exceptionDetails.exception?.description||'').split('\n')[0]; return r.result?.value; };
  try {
    const page = await find(); ws=new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
    ws.onmessage=e=>{ const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){ const p=pending.get(m.id); pending.delete(m.id); m.error?p.rej(new Error(m.error.message)):p.res(m.result);} };
    await send('Runtime.enable'); if (rate) await send('Emulation.setCPUThrottlingRate',{rate});
    await sleep(10000);
    const rect = JSON.parse(await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>/开始游戏/.test(x.textContent)); if(!b) return 'null'; const r=b.getBoundingClientRect(); window.__t={over:0,paint:0}; b.addEventListener('mouseover',()=>{ window.__t.over=performance.now(); requestAnimationFrame(()=>window.__t.paint=performance.now()); }); return JSON.stringify({x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}); })()`) || 'null');
    if (!rect) { console.log(label, 'no button'); return; }
    await sleep(500);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x,y:rect.y-220,button:'none',buttons:0});
    await sleep(200);
    const t0 = await ev('performance.now()');
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x,y:rect.y,button:'none',buttons:0});
    await sleep(4000);
    const tt = JSON.parse(await ev('JSON.stringify(window.__t)'));
    console.log(label, JSON.stringify({ handlerDelay: Math.round(tt.over-t0), paintDelay: Math.round(tt.paint-t0) }));
  } catch(e){ console.error(label,'ERR', e.message); } finally { try{ws.close();}catch(e){} proc.kill(); await sleep(300); try{rmSync(PROFILE,{recursive:true,force:true});}catch(e){} }
}
await testLive('LIVE-1x', 1, 9905);
await testLive('LIVE-4x', 4, 9907);
