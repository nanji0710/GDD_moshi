'use strict';
// 特效：曳光、枪口闪光、命中血花、爆炸、飘字、屏幕震动。
// 结构对标 city-and-metro/js/render.js 的 R.fx（{kind,x,y,o,t,dur}）+ drawFx 的 switch 分发，
// 区别是这里允许攻击类特效带「起止点」与「世界高度」，并且生命周期统一由 dt 推进。
window.ZT = window.ZT || {};
(function (Z) {
  const U = Z.U;

  const FX = Z.Fx = {
    list: [],
    shake: 0,
    shakeX: 0, shakeY: 0,

    reset: function () { this.list.length = 0; this.shake = 0; },

    add: function (kind, o, dur) {
      o = o || {};
      this.list.push({ kind: kind, t: 0, dur: dur || (o.dur || 0.4), o: o });
      if (this.list.length > 420) this.list.shift();
    },
    tracer: function (x0, y0, h0, x1, y1, h1, color, w) {
      this.add('tracer', { x0: x0, y0: y0, h0: h0, x1: x1, y1: y1, h1: h1, color: color, w: w || 1.6 }, 0.09);
    },
    flash: function (x, y, h, color, r) { this.add('flash', { x: x, y: y, h: h, color: color, r: r || 3.2 }, 0.11); },
    blood: function (x, y, h, color) { this.add('blood', { x: x, y: y, h: h, color: color || '#7a1f1f' }, 0.55, 0); },
    boom: function (x, y, h, r) {
      const rr = r || 12;
      this.add('boom', { x: x, y: y, h: h, r: rr }, 0.5);
      this.ring(x, y, h, rr * 1.15, '#ffe0b0');     // 冲击波环
      this.sparks(x, y, h, 9, '#ffb04a');           // 火星
      this.scorch(x, y, rr * 0.26);                 // 地面焦痕
    },
    ring: function (x, y, h, r, color) {
      this.add('ring', { x: x, y: y, h: h, r: r || 10, color: color || '#ffdca8' }, 0.34);
    },
    sparks: function (x, y, h, n, color) {
      this.add('sparks', { x: x, y: y, h: h, n: n || 6, color: color || '#ffc46a' }, 0.5);
    },
    scorch: function (x, y, r) {
      this.add('scorch', { x: x, y: y, r: r || 3.4 }, 6.0);
    },
    text: function (x, y, h, txt, color) { this.add('text', { x: x, y: y, h: h, txt: txt, color: color || '#fff' }, 0.85); },
    cone: function (x, y, a, range, half, color) { this.add('cone', { x: x, y: y, a: a, range: range, half: half, color: color }, 0.12); },
    chain: function (pts, color) { this.add('chain', { pts: pts, color: color }, 0.22); },
    shock: function (x, y, h, r, color) { this.add('shock', { x: x, y: y, h: h, r: r, color: color || '#ffd479' }, 0.45); },

    update: function (dt) {
      const L = this.list;
      for (let i = L.length - 1; i >= 0; i--) {
        L[i].t += dt;
        if (L[i].t >= L[i].dur) L.splice(i, 1);
      }
      this.shake = Math.max(0, this.shake - dt * 3.2);
      const s = this.shake * this.shake * 9;
      this.shakeX = (Math.random() - 0.5) * s;
      this.shakeY = (Math.random() - 0.5) * s;
    },

    draw: function (ctx, R) {
      const p = {}, q = {};
      ctx.save();
      ctx.lineCap = 'round';
      for (const f of this.list) {
        const k = f.t / f.dur, e = 1 - Math.pow(1 - k, 3), o = f.o;
        switch (f.kind) {
          case 'tracer': {
            R.P(o.x0, o.y0, o.h0, p); R.P(o.x1, o.y1, o.h1, q);
            ctx.globalAlpha = 1 - k;
            ctx.strokeStyle = o.color; ctx.lineWidth = o.w * (1 - k * 0.5);
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
            ctx.globalAlpha = (1 - k) * 0.5;
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = o.w * 0.4;
            ctx.stroke();
            break;
          }
          case 'flash': {
            R.P(o.x, o.y, o.h, p);
            ctx.globalAlpha = 1 - k;
            ctx.fillStyle = o.color;
            ctx.beginPath(); ctx.arc(p.x, p.y, o.r * (1 - k * 0.6) * Math.max(0.6, R.cam.zoom), 0, 6.2832); ctx.fill();
            break;
          }
          case 'ring': {
            R.P(o.x, o.y, o.h, p);
            const zz0 = Math.max(0.6, R.cam.zoom);
            ctx.globalAlpha = (1 - k) * 0.85;
            ctx.strokeStyle = o.color;
            ctx.lineWidth = Math.max(1.2, (1 - k) * 3.6 * Math.max(0.5, zz0 * 0.5));
            ctx.beginPath(); ctx.arc(p.x, p.y, o.r * zz0 * (0.25 + e * 1.15), 0, 6.2832); ctx.stroke();
            break;
          }
          case 'sparks': {
            R.P(o.x, o.y, o.h, p);
            const zz1 = Math.max(0.6, R.cam.zoom);
            ctx.globalAlpha = 1 - k * k;
            ctx.fillStyle = o.color;
            for (let i = 0; i < o.n; i++) {
              const a = i * 2.399 + (f.dur * 7 % 6.28);
              const sp = 0.45 + ((i * 37) % 100) / 110;
              const d = e * 30 * sp * zz1 * 0.5;
              const fall = e * e * 20 * zz1 * 0.5;
              ctx.beginPath();
              ctx.arc(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.6 + fall,
                Math.max(0.8, 1.7 * (1 - k) * zz1 * 0.5), 0, 6.2832);
              ctx.fill();
            }
            break;
          }
          case 'scorch': {
            R.P(o.x, o.y, 0, p);
            const zz2 = Math.max(0.5, R.cam.zoom);
            ctx.globalAlpha = Math.max(0, 1 - k) * 0.5;
            ctx.fillStyle = '#0d0b09';
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, o.r * zz2, o.r * zz2 * 0.42, 0, 0, 6.2832);
            ctx.fill();
            break;
          }
          case 'blood': {
            R.P(o.x, o.y, o.h, p);
            ctx.globalAlpha = (1 - k) * 0.7;
            ctx.fillStyle = o.color;
            for (let i = 0; i < 5; i++) {
              const a = i * 1.257 + (f.dur * 13 % 6.28);
              const d = (4 + e * 12) * Math.max(0.5, R.cam.zoom * 0.5);
              ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.7, Math.max(0.9, 1.5 * (1 - k) * R.cam.zoom), 0, 6.2832); ctx.fill();
            }
            break;
          }
          case 'boom': {
            R.P(o.x, o.y, o.h, p);
            const r = o.r * Math.max(0.8, R.cam.zoom) * (0.35 + e);
            ctx.globalAlpha = (1 - k) * 0.85;
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
            g.addColorStop(0, 'rgba(255,240,190,0.95)');
            g.addColorStop(0.45, 'rgba(255,140,50,0.55)');
            g.addColorStop(1, 'rgba(90,40,20,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832); ctx.fill();
            break;
          }
          case 'shock': {
            R.P(o.x, o.y, o.h, p);
            ctx.globalAlpha = 1 - k;
            ctx.strokeStyle = o.color; ctx.lineWidth = Math.max(1, 2.6 * (1 - k));
            ctx.beginPath(); ctx.arc(p.x, p.y, o.r * R.cam.zoom * (0.2 + e), 0, 6.2832); ctx.stroke();
            break;
          }
          case 'text': {
            R.P(o.x, o.y, o.h + 6 + e * 14, p);
            ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
            ctx.font = '700 ' + U.clamp(11 + R.cam.zoom * 3.5, 11, 18) + 'px "PingFang SC",sans-serif';
            ctx.textAlign = 'center';
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
            ctx.strokeText(o.txt, p.x, p.y); ctx.fillStyle = o.color; ctx.fillText(o.txt, p.x, p.y);
            break;
          }
          case 'cone': {
            const half = o.half, n = 10;
            ctx.globalAlpha = (1 - k) * 0.30;
            const g = ctx.createRadialGradient(
              R.P(o.x, o.y, 1.2, p).x, p.y, 0,
              p.x, p.y, o.range * R.cam.zoom);
            g.addColorStop(0, o.color); g.addColorStop(1, 'rgba(255,80,0,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            R.P(o.x, o.y, 1.2, p); ctx.moveTo(p.x, p.y);
            for (let i = 0; i <= n; i++) {
              const a = o.a - half + (half * 2 * i) / n;
              const x = o.x + Math.cos(a) * o.range, y = o.y + Math.sin(a) * o.range;
              R.P(x, y, 1.2, q); ctx.lineTo(q.x, q.y);
            }
            ctx.closePath(); ctx.fill();
            break;
          }
          case 'chain': {
            ctx.globalAlpha = 1 - k;
            ctx.strokeStyle = o.color; ctx.lineWidth = Math.max(1.4, 2.4 * R.cam.zoom * 0.7);
            ctx.beginPath();
            for (let i = 0; i < o.pts.length - 1; i++) {
              R.P(o.pts[i].x, o.pts[i].y, 2.4, p); R.P(o.pts[i + 1].x, o.pts[i + 1].y, 2.4, q);
              ctx.moveTo(p.x, p.y);
              // 锯齿闪电
              const mx = (p.x + q.x) / 2 + (Math.random() - 0.5) * 16, my = (p.y + q.y) / 2 + (Math.random() - 0.5) * 16;
              ctx.lineTo(mx, my); ctx.lineTo(q.x, q.y);
            }
            ctx.stroke();
            break;
          }
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  };
})(window.ZT);
