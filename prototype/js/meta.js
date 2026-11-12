'use strict';
// 局外成长：6 条独立线（速度/血量/攻速/攻击力/维修/回血）+ 里程点 + 本地存档。
// 经济约束：12 关全通一次约 62 000 点，而 6 条全满需要约 132 000 点 —— 单周目不可能满级。
window.ZT = window.ZT || {};
(function (Z) {
  const CFG = Z.CFG, KEY = 'zt.meta.v2';
  const Meta = Z.Meta = {
    points: 0,
    levels: {},
    skins: { owned: ['rust'], active: 'rust' },
    selectedLevel: 1,
    load: function () {
      for (const m of CFG.META) this.levels[m.key] = this.levels[m.key] || 0;
      const defSkin = CFG.SKINS[0].key;
      this.skins = { owned: [defSkin], active: defSkin };
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const d = JSON.parse(raw);
          this.points = Math.max(0, d.points | 0);
          this.selectedLevel = Math.min(12, Math.max(1, d.selectedLevel | 0 || 1));
          for (const m of CFG.META) this.levels[m.key] = Math.min(10, Math.max(0, (d.levels && d.levels[m.key]) | 0));
          if (d.skins) {
            const owned = Array.isArray(d.skins.owned) && d.skins.owned.length ? d.skins.owned.filter(function (k) {
              return CFG.SKINS.some(function (x) { return x.key === k; });
            }) : [defSkin];
            if (owned.indexOf(defSkin) < 0) owned.unshift(defSkin);
            this.skins = { owned: owned, active: owned.indexOf(d.skins.active) >= 0 ? d.skins.active : defSkin };
          }
        }
      } catch (e) { /* 忽略损坏存档 */ }
      return this;
    },
    save: function () {
      try {
        localStorage.setItem(KEY, JSON.stringify({ points: this.points, levels: this.levels, selectedLevel: this.selectedLevel, skins: this.skins }));
      } catch (e) { /* 隐私模式下静默失败 */ }
    },
    addPoints: function (n) { this.points += Math.max(0, n | 0); this.save(); return this.points; },
    costOf: function (key, lv) {
      const m = CFG.META.find(function (x) { return x.key === key; });
      if (!m) return Infinity;
      return Math.round(m.base * Math.pow(CFG.META_GROWTH, Math.max(0, (lv || this.levels[key]) - 1)));
    },
    canBuy: function (key) {
      const m = CFG.META.find(function (x) { return x.key === key; });
      return !!m && this.levels[key] < 10 && this.points >= this.costOf(key, this.levels[key] + 1);
    },
    buy: function (key) {
      if (!this.canBuy(key)) return false;
      const lv = this.levels[key] + 1;
      this.points -= this.costOf(key, lv);
      this.levels[key] = lv;
      this.save();
      return true;
    },
    // 乘率（速度/血量/攻速/攻击力）
    mult: function (key) {
      const m = CFG.META.find(function (x) { return x.key === key; });
      if (!m) return 1;
      return 1 + m.per * this.levels[key];
    },
    repairMul: function () {
      const m = CFG.META.find(function (x) { return x.key === 'repair'; });
      return Math.max(0.4, 1 - m.per * this.levels.repair);
    },
    regen: function () { return CFG.META.find(function (x) { return x.key === 'regen'; }).per * this.levels.regen; },
    totalSpent: function () {
      let s = 0;
      for (const m of CFG.META) for (let lv = 1; lv <= this.levels[m.key]; lv++) s += this.costOf(m.key, lv);
      return s;
    },
    maxed: function (key) { return this.levels[key] >= 10; },
    has5: function (key) { return (this.levels[key] || 0) >= 5; },
    skinDef: function () {
      const k = this.skins && this.skins.active;
      return CFG.SKINS.find(function (x) { return x.key === k; }) || CFG.SKINS[0];
    },
    ownsSkin: function (key) { return (this.skins.owned || []).indexOf(key) >= 0; },
    buySkin: function (key) {
      const d = CFG.SKINS.find(function (x) { return x.key === key; });
      if (!d || this.ownsSkin(key)) return false;
      if (this.points < d.cost) return false;
      this.points -= d.cost;
      this.skins.owned.push(key);
      this.skins.active = key;
      this.save();
      return true;
    },
    setSkin: function (key) {
      if (!this.ownsSkin(key)) return false;
      this.skins.active = key;
      this.save();
      return true;
    },
    summary: function () {
      const out = [];
      for (const m of CFG.META) out.push({ key: m.key, name: m.name, lv: this.levels[m.key], cost: this.costOf(m.key, this.levels[m.key] + 1), maxed: this.maxed(m.key) });
      return out;
    }
  };
  Meta.load();
})(window.ZT);
