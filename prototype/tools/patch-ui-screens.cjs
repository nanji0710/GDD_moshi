const fs = require('fs');
const f = 'E:/github/sss/prototype/js/ui.js';
let lines = fs.readFileSync(f, 'utf8').split('\n');

// 1-based 行号：171 是 "// ---------------- 标题..." 注释行，262 是 "    // ---------------- 站台..."
const startIdx = 170;              // 0-based，指向注释行
const endIdx = 261;                // 0-based，指向站台注释行（不含）
const before = lines.slice(0, startIdx);
const after = lines.slice(endIdx);

const NEW = `    // ---------------- 开始界面 / 关卡地图 / 科技 ----------------
    showStart: function () {
      this.showHUD(false);
      const R_ = this.refs;
      R_.screen.innerHTML = '';
      R_.screen.classList.remove('hidden');
      const meta = Z.Meta;
      const sum = Z.Save && Z.Save.summary();
      const bigBtn = function (label, sub, fn, primary) {
        return h('button', { class: 'start-btn' + (primary ? ' primary' : ''), onclick: fn },
          h('b', null, label), sub ? h('span', { class: 'sub' }, sub) : null);
      };
      R_.screen.appendChild(h('div', { class: 'start-root' },
        h('div', { class: 'start-wrap' },
          h('h1', { class: 'start-title' }, '末世', h('span', { class: 'yu' }, '列'), '车'),
          h('div', { class: 'start-sub' }, '把难民送到安全点 · 车厢顶上装的是你唯一的火力'),
          h('div', { class: 'start-menu' },
            bigBtn('开始游戏', '选择关卡 · 从温州出发', function () { Z.UI.showLevels(); }, true),
            sum ? bigBtn('继续上一局', '第 ' + sum.level + ' 关 · ' + sum.city + ' · ' + sum.km + ' / ' + sum.total + ' km',
              function () { Z.Game.continueRun(); }) : null,
            bigBtn('科技', '里程点 ' + U.fmt(meta.points) + ' · 6 条强化线', function () { Z.UI.showTech(); })),
          h('div', { class: 'start-foot' }, 'v' + CFG.VERSION + ' · 零依赖 · MIT')));
    },

    showLevels: function () {
      this.showHUD(false);
      const R_ = this.refs;
      R_.screen.innerHTML = '';
      R_.screen.classList.remove('hidden');
      const map = Z.MapScreen.build({
        onPick: function (lv) { Z.Game.startLevel(lv); }
      });
      R_.screen.appendChild(h('div', { class: 'panel-map' },
        h('div', { class: 'map-head' },
          h('h2', null, '选择关卡'),
          h('div', { class: 'sub' }, '沿铁路向西 · 每一站都比上一站更远')),
        map,
        h('div', { class: 'map-legend' },
          h('i', { class: 'lg done' }), '已通关',
          h('i', { class: 'lg current' }), '当前',
          h('i', { class: 'lg locked' }), '未解锁'),
        h('div', { class: 'map-foot' },
          h('button', { class: 'btn', onclick: function () { Z.UI.showStart(); } }, '返回'),
          h('button', { class: 'btn primary', onclick: function () { Z.UI.showTech(); } }, '科技'))));
    },

    showTech: function () {
      this.showHUD(false);
      const R_ = this.refs;
      R_.screen.innerHTML = '';
      R_.screen.classList.remove('hidden');
      const meta = Z.Meta;
      const rows = meta.summary().map(function (row) {
        const m = CFG.META.find(function (x) { return x.key === row.key; });
        const btn = h('button', {
          class: 'btn sm' + (row.maxed ? '' : (meta.points >= row.cost ? ' primary' : '')),
          onclick: function () {
            if (meta.buy(row.key)) { Z.UI.toast(m.name + ' 升到 Lv' + meta.levels[row.key], 'good'); Z.UI.showTech(); }
            else Z.UI.toast('里程点不足（需要 ' + row.cost + '）', 'bad');
          }
        }, row.maxed ? '已满级' : '升级 · ' + row.cost);
        return h('div', { class: 'mrow' },
          h('div', { class: 'mrow-l' },
            h('b', null, m.name, m.milestone ? h('em', { class: 'milestone' }, 'Lv5 质变') : null),
            h('span', null, m.desc)),
          h('div', { class: 'mrow-r' },
            h('div', { class: 'pips' }, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (i) {
              return h('i', { class: 'pip' + (i < row.lv ? ' on' : '') + (i === 4 ? ' mark' : '') });
            })),
            h('span', { class: 'lv' }, 'Lv' + row.lv + '/10'), btn));
      });
      R_.screen.appendChild(h('div', { class: 'panel-tech' },
        h('h1', null, '科技'),
        h('div', { class: 'points' }, '里程点 ', h('b', null, U.fmt(meta.points))),
        h('div', { class: 'meta-grid' }, rows),
        this.skinRow(),
        h('div', { class: 'meta-foot' }, '6 条强化线全满需约 176 000 点；12 关全通一次约 82 000 点 —— 单周目不可能满级。每条线练到 Lv5 会解锁一次质变。'),
        h('div', { class: 'acts' },
          h('button', { class: 'btn', onclick: function () { Z.UI.showStart(); } }, '返回'),
          h('button', { class: 'btn primary', onclick: function () { Z.UI.showLevels(); } }, '开始游戏'))));
    },

    skinRow: function () {
      const meta = Z.Meta;
      const chips = CFG.SKINS.map(function (sk) {
        const owned = meta.ownsSkin(sk.key);
        const active = meta.skins.active === sk.key;
        return h('button', {
          class: 'skin' + (active ? ' on' : '') + (owned ? '' : ' locked'),
          onclick: function () {
            if (owned) { meta.setSkin(sk.key); Z.UI.toast('涂装：' + sk.name, 'good'); }
            else if (meta.buySkin(sk.key)) { Z.UI.toast('解锁涂装：' + sk.name, 'good'); }
            else { Z.UI.toast('里程点不足（需要 ' + sk.cost + '）', 'bad'); return; }
            Z.UI.showTech();
          }
        },
          h('i', { class: 'swatch', style: { background: sk.hull } }),
          h('b', null, sk.name),
          h('span', null, active ? '使用中' : (owned ? '点击使用' : sk.cost + ' 点')));
      });
      return h('div', { class: 'skins-wrap' }, h('div', { class: 'dw-sec' }, '列车涂装（只改车身，车顶类型色不变）'), h('div', { class: 'skins' }, chips));
    },

    continuePanel: function () {
      const sum = Z.Save && Z.Save.summary();
      if (!sum) return null;
      return h('div', { class: 'resume' },
        h('div', { class: 'resume-l' },
          h('b', null, '继续上一局'),
          h('span', null, '第 ' + sum.level + ' 关 · ' + sum.city + ' · ' + sum.km + ' / ' + sum.total + ' km'
            + (sum.mins > 0 ? ' · ' + sum.mins + ' 分钟前' : ''))),
        h('div', { class: 'resume-r' },
          h('button', { class: 'btn primary', onclick: function () { Z.Game.continueRun(); } }, '继续'),
          h('button', {
            class: 'btn sm ghost', onclick: function () {
              Z.Save.clear(); Z.UI.toast('已放弃存档', 'info'); Z.UI.showStart();
            }
          }, '放弃')));
    },

`;

lines = before.concat(NEW.split('\n')).concat(after);
fs.writeFileSync(f, lines.join('\n'));
console.log('ui screens rewritten');
