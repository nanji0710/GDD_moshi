'use strict';
// 关卡地图页：按真实经纬度把 12 关城市画在中国轮廓上，路线连成一条西行铁路。
window.ZT = window.ZT || {};
(function (Z) {
  const CFG = Z.CFG;
  const NS = 'http://www.w3.org/2000/svg';

  // 简化版中国轮廓（经度, 纬度），只求"一眼认得出是中国"
  const OUTLINE = [
    [74.0, 39.5], [75.2, 40.5], [80.0, 45.0], [82.5, 45.2], [85.0, 47.0], [87.5, 49.0],
    [90.5, 48.0], [95.0, 44.0], [96.5, 42.8], [100.0, 42.6], [105.0, 41.8], [110.0, 42.5],
    [111.5, 43.5], [115.0, 45.5], [117.5, 46.5], [119.5, 46.7], [120.0, 50.5], [122.5, 53.5],
    [127.5, 50.0], [130.6, 48.8], [134.7, 48.3], [133.0, 45.0], [131.0, 44.0], [130.5, 42.5],
    [128.0, 41.5], [124.0, 40.0], [121.5, 39.0], [118.5, 38.0], [120.8, 37.5], [122.7, 37.3],
    [120.3, 36.0], [119.0, 34.5], [121.5, 31.8], [121.5, 30.5], [120.5, 27.5], [119.5, 25.5],
    [117.5, 23.5], [114.5, 22.5], [113.5, 22.0], [110.5, 21.0], [110.0, 20.0], [108.5, 21.5],
    [106.5, 22.0], [104.0, 22.5], [101.8, 21.2], [99.5, 22.0], [97.5, 24.0], [98.5, 27.5],
    [97.5, 28.5], [95.0, 29.0], [92.0, 27.8], [88.5, 27.3], [85.0, 28.3], [81.0, 30.3],
    [78.5, 31.5], [78.0, 35.0], [75.0, 37.0]
  ];

  // 标签偏移（dx, dy, anchor）：几个城市在地图上挨得太近，手工错开
  const LBL = {
    1: [11, 4, 'start'], 2: [11, 2, 'start'], 3: [-10, 16, 'end'], 4: [11, -4, 'start'],
    5: [-11, -3, 'end'], 6: [11, 9, 'start'], 7: [-11, 4, 'end'], 8: [-11, 2, 'end'],
    9: [-11, -6, 'end'], 10: [-11, 2, 'end'], 11: [11, -6, 'start'], 12: [11, -3, 'start']
  };

  const KX = Math.cos(35 * Math.PI / 180);
  const S = 11;                        // 缩放：1 度 ≈ 11 单位
  function proj(lon, lat) { return { x: (lon - 73) * KX * S, y: (55 - lat) * S }; }

  function svg(tag, attrs, kids) {
    const el = document.createElementNS(NS, tag);
    for (const k in (attrs || {})) el.setAttribute(k, attrs[k]);
    (kids || []).forEach(function (c) { el.appendChild(c); });
    return el;
  }

  const Map = Z.MapScreen = {
    build: function (opts) {
      opts = opts || {};
      const meta = Z.Meta;
      const levels = CFG.LEVELS;
      const unlockedTo = Math.max(1, meta.selectedLevel || 1);
      const pad = 26;
      const pts = OUTLINE.map(function (p) { return proj(p[0], p[1]); });
      let maxX = 0, maxY = 0;
      for (const p of pts) { if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
      const W = maxX + pad * 2, H = maxY + pad * 2;

      const root = svg('svg', {
        class: 'china-map', viewBox: '0 0 ' + W + ' ' + H,
        preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': '关卡地图'
      });

      // 海面底
      root.appendChild(svg('rect', { x: 0, y: 0, width: W, height: H, class: 'map-sea' }));
      // 国境
      root.appendChild(svg('polygon', {
        points: pts.map(function (p) { return (p.x + pad) + ',' + (p.y + pad); }).join(' '),
        class: 'map-land'
      }));

      // 路线：按关卡顺序连；跨度大的区段画成虚线（"绕行段"）
      const nodes = levels.map(function (L, i) {
        const p = proj(L.lon, L.lat);
        return { i: i, L: L, x: p.x + pad, y: p.y + pad };
      });
      for (let k = 0; k < nodes.length - 1; k++) {
        const a = nodes[k], b = nodes[k + 1];
        const dist = Math.hypot(b.L.lon - a.L.lon, b.L.lat - a.L.lat);
        root.appendChild(svg('line', {
          x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          class: 'map-route' + (dist > 7 ? ' detour' : '')
        }));
      }

      // 城市节点
      const g = svg('g', { class: 'map-cities' });
      nodes.forEach(function (n) {
        const done = n.L.n < unlockedTo;
        const open = n.L.n <= unlockedTo;
        const cls = 'map-city' + (done ? ' done' : '') + (open ? '' : ' locked') + (n.L.n === unlockedTo ? ' current' : '');
        const node = svg('g', { class: cls, 'data-level': n.L.n });
        node.appendChild(svg('circle', { cx: n.x, cy: n.y, r: 7.5, class: 'mc-dot' }));
        if (n.L.n === unlockedTo) node.appendChild(svg('circle', { cx: n.x, cy: n.y, r: 13, class: 'mc-ring' }));
        const lb = LBL[n.L.n] || [11, 4, 'start'];
        const tx = svg('text', {
          x: n.x + lb[0], y: n.y + lb[1], class: 'mc-name',
          'text-anchor': lb[2] === 'end' ? 'end' : 'start'
        });
        tx.textContent = n.L.city;
        node.appendChild(tx);
        const num = svg('text', { x: n.x, y: n.y + 3.2, class: 'mc-num' });
        num.textContent = String(n.L.n);
        node.appendChild(num);
        if (opts.onPick) {
          node.appendChild(svg('title', {}, [])).textContent = n.L.city + ' · 第 ' + n.L.n + ' 关';
          node.addEventListener('click', function () {
            if (!open) { if (Z.UI) Z.UI.toast('先通关第 ' + (unlockedTo) + ' 关解锁', 'bad'); return; }
            opts.onPick(n.L.n);
          });
        }
        g.appendChild(node);
      });
      root.appendChild(g);
      return root;
    }
  };
})(window.ZT);
