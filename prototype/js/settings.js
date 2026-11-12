'use strict';
// 设置：音效/音量/镜头/视角，以及"重看教学/清存档"这类维护操作。
window.ZT = window.ZT || {};
(function (Z) {
  const KEY = 'zt.settings.v1';
  const S = Z.Settings = {
    data: { sound: true, volume: 0.9, follow: true, tilt: true },
    load: function () {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) Object.assign(this.data, JSON.parse(raw) || {});
      } catch (e) {}
      this.data.volume = Math.max(0, Math.min(1, +this.data.volume || 0));
      return this.data;
    },
    save: function () {
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) {}
    },
    set: function (key, val) {
      this.data[key] = val;
      this.save();
      this.apply();
    },
    apply: function () {
      const d = this.data;
      if (Z.Sound) {
        Z.Sound.setEnabled(d.sound !== false);
        if (Z.Sound.setVolume) Z.Sound.setVolume(d.volume);
      }
      const R = Z.R;
      if (R) {
        R.follow = d.follow !== false;
        R.cam.tiltT = d.tilt === false ? 0 : (Z.CFG ? Z.CFG.CAM.tilt : 0.58);
      }
    },
    clearRun: function () { if (Z.Save) Z.Save.clear(); },
    clearAll: function () {
      try {
        const keep = [];
        for (let i = 0; i < localStorage.length; i++) keep.push(localStorage.key(i));
        for (const k of keep) {
          if (!k) continue;
          if (k.indexOf('zt.') === 0) localStorage.removeItem(k);
        }
      } catch (e) {}
      if (Z.Meta) { Z.Meta.points = 0; for (const m of Z.CFG.META) Z.Meta.levels[m.key] = 0; Z.Meta.selectedLevel = 1; Z.Meta.skins = { owned: ['rust'], active: 'rust' }; Z.Meta.save(); }
      if (Z.Tips) Z.Tips.reset();
    }
  };
  S.load();
})(window.ZT);
