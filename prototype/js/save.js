'use strict';
// 局内存档：只序列化"跑动中的这一局"，地图用关卡号确定性重生成，所以不需要存地图。
// 丧尸不入档（读档时清空），避免存档体积和"读档刷怪"漏洞。
window.ZT = window.ZT || {};
(function (Z) {
  const CFG = Z.CFG, KEY = 'zt.run.v1';

  const Save = Z.Save = {
    has: function () {
      try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
    },
    get: function () {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const d = JSON.parse(raw);
        if (!d || d.v !== 1 || !d.level) return null;
        if (!CFG.LEVELS[d.level - 1]) return null;
        return d;
      } catch (e) { return null; }
    },
    save: function (run) {
      if (!run || run.state === 'menu' || run.state === 'win' || run.state === 'over') return false;
      try {
        localStorage.setItem(KEY, JSON.stringify(run.snapshot()));
        this.lastSaved = Date.now();
        return true;
      } catch (e) { return false; }
    },
    best: function (level) {
      try { return JSON.parse(localStorage.getItem('zt.best.' + level) || 'null'); } catch (e) { return null; }
    },
    setBest: function (level, rec) {
      try { localStorage.setItem('zt.best.' + level, JSON.stringify(rec)); return true; } catch (e) { return false; }
    },
    clear: function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
    },
    // 给标题页用的一行摘要
    summary: function () {
      const d = this.get();
      if (!d) return null;
      const miss = Math.max(0, (Date.now() - (d.t || 0)) / 60000);
      return {
        level: d.level,
        city: CFG.LEVELS[d.level - 1].city,
        km: (d.km / 1000).toFixed(1),
        total: CFG.LEVELS[d.level - 1].km.toFixed(1),
        mins: Math.round(miss),
        state: d.state
      };
    }
  };
})(window.ZT);
