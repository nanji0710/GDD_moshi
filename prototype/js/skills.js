'use strict';
// 技能卡：3 张，冷却 + 持续。第 1 关没有，第 2 关起逐张解锁。
window.ZT = window.ZT || {};
(function (Z) {
  const CFG = Z.CFG, Fx = Z.Fx;
  const Skills = Z.Skills = {
    ensure: function (run, level) {
      const want = level <= 1 ? 0 : Math.min(3, level - 1);
      run.skills.owned = CFG.SKILLS.slice(0, want).map(function (s) { return s.key; });
      if (want > 0 && Z.Tips) Z.Tips.tip('skills');
      for (const s of CFG.SKILLS) {
        if (run.skills.cd[s.key] == null) run.skills.cd[s.key] = 0;
        if (run.skills.active[s.key] == null) run.skills.active[s.key] = 0;
      }
    },
    reset: function (run) {
      run.skills = { owned: [], cd: {}, active: {} };
      this.ensure(run, run.level);
    },
    update: function (run, dt) {
      for (const s of CFG.SKILLS) {
        if (run.skills.cd[s.key] > 0) run.skills.cd[s.key] = Math.max(0, run.skills.cd[s.key] - dt);
        if (run.skills.active[s.key] > 0) run.skills.active[s.key] = Math.max(0, run.skills.active[s.key] - dt);
      }
      // 技能持续时间结束
      for (const s of CFG.SKILLS) {
        if (run.skills.active[s.key] === 0) run.skills.active[s.key] = 0;
      }
    },
    has: function (run, key) { return run.skills.owned.indexOf(key) >= 0; },
    ready: function (run, key) { return this.has(run, key) && (run.skills.cd[key] || 0) <= 0; },
    active: function (run, key) { return (run.skills.active[key] || 0) > 0; },
    activate: function (run, key) {
      if (!this.ready(run, key)) return false;
      const def = CFG.SKILLS.find(function (s) { return s.key === key; });
      if (!def) return false;
      run.skills.active[key] = def.dur;
      run.skills.cd[key] = def.cd + def.dur;
      if (key === 'brake') run.speed *= 0.45;
      if (Z.UI) Z.UI.toast(def.name + ' 启动', 'good');
      const lay = run.train ? run.train.layout(Z.World) : [];
      const mid = lay[(lay.length / 2) | 0];
      if (mid) { Fx.shock(mid.x, mid.y, 3, 26, def.color); }
      return true;
    }
  };
})(window.ZT);
