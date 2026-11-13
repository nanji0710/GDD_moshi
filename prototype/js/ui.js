'use strict';
// 界面：标题/关卡选择、局外成长、HUD、站台、车厢三选一、改装、结算。
window.ZT = window.ZT || {};
(function (Z) {
  const U = Z.U, CFG = Z.CFG, h = U.h;
  const UI = Z.UI = {
    run: null, root: null, refs: {}, drawer: null, drawerState: null,
    dragAcc: 0,

    init: function (run) {
      this.run = run;
      this.root = document.getElementById('ui');
      this.root.innerHTML = '';
      this.buildHUD();
      this.refs.drawer = h('aside', { class: 'drawer hidden' });
      this.root.appendChild(this.refs.drawer);
      this.refs.toasts = h('div', { class: 'toasts' });
      this.root.appendChild(this.refs.toasts);
      this.refs.screen = h('div', { class: 'screen hidden' });
      this.root.appendChild(this.refs.screen);
      // 站台期间常驻的"回到站台"按钮：关掉面板也不会被困住
      this.refs.fab = h('button', {
        class: 'fab hidden',
        onclick: function () { if (Z.Run.station) Z.UI.openStation(Z.Run.station); }
      }, '回到站台');
      this.root.appendChild(this.refs.fab);
    },

    // ---------------- HUD ----------------
    buildHUD: function () {
      const R_ = this.refs;
      const top = h('div', { class: 'hud top' },
        h('div', { class: 'brand' }, h('b', null, '末世列车'), R_.lvl = h('span', null, '第 1 关'),
          R_.mods = h('em', { class: 'modchip' }, ''), R_.goal = h('em', { class: 'goalchip' }, '')),
        h('div', { class: 'route' },
          h('div', { class: 'route-track' }, R_.fill = h('i', { class: 'route-fill' })),
          h('div', { class: 'route-marks' }),
          R_.routeNow = h('div', { class: 'route-now' }, '—')),
        h('div', { class: 'stats' },
          this.stat('废料', R_.scrap = h('b', null, '0')),
          !CFG.ECON.infiniteAmmo && this.stat('弹药', R_.ammo = h('b', null, '0')),
          !CFG.ECON.infiniteFuel && this.stat('燃料', R_.fuel = h('b', null, '100%')),
          this.stat('耐久', R_.hp = h('b', null, '100%')),
          this.stat('难民', R_.ref = h('b', null, '0')),
          this.stat('车速', R_.spd = h('b', null, '0'))),
        h('div', { class: 'ctrls' },
          R_.pause = h('button', { class: 'btn sm', onclick: function () { Z.Game.togglePause(); } }, '暂停'),
          h('div', { class: 'speeds' }, [1, 2, 3].map(function (n) {
            const b = h('button', { class: 'btn sm', onclick: function () { Z.Game.setSpeed(n); } }, n + '×');
            (R_.speedBtns = R_.speedBtns || []).push(b);
            return b;
          })),
          h('button', { class: 'btn sm', onclick: function () { Z.UI.toggleRefit(); } }, '改装', h('kbd', null, 'Tab')),
          R_.snd = h('button', {
            class: 'btn sm' + (Z.Sound && Z.Sound.enabled ? ' on' : ''),
            onclick: function () {
              const on = Z.Sound.toggle();
              R_.snd.classList.toggle('on', on);
              R_.snd.textContent = on ? '音效' : '静音';
            }
          }, Z.Sound && Z.Sound.enabled ? '音效' : '静音')));
      this.root.appendChild(top);
      // 站点标记
      const marks = top.querySelector('.route-marks');
      const world = Z.World;
      for (const st of world.stations) {
        const el = h('i', { class: 'route-mark' + (st.final ? ' final' : '') });
        el.style.left = (st.s / world.path.len * 100) + '%';
        marks.appendChild(el);
      }
      // 技能条
      const bar = h('div', { class: 'hud skillsbar' });
      R_.skillBtns = [];
      for (const s of CFG.SKILLS) {
        const b = h('button', { class: 'skill', onclick: (function (k) { return function () { Z.Skills.activate(Z.Run, k); }; })(s.key) },
          h('span', { class: 'sk-key' }, s.key2), h('span', { class: 'sk-name' }, s.name), h('i', { class: 'sk-cd' }));
        R_.skillBtns.push({ def: s, el: b, cd: b.querySelector('.sk-cd') });
        bar.appendChild(b);
      }
      this.root.appendChild(bar);
      // 车厢条
      R_.carStrip = h('div', { class: 'hud carbar' });
      this.root.appendChild(R_.carStrip);
    },
    stat: function (label, val) { return h('div', { class: 'stat' }, h('span', null, label), val); },

    showHUD: function (on) {
      for (const el of this.root.querySelectorAll('.hud')) el.classList.toggle('hidden', !on);
    },

    // ---------------- 每帧刷新 ----------------
    tick: function (dt) {
      const run = this.run, R_ = this.refs;
      if (!run || !R_.fill) return;
      const lvl = run.levelDef || CFG.LEVELS[0];
      R_.lvl.textContent = '第 ' + run.level + ' 关 · ' + (lvl.city || '');
      const MODNAME = { night: '夜战', tunnel: '隧道', rain: '雨战', bridge: '铁桥', straight: '长直道', canyon: '连续弯道' };
      const mods = run.mods || [];
      R_.mods.textContent = mods.length ? mods.map(function (m) { return MODNAME[m] || m; }).join(' · ') : '';
      R_.mods.style.display = mods.length ? '' : 'none';
      R_.fill.style.width = U.clamp(run.km / run.totalKm, 0, 1) * 100 + '%';
      const nx = Z.World.stations[run.stationIdx + 1];
      R_.routeNow.textContent = (run.km / 1000).toFixed(2) + ' / ' + (run.totalKm / 1000).toFixed(1) + ' km'
        + (nx ? ' · 下一站 ' + (nx.km).toFixed(1) + ' km' : '');
      // 关卡目标
      if (R_.goal) {
        const g = run.goal || { type: 'reach' };
        let txt = '';
        if (g.type === 'escort') {
          let cargo = null;
          for (const c of run.cars) if (c.type === 'cargo') cargo = c;
          const pct = cargo ? Math.round(cargo.hp / cargo.maxHp * 100) : 0;
          txt = '护送 · 货柜 ' + (cargo && !cargo.dead ? pct + '%' : '已损毁');
        } else if (g.type === 'sprint') {
          const kmh = Math.round(run.speed * 3.6);
          const over = run.sprintT > 0.2 ? ' ⚠' + run.sprintT.toFixed(1) : '';
          txt = '限速 · ' + kmh + '/' + (g.minKmh || 80) + over;
        } else if (run.state === 'hold') {
          txt = '守站 · ' + Math.max(0, Math.ceil(run.holdT)) + 's';
        }
        if (R_.goal.textContent !== txt) {
          R_.goal.classList.remove('pulse'); void R_.goal.offsetWidth; R_.goal.classList.add('pulse');
        }
        R_.goal.textContent = txt;
        R_.goal.classList.toggle('hidden', !txt);
        R_.goal.classList.toggle('danger', !!(g.type === 'sprint' && run.sprintT > 0.2));
      }
      R_.scrap.textContent = U.fmt(run.scrap);
      if (R_.ammo) R_.ammo.textContent = U.fmt(run.ammo);
      if (R_.fuel) R_.fuel.textContent = Math.round(run.fuel) + '%';
      if (R_.fuel) R_.fuel.className = run.fuel < 25 ? 'bad' : (run.fuel < 50 ? 'warn' : '');
      const hpFrac = run.maxHp() ? run.totalHp() / run.maxHp() : 0;
      R_.hp.textContent = Math.round(hpFrac * 100) + '%';
      R_.hp.className = hpFrac < 0.35 ? 'bad' : (hpFrac < 0.65 ? 'warn' : '');
      // 耐久明显下降时闪一下，战斗里不看数字也能察觉
      if (this._prevHp == null) this._prevHp = hpFrac;
      if (hpFrac < this._prevHp - 0.008) {
        R_.hp.classList.remove('pulse'); void R_.hp.offsetWidth; R_.hp.classList.add('pulse');
      }
      this._prevHp = hpFrac;
      R_.ref.textContent = run.refugees() + '/' + run.capacity();
      R_.spd.textContent = run.speed < 0.3 ? '停转' : (Math.round(run.speed * 3.6) + ' km/h');
      R_.spd.className = run.speed < 0.3 ? 'bad' : (run.speed < run.speedCap() * 0.5 ? 'warn' : '');
      R_.pause.textContent = Z.Game.paused ? '继续' : '暂停';
      (R_.speedBtns || []).forEach(function (b, i) { b.classList.toggle('on', !Z.Game.paused && Z.Game.speedMul === i + 1); });
      for (const it of R_.skillBtns || []) {
        const owned = run.skills.owned.indexOf(it.def.key) >= 0;
        const cd = run.skills.cd[it.def.key] || 0;
        const active = (run.skills.active[it.def.key] || 0) > 0;
        it.el.style.display = owned ? '' : 'none';
        it.el.classList.toggle('on', active);
        it.el.classList.toggle('off', cd > 0 && !active);
        it.cd.style.height = (cd > 0 ? Math.min(100, cd / (it.def.cd + it.def.dur) * 100) : 0) + '%';
        it.el.style.setProperty('--sk', it.def.color);
      }
      const atStation = run.state === 'station';
      if (this.refs.fab) this.refs.fab.classList.toggle('hidden', !atStation || this.drawerState === 'station');
      this.renderCarStrip();
      if (this.drawerState === 'station') this.tickStation();
      if (this.drawerState === 'refit') this.tickRefit();
    },
    refreshSpeeds: function () { this.tick(0); },

    renderCarStrip: function () {
      const run = this.run, strip = this.refs.carStrip;
      const n = run.cars.length;
      const wc = run.weaponCount();
      if (this._stripN !== n || this._stripWeapons !== wc) {
        this._stripN = n; this._stripWeapons = wc;
        strip.innerHTML = '';
        this._cars = [];
        for (let k = 0; k < n; k++) {
          const car = run.cars[k], t = CFG.CAR_TYPES[car.type];
          const bar = h('i', { style: { width: '100%' } });
          const hp = h('div', { class: 'cc-hp' }, '100%');
          const refEl = h('div', { class: 'cc-ref' }, '');
          const card = h('div', {
            class: 'ccard', onclick: (function (kk) { return function () { Z.UI.openRefit(kk); }; })(k)
          },
            h('div', { class: 'cc-name' }, h('i', { class: 'cc-type', style: { background: t.color } }), t.name),
            h('div', { class: 'cc-slots' }, car.slots.map(function (w) {
              return h('i', { class: 'slotp' + (w ? ' has' : ''), style: { background: w ? w.def().color : '' } });
            })),
            h('div', { class: 'cc-bar' }, bar),
            hp, refEl);
          strip.appendChild(card);
          this._cars.push({ card: card, bar: bar, hp: hp, ref: refEl });
        }
      }
      for (let k = 0; k < n; k++) {
        const car = run.cars[k], ref = this._cars[k];
        if (!ref) continue;
        const frac = car.dead ? 0 : car.hp / car.maxHp;
        ref.bar.style.width = Math.max(0, frac) * 100 + '%';
        ref.bar.className = frac < 0.35 ? 'bad' : (frac < 0.65 ? 'warn' : '');
        ref.hp.textContent = car.dead ? '损毁' : Math.round(frac * 100) + '%';
        ref.card.classList.toggle('dead', car.dead);
        ref.card.classList.toggle('flash', car.flash > 0.4);
        if (car.type === 'passenger') ref.ref.textContent = '难民 ' + car.refugees;
        // 受击车厢自动滚进视野
        if (car.flash > 0.4 && this._scrollTo !== k) {
          this._scrollTo = k;
          try { strip.scrollTo({ left: Math.max(0, ref.card.offsetLeft - 60), behavior: 'smooth' }); } catch (e) {}
        }
      }
    },

    // ---------------- 标题 / 关卡选择 / 局外 ----------------
    // ---------------- 开始界面 / 关卡地图 / 科技 ----------------
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
            bigBtn('无尽模式', (function () {
              const b = Z.Save && Z.Save.endlessBest ? Z.Save.endlessBest() : null;
              return b ? ('最佳 ' + b.km.toFixed(1) + ' km · 开多远算多远') : '开多远算多远 · 车厢无上限';
            })(), function () { Z.Game.startEndless(); }),
            bigBtn('科技', '里程点 ' + U.fmt(meta.points) + ' · 6 条强化线', function () { Z.UI.showTech(); }),
            bigBtn('设置', '音效 · 镜头 · 重看教学 · 清存档', function () { Z.UI.showSettings(); }),
            bigBtn('3D 模型', 'GLB 资产预览 · 机车 / 货车 / 武器 / 丧尸 / 建筑', function () { Z.View3D.open(); })),
          h('div', { class: 'start-foot' }, 'v' + CFG.VERSION + ' · 零依赖 · MIT'))));
    },

    showLevels: function (justLevel) {
      this.showHUD(false);
      const R_ = this.refs;
      R_.screen.innerHTML = '';
      R_.screen.classList.remove('hidden');
      const total = CFG.LEVELS.length;
      const unlocked = Math.max(1, Z.Meta.selectedLevel || 1);
      const cleared = Math.min(total, unlocked - 1);
      const MODNAME = { night: '夜战', tunnel: '隧道', rain: '雨战', bridge: '铁桥', straight: '长直道', canyon: '连续弯道' };

      const card = h('div', { class: 'map-card hidden' });
      const showCard = function (lv) {
        const L = CFG.LEVELS[lv - 1];
        if (!L) return;
        const best = (Z.Save && Z.Save.best) ? Z.Save.best(lv) : null;
        const pal = (CFG.PAL[L.biome] || {}).name || '—';
        const mods = (L.mods || []).map(function (m) { return MODNAME[m] || m; }).join(' · ');
        card.innerHTML = '';
        card.appendChild(h('div', { class: 'mc-head' },
          h('b', null, '第 ' + lv + ' 关 · ' + L.city),
          h('span', null, L.km.toFixed(1) + ' km')));
        card.appendChild(h('div', { class: 'mc-row' }, '招牌：' + (L.tag || '—')));
        // 关卡目标
        const g = L.goal || { type: 'reach' };
        const gTxt = g.type === 'escort' ? '护送 · 车尾货柜不能损毁'
          : g.type === 'sprint' ? '限速 · 低于 ' + (g.minKmh || 80) + ' km/h 累计 ' + (g.grace || 6) + ' 秒即失败'
            : g.type === 'hold' ? '守站 · 终点倒计时 ' + (g.sec || 60) + ' 秒'
              : '抵达 · 开到线路终点';
        card.appendChild(h('div', { class: 'mc-row goal' }, '目标：' + gTxt));
        // 难度：按密度与精英概率给星
        const diff = Math.min(5, Math.max(1, Math.round((L.dens - 80) / 30) + 1));
        card.appendChild(h('div', { class: 'mc-row' }, '强度：' + '◆'.repeat(diff) + '◇'.repeat(5 - diff)));
        card.appendChild(h('div', { class: 'mc-row' }, '地貌：' + pal + (mods ? ' · ' + mods : '')));
        card.appendChild(h('div', { class: 'mc-row' },
          best ? ('本关最佳 ' + U.fmt(best.points) + ' · 评价 ' + (best.grade || '—')) : '还没通关'));
        card.appendChild(h('div', { class: 'mc-acts' },
          h('button', { class: 'btn primary', onclick: function () { Z.Game.startLevel(lv); } }, '出发'),
          h('button', { class: 'btn ghost', onclick: function () { card.classList.add('hidden'); } }, '关闭')));
        card.classList.remove('hidden');
      };

      const map = Z.MapScreen.build({ justLevel: justLevel || 0, onPick: showCard });
      R_.screen.appendChild(h('div', { class: 'panel-map' },
        h('div', { class: 'map-head' },
          h('h2', null, '选择关卡'),
          h('div', { class: 'sub' }, '沿铁路向西 · 每一站都比上一站更远'),
          h('div', { class: 'map-progress' },
            h('div', { class: 'map-bar' }, h('i', { style: { width: (cleared / total * 100) + '%' } })),
            h('span', null, '已通关 ' + cleared + ' / ' + total))),
        map,
        card,
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
            const before = meta.levels[row.key];
            if (meta.buy(row.key)) {
              const lv = meta.levels[row.key];
              if (before < 5 && lv >= 5 && m.ms) Z.UI.toast('质变解锁：' + m.ms, 'good');
              else Z.UI.toast(m.name + ' 升到 Lv' + lv, 'good');
              Z.UI.showTech();
            } else Z.UI.toast('里程点不足（需要 ' + row.cost + '）', 'bad');
          }
        }, row.maxed ? '已满级' : '升级 · ' + row.cost);
        const BR = CFG.BRANCH && CFG.BRANCH[row.key];
        const chosen = meta.branch && meta.branch[row.key];
        let branchRow = null;
        if (BR) {
          if (chosen) {
            branchRow = h('div', { class: 'branch on' },
              h('b', null, '专精 · ' + BR[chosen].name), h('span', null, BR[chosen].desc));
          } else if (meta.canBranch(row.key)) {
            branchRow = h('div', { class: 'branch' },
              h('span', { class: 'bq' }, 'Lv5 专精（二选一，不可回退）：'),
              h('button', {
                class: 'btn sm primary', title: BR.A.desc,
                onclick: function () {
                  meta.chooseBranch(row.key, 'A');
                  Z.UI.toast('专精：' + BR.A.name, 'good');
                  Z.UI.showTech();
                }
              }, BR.A.name),
              h('button', {
                class: 'btn sm', title: BR.B.desc,
                onclick: function () {
                  meta.chooseBranch(row.key, 'B');
                  Z.UI.toast('专精：' + BR.B.name, 'good');
                  Z.UI.showTech();
                }
              }, BR.B.name));
          }
        }
        return h('div', { class: 'mrow' },
          h('div', { class: 'mrow-l' },
            h('b', null, m.name, m.ms ? h('em', { class: 'milestone' }, 'Lv5') : null),
            h('span', null, m.desc),
            m.ms ? h('span', { class: 'ms' }, m.ms) : null),
          h('div', { class: 'mrow-r' },
            h('div', { class: 'pips' }, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (i) {
              return h('i', { class: 'pip' + (i < row.lv ? ' on' : '') + (i === 4 ? ' mark' : '') });
            })),
            h('span', { class: 'lv' }, 'Lv' + row.lv + '/10'), btn),
          branchRow);
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

    showSettings: function () {
      this.showHUD(false);
      const R_ = this.refs;
      R_.screen.innerHTML = '';
      R_.screen.classList.remove('hidden');
      const S = Z.Settings;
      const on = function (k) { return S.data[k] !== false; };
      const toggle = function (label, key, onText, offText) {
        const val = on(key);
        return h('div', { class: 'set-row' },
          h('span', null, label),
          h('button', {
            class: 'btn sm' + (val ? ' primary' : ''),
            onclick: function () { S.set(key, !on(key)); Z.UI.showSettings(); }
          }, val ? (onText || '开') : (offText || '关')));
      };
      const vol = h('input', {
        type: 'range', min: '0', max: '100', class: 'set-range',
        value: String(Math.round((S.data.volume || 0) * 100)),
        oninput: function (e) { S.set('volume', (+e.target.value) / 100); }
      });

      R_.screen.appendChild(h('div', { class: 'panel-tech panel-settings' },
        h('h1', null, '设置'),
        h('div', { class: 'set-list' },
          toggle('音效', 'sound'),
          h('div', { class: 'set-row' }, h('span', null, '音量'), vol),
          toggle('镜头跟随列车', 'follow'),
          toggle('2.5D 斜视角', 'tilt', '开', '平铺'),
          h('div', { class: 'set-sep' }),
          h('div', { class: 'set-row' },
            h('span', null, '新手提示'),
            h('button', {
              class: 'btn sm', onclick: function () {
                Z.Tips.reset(); Z.UI.toast('新手提示已重置，下次进入会重新出现', 'good');
              }
            }, '重看')),
          h('div', { class: 'set-row' },
            h('span', null, '局内存档'),
            h('button', {
              class: 'btn sm ghost', onclick: function () {
                Z.Settings.clearRun(); Z.UI.toast('已清除局内存档', 'info');
              }
            }, '清除')),
          h('div', { class: 'set-row' },
            h('span', null, '全部进度'),
            h('button', {
              class: 'btn sm danger', onclick: function () {
                if (!Z.UI._confirmClear) {
                  Z.UI._confirmClear = true;
                  Z.UI.toast('再点一次确认清除全部进度', 'bad');
                  setTimeout(function () { Z.UI._confirmClear = false; }, 4000);
                  return;
                }
                Z.UI._confirmClear = false;
                Z.Settings.clearAll();
                Z.UI.toast('全部进度已清除', 'bad');
                Z.UI.showStart();
              }
            }, '清除'))),
        h('div', { class: 'set-foot' }, 'v' + CFG.VERSION + ' · 零依赖 · MIT · 游戏内按 M 也可静音'),
        h('div', { class: 'acts' },
          h('button', { class: 'btn', onclick: function () { Z.UI.showStart(); } }, '返回'),
          h('button', { class: 'btn primary', onclick: function () { Z.UI.showLevels(); } }, '开始游戏'))));
    },

    // 站台整备视图：一屏看完整列车，直接点/调序
    depotStrip: function (run) {
      const self = this;
      let dps = 0;
      for (const c of run.cars) {
        if (c.dead) continue;
        for (const w of c.slots) if (w) dps += w.dps();
      }
      const speedKmh = Math.round((run.speedCap ? run.speedCap() : 0) * 3.6);
      const row = h('div', { class: 'depot-row' });
      run.cars.forEach(function (c, idx) {
        const t = CFG.CAR_TYPES[c.type];
        const pct = c.dead ? 0 : Math.max(0, Math.min(100, Math.round(c.hp / c.maxHp * 100)));
        const main = h('div', {
          class: 'dcard' + (c.dead ? ' dead' : '') + (idx === 0 ? ' head' : ''),
          onclick: function () { self.openRefit(idx); },
          title: t.name + ' · 点开改装'
        },
          h('div', { class: 'dc-top' }, h('span', null, idx === 0 ? '车头' : '#' + (idx + 1)), h('b', null, t.name)),
          h('div', { class: 'dc-bar' }, h('i', { style: { width: pct + '%' } })),
          h('div', { class: 'dc-slots' }, (function () {
            const out = [];
            for (let si = 0; si < c.slots.length; si++) {
              const w = c.slots[si];
              out.push(h('i', {
                class: 'dc-slot' + (w ? ' on' : ''),
                style: w ? { background: w.def().color } : null,
                title: w ? (w.def().name + ' Lv' + w.level + (w.form ? ' 形态' + w.form : '')) : '空槽'
              }));
            }
            return out;
          })()),
          h('div', { class: 'dc-num' }, c.dead ? '损毁' : pct + '%'),
          (t.armor || t.repairAura) ? h('div', { class: 'dc-badge' }, t.armor ? '装甲' : ('修理 +' + t.repairAura)) : null
        );
        const mv = h('div', { class: 'dc-mv' },
          h('button', {
            class: 'mv', title: '往前挪', onclick: function (e) {
              e.stopPropagation();
              if (run.moveCar(idx, -1)) Z.UI.renderStation();
            }
          }, '◀'),
          h('button', {
            class: 'mv', title: '往后挪', onclick: function (e) {
              e.stopPropagation();
              if (run.moveCar(idx, 1)) Z.UI.renderStation();
            }
          }, '▶'));
        const cell = h('div', { class: 'dcell' }, main, mv);
        if (idx > 0) {
          cell.appendChild(h('button', {
            class: 'dc-x', title: '丢弃这节', onclick: function (e) {
              e.stopPropagation();
              if (run.cars.length <= 2) return Z.UI.toast('至少要留车头和 1 节', 'bad');
              if (run.discardCar(idx)) { run.offer = null; Z.UI.renderStation(); }
            }
          }, '✕'));
        }
        row.appendChild(cell);
      });

      return h('div', { class: 'depot' },
        h('div', { class: 'dw-sec' }, '编组 · ' + run.cars.length + ' 节'),
        row,
        h('div', { class: 'depot-sum' },
          '极速 ', h('b', null, speedKmh), ' km/h · 火力 ', h('b', null, Math.round(dps)), ' dps · 点车厢改装，◀ ▶ 调序'));
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



    // ---------------- 站台 ----------------
    openStation: function (st) {
      this.drawerState = 'station';
      this.renderStation();
      this.refs.drawer.classList.remove('hidden');
    },
    renderStation: function () {
      const run = this.run, R_ = this.refs, box = R_.drawer;
      const st = run.station || { idx: 0, isStart: true };
      box.innerHTML = '';
      box.appendChild(h('div', { class: 'dw-head' },
        h('div', null, h('b', null, st.isStart ? '出发站' : '第 ' + (st.idx + 1) + ' 站'), h('div', { class: 'sub' }, '站台停靠中 · 游戏已暂停 · 点「继续出发」才开')),
        h('button', { class: 'btn sm ghost', onclick: function () { Z.UI.depart(); } }, '出发')));

      // 总体
      box.appendChild(h('div', { class: 'kv wide' },
        h('span', null, '废料 ' + U.fmt(run.scrap)),
        h('span', null, '弹药 ' + U.fmt(run.ammo)),
        h('span', null, '燃料 ' + Math.round(run.fuel) + '%'),
        h('span', null, '难民 ' + run.refugees() + '/' + run.capacity())));

      box.appendChild(this.depotStrip(run));

      // 补给
      const unlimited = CFG.ECON.infiniteAmmo && CFG.ECON.infiniteFuel;
      box.appendChild(h('div', { class: 'dw-sec' }, unlimited ? '维修与救助' : '补给'));
      const shop = h('div', { class: 'shop' });
      if (!unlimited) {
        shop.appendChild(this.shopRow('一键补给（弹药+燃料补满）', '按量计', function () {
          const needAmmo = Math.max(0, 6000 - run.ammo);
          const packs = Math.ceil(needAmmo / CFG.ECON.ammoBuy.size);
          const fuelPacks = Math.ceil(Math.max(0, 100 - run.fuel) / CFG.ECON.fuelBuy.size);
          const cost = packs * CFG.ECON.ammoBuy.cost + fuelPacks * CFG.ECON.fuelBuy.cost;
          if (run.scrap < cost) { Z.UI.toast('废料不足：需要 ' + cost, 'bad'); return; }
          run.scrap -= cost; run.ammo = 6000; run.fuel = 100;
          Z.UI.toast('补给完成（-' + cost + '）', 'good'); Z.UI.renderStation();
        }));
        shop.appendChild(this.shopRow('弹药 +' + CFG.ECON.ammoBuy.size, CFG.ECON.ammoBuy.cost, function () {
          if (run.scrap < CFG.ECON.ammoBuy.cost) return Z.UI.toast('废料不足', 'bad');
          run.scrap -= CFG.ECON.ammoBuy.cost; run.ammo += CFG.ECON.ammoBuy.size;
          Z.UI.renderStation();
        }));
        shop.appendChild(this.shopRow('燃料 +' + CFG.ECON.fuelBuy.size + '%', CFG.ECON.fuelBuy.cost, function () {
          if (run.scrap < CFG.ECON.fuelBuy.cost) return Z.UI.toast('废料不足', 'bad');
          if (run.fuel >= 100) return Z.UI.toast('油箱已满', 'info');
          run.scrap -= CFG.ECON.fuelBuy.cost; run.fuel = Math.min(100, run.fuel + CFG.ECON.fuelBuy.size);
          Z.UI.renderStation();
        }));
      }
      shop.appendChild(this.shopRow('整车维修', '按耐久', function () {
        let need = 0;
        for (const c of run.cars) if (!c.dead) need += c.maxHp - c.hp;
        const cost = Math.round(need * CFG.ECON.repairCostPerHp);
        if (cost <= 0) return Z.UI.toast('车体完好', 'info');
        if (run.scrap < cost) return Z.UI.toast('废料不足：' + cost, 'bad');
        run.scrap -= cost;
        for (const c of run.cars) if (!c.dead) { c.hp = c.maxHp; c.tier = 0; }
        Z.UI.toast('整车已修复（-' + cost + '）', 'good'); Z.UI.renderStation();
      }));
      const rescueN = run.passengerCars().filter(function (c) { return c.hp / c.maxHp >= 0.4 && c.refugees < CFG.REFUGEE.perCar; }).length;
      shop.appendChild(this.shopRow('抢救难民（每车 +3）', '免费', function () {
        const n = run.rescue();
        Z.UI.toast(n ? '抢救回 ' + n + ' 人' : '没有可抢救的车厢', n ? 'good' : 'info');
        Z.UI.renderStation();
      }));
      box.appendChild(shop);

      // Buff
      box.appendChild(h('div', { class: 'dw-sec' }, '本关增益'));
      const buffs = h('div', { class: 'shop' });
      for (const k in CFG.BUFFS) {
        const b = CFG.BUFFS[k];
        buffs.appendChild(this.shopRow(b.name + ' · ' + b.desc, b.cost, function () {
          if (run.buffs[k]) return Z.UI.toast('已购买', 'info');
          if (run.scrap < b.cost) return Z.UI.toast('废料不足', 'bad');
          run.scrap -= b.cost; run.buffs[k] = true;
          Z.UI.toast('获得 ' + b.name, 'good'); Z.UI.renderStation();
        }, run.buffs[k]));
      }
      box.appendChild(buffs);

      // 难民
      box.appendChild(h('div', { class: 'dw-sec' }, '难民'));
      const boardPct = run.capacity() ? run.refugees() / run.capacity() : 0;
      box.appendChild(h('div', { class: 'board' },
        h('div', { class: 'board-bar' }, h('i', { style: { width: boardPct * 100 + '%' } })),
        h('div', { class: 'sub' }, '自动上车中：' + run.refugees() + ' / ' + run.capacity()
          + (run.capacity() ? '' : '（需要人员车厢）') + ' · 每 0.5 秒 1 人')));

      // 车厢

      box.appendChild(h('div', { class: 'dw-sticky' }, h('button', { class: 'btn primary big', onclick: function () { Z.UI.depart(); } }, '继续出发 →')));
    },
    shopRow: function (label, price, fn, done) {
      return h('button', { class: 'shop-item' + (done ? ' done' : ''), onclick: fn },
        h('b', null, label), h('span', null, done ? '已购买' : price));
    },
    tickStation: function () {
      // 上车进度每帧刷新（不重建 DOM）
      const bar = this.refs.drawer.querySelector('.board-bar i');
      if (bar) {
        const run = this.run;
        bar.style.width = (run.capacity() ? run.refugees() / run.capacity() * 100 : 0) + '%';
        const label = this.refs.drawer.querySelector('.board .sub');
        if (label) label.textContent = '自动上车中：' + run.refugees() + ' / ' + run.capacity() + (run.capacity() ? '' : '（需要人员车厢）') + ' · 每 0.5 秒 1 人';
      }
    },
    depart: function () {
      this.refs.drawer.classList.add('hidden');
      this.drawerState = null;
      if (this.refs.fab) this.refs.fab.classList.add('hidden');
      this.run.departStation();
    },
    closeStation: function () { this.refs.drawer.classList.add('hidden'); this.drawerState = null; },

    // ---------------- 车厢三选一 ----------------
    openCarOffer: function (list) {
      if (this.drawerState === 'refit') this.closeDrawer();
      const R_ = this.refs;
      R_.screen.innerHTML = '';
      R_.screen.classList.remove('hidden');
      const cards = h('div', { class: 'offer' });
      list.forEach(function (type) {
        const t = CFG.CAR_TYPES[type];
        cards.appendChild(h('button', { class: 'ocard', onclick: function () { Z.UI.takeCar(type); } },
          h('b', null, t.name),
          h('span', null, '耐久 ' + t.hp + ' · 挂点 ' + t.slots),
          h('i', null, t.refugees ? ('载 ' + t.refugees + ' 难民') : (t.power ? '速度 +8%' : (t.adjacentGuard ? '相邻减伤 40%' : (t.repairAura ? '自动修理' : '火力平台'))))));
      });
      R_.screen.appendChild(h('div', { class: 'panel-offer' },
        h('h2', null, '获得车厢'), h('div', { class: 'tagline' }, '随机三选一（同类型可以重复获得）'), cards));
    },
    takeCar: function (type) {
      this.run.takeCar(type);
      this.refs.screen.classList.add('hidden');
    },
    closeCarOffer: function () { this.refs.screen.classList.add('hidden'); },

    // ---------------- 改装 ----------------
    canOpenRefit: function () { return this.run.state === 'run' || this.run.state === 'parked' || this.run.state === 'station'; },
    toggleRefit: function () {
      if (this.drawerState === 'refit') this.closeDrawer();
      else if (this.canOpenRefit()) this.openRefit(0);
    },
    openRefit: function (carIdx) {
      if (this.drawerState === 'car') this.refs.screen.classList.add('hidden');
      this.drawerState = 'refit';
      this.refitIdx = carIdx;
      this.renderRefit();
      this.refs.drawer.classList.remove('hidden');
    },
    renderRefit: function () {
      const run = this.run, R_ = this.refs, box = R_.drawer;
      const idx = this.refitIdx || 0;
      const car = run.cars[idx];
      if (!car) { this.closeDrawer(); return; }
      const t = CFG.CAR_TYPES[car.type];
      box.innerHTML = '';
      box.appendChild(h('div', { class: 'dw-head' },
        h('div', null, h('b', null, '车厢 ' + (idx + 1) + ' · ' + t.name), h('div', { class: 'sub' }, '耐久 ' + Math.round(car.hp) + ' / ' + car.maxHp + (car.dead ? ' · 已损毁' : ''))),
        h('button', { class: 'btn sm ghost', onclick: function () { Z.UI.closeDrawer(); } }, '关闭')));

      if (car.slots.length === 0) {
        box.appendChild(h('div', { class: 'sub' }, '这节车厢没有武器挂点。'));
      }
      car.slots.forEach(function (w, j) {
        box.appendChild(Z.UI.slotCard(run, idx, j, w, car));
      });

      // 其它车厢快速切换
      box.appendChild(h('div', { class: 'dw-sec' }, '编组'));
      const list = h('div', { class: 'carlist' });
      run.cars.forEach(function (c, k) {
        list.appendChild(h('button', { class: 'carline' + (k === idx ? ' on' : ''), onclick: function () { Z.UI.openRefit(k); } },
          h('b', null, (k + 1) + '. ' + CFG.CAR_TYPES[c.type].name),
          h('span', null, c.dead ? '损毁' : Math.round(c.hp / c.maxHp * 100) + '%')));
      });
      box.appendChild(list);
      box.appendChild(h('div', { class: 'dw-foot' }, '改装时游戏暂停 · 关闭后继续 ' + (Z.Game.paused ? '（当前暂停）' : (Z.Game.speedMul + '×'))));
    },
    slotCard: function (run, carIdx, j, w, car) {
      const defs = h('div', { class: 'slotcard' });
      if (!w) {
        defs.appendChild(h('div', { class: 'row' }, h('b', null, '挂点 ' + (j + 1) + ' · 空'), h('span', { class: 'sub' }, '选择武器')));
        const list = h('div', { class: 'wlist' });
        CFG.WEAPON_ORDER.forEach(function (key) {
          const d = CFG.WEAPONS[key];
          const can = run.scrap >= d.cost && !car.dead;
          list.appendChild(h('button', {
            class: 'witem' + (can ? '' : ' off'), onclick: function () {
              if (!can) return Z.UI.toast(car.dead ? '这节车厢已损毁' : '废料不足', 'bad');
              run.addWeapon(carIdx, j, key);
              Z.UI.toast('安装 ' + d.name, 'good'); Z.UI.renderRefit();
            }
          },
            h('div', { class: 'row' }, h('i', { class: 'dot', style: { background: d.color } }), h('b', null, d.name), h('span', { class: 'cost' }, d.cost)),
            h('div', { class: 'kv' }, h('span', null, 'DPS ' + d.dps), h('span', null, '射程 ' + d.range + 'm'), h('span', null, d.mode))));
        });
        defs.appendChild(list);
        return defs;
      }
      const d = w.def(), f = w.formDef();
      const row = h('div', { class: 'row' },
        h('b', { style: { color: d.color } }, d.short + ' Lv' + w.level),
        h('span', { class: 'lv' }, f ? f.name : (w.level >= CFG.WEAPON.formLevel ? '待选形态' : '')));
      defs.appendChild(row);
      defs.appendChild(h('div', { class: 'kv' },
        h('span', null, 'DPS ' + Math.round(w.dps())),
        h('span', null, '射程 ' + Math.round(w.range())),
        h('span', null, '射速 ' + w.rof().toFixed(1))));
      const acts = h('div', { class: 'acts' });
      if (w.level < CFG.WEAPON.maxLevel) {
        acts.appendChild(h('button', {
          class: 'btn sm primary', onclick: function () {
            if (!run.upgradeWeapon(carIdx, j)) return Z.UI.toast('废料不足：' + w.upgradeCost(), 'bad');
            Z.UI.toast(d.short + ' → Lv' + w.level, 'good'); Z.UI.renderRefit();
          }
        }, '升级 Lv' + (w.level + 1) + ' · ' + w.upgradeCost()));
      } else acts.appendChild(h('span', { class: 'sub' }, '已满级'));
      if (w.canChooseForm()) {
        for (const k of ['A', 'B']) {
          const fo = d.forms[k];
          acts.appendChild(h('button', {
            class: 'btn sm', onclick: function () { w.form = k; Z.UI.toast('选择形态：' + fo.name, 'good'); Z.UI.renderRefit(); }
          }, '形态 ' + k + '：' + fo.name));
        }
      }
      acts.appendChild(h('button', {
        class: 'btn sm ghost', onclick: function () { run.removeWeapon(carIdx, j); Z.UI.renderRefit(); }
      }, '拆下'));
      defs.appendChild(acts);
      if (w.canChooseForm()) defs.appendChild(h('div', { class: 'sub' }, 'A：' + d.forms.A.desc + '　B：' + d.forms.B.desc));
      return defs;
    },
    closeDrawer: function () {
      // 只有在"站台里打开改装页"时，关闭才退回站台面板；
      // 直接关站台面板是允许的 —— 右下角会常驻「回到站台」，不会卡死。
      if (this.drawerState === 'refit' && this.run.state === 'station' && this.run.station) {
        this.openStation(this.run.station);
        return;
      }
      this.refs.drawer.classList.add('hidden');
      this.drawerState = null;
    },
    closeTop: function () {
      if (this.drawerState) this.closeDrawer();
      else if (!this.refs.screen.classList.contains('hidden')) {
        const run = this.run;
        if (run.state === 'menu') return;              // 标题页不关
        if (this._offerOpen) this.refs.screen.classList.add('hidden');
      }
    },
    tickRefit: function () {
      // 只在数字变化时重建，避免每帧闪
      const stamp = this.run.scrap + ':' + this.run.cars.map(function (c) { return c.hp | 0; }).join(',');
      if (this._refitStamp !== stamp) { this._refitStamp = stamp; this.renderRefit(); }
    },

    // ---------------- 结算 ----------------
    showResult: function (res, win) {
      this.showHUD(false);
      const R_ = this.refs;
      R_.screen.innerHTML = '';
      R_.screen.classList.remove('hidden');

      const mm = Math.floor((res.timeSec || 0) / 60);
      const ss = Math.floor((res.timeSec || 0) % 60);
      const timeStr = mm + ':' + String(ss).padStart(2, '0');
      const gradeCls = res.grade === '稳' ? 'good' : (res.grade === '险' ? 'warn' : 'bad');
      const cell = function (k, v) { return h('div', { class: 'statcell' }, h('span', null, k), h('b', null, v)); };

      const grid = h('div', { class: 'statgrid' },
        cell('里程', res.km.toFixed(1) + ' km'),
        cell('最高车速', Math.round((res.maxSpeed || 0) * 3.6) + ' km/h'),
        cell('最大编组', (res.maxCars || 0) + ' 节'),
        cell('击杀', U.fmt(res.kills) + (res.bossKills ? ' · Boss ' + res.bossKills : '')),
        cell('难民', res.refugees + ' / ' + res.capacity),
        cell('伤亡', (res.deadRefugees || 0) + ' 人'),
        cell('损毁车厢', res.deadCars + ' 节'),
        cell('修轨', (res.repairs || 0) + ' 次'),
        cell('用时', timeStr));

      const rows = [
        ['里程', res.miles], ['护送（' + res.refugees + ' 人）', res.esc],
        ['战果（' + res.kills + ' 杀 / ' + res.bossKills + ' Boss）', res.combat],
        ['完美', res.perfect], ['剩余折算', res.leftover], ['损毁扣分', -res.penalty]
      ].map(function (r) { return h('div', { class: 'resrow' }, h('span', null, r[0]), h('b', null, (r[1] >= 0 ? '+' : '') + U.fmt(r[1]))); });

      const bestLine = h('div', { class: 'bestline' },
        res.endless
          ? (res.isBest ? ('新纪录 ' + res.km.toFixed(1) + ' km') : ('最佳 ' + (res.bestPoints || 0).toFixed(1) + ' km（本次 ' + res.km.toFixed(1) + ' km）'))
          : res.prevBest
          ? (res.isBest
            ? ('本关最佳 ' + U.fmt(res.points) + ' · 刷新纪录 ↑')
            : ('本关最佳 ' + U.fmt(res.bestPoints) + '（本局 ' + U.fmt(res.points) + '）'))
          : ('首次通关 · 已记录最佳 ' + U.fmt(res.points)));

      R_.screen.appendChild(h('div', { class: 'panel-title ' + (win ? 'win' : 'lose') },
        h('h1', null, res.endless ? '无尽模式 · 列车停下了' : (win ? '抵达安全点' : '列车停下了')),
        h('div', { class: 'tagline' }, win ? '墙后的人打开了道口。' : '最后一节车厢的灯灭掉时，铁轨上只剩下脚步声。'),
        h('div', { class: 'grade ' + gradeCls }, res.grade),
        h('div', { class: 'gradeline' }, res.line),
        grid,
        h('div', { class: 'reslist' }, rows),
        bestLine,
        h('div', { class: 'points' }, '获得里程点 ', h('b', null, U.fmt(res.points))),
        h('div', { class: 'acts' },
          h('button', {
            class: 'btn primary', onclick: function () {
              const meta = Z.Meta;
              if (win) meta.selectedLevel = Math.max(meta.selectedLevel, Math.min(12, res.level + 1));
              meta.save();
              Z.UI.showLevels(win ? res.level + 1 : 0);
            }
          }, '返回基地'),
          h('button', { class: 'btn', onclick: function () { Z.Game.startLevel(res.level); } }, '重打本关'))));
    },

    // ---------------- 提示 ----------------
    toast: function (text, kind) {
      const el = h('div', { class: 'toast ' + (kind || 'info') }, text);
      this.refs.toasts.appendChild(el);
      setTimeout(function () { el.classList.add('out'); }, 2400);
      setTimeout(function () { el.remove(); }, 3000);
      while (this.refs.toasts.children.length > 4) this.refs.toasts.firstChild.remove();
    },
    hideScreen: function () { this.refs.screen.classList.add('hidden'); }
  };
})(window.ZT);
