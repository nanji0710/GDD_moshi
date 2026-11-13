'use strict';
// 共享外观表：2D 和 3D 都读这一份，避免两边各画各的
(function (root) {
  const Art = {
    // 丧尸：颜色 / 体型比例 / 特征
    ZOMBIE: {
      walker:   { body: '#55684f', head: '#5a6350', w: 1.00, h: 1.00, lean: 0.00 },
      runner:   { body: '#6a7a58', head: '#5a6350', w: 0.86, h: 1.06, lean: 0.14 },
      climber:  { body: '#4e5f52', head: '#5a6350', w: 0.92, h: 0.96, lean: 0.08, longArms: true },
      ripper:   { body: '#5f5a44', head: '#5a6350', w: 1.06, h: 0.94, lean: 0.05, tool: true },
      spitter:  { body: '#5f7a4a', head: '#5a6350', w: 1.00, h: 1.00, lean: 0.00, sac: true },
      screamer: { body: '#6a5f6a', head: '#5a6350', w: 0.82, h: 1.10, lean: 0.10, mouth: true },
      bloater:  { body: '#6a6a4a', head: '#5a6350', w: 1.36, h: 0.88, lean: -0.05, fat: true }
    },
    // 精英/小 Boss/正式 Boss 的覆盖色
    ZOMBIE_TIER: {
      elite: { body: '#6d7d45', head: '#7d8a4e' },
      mini:  { body: '#8a5a4a', head: '#8a5a4a' },
      boss:  { body: '#7a5c8a', head: '#9a7aaa' }
    },
    zOf: function (zb) {
      const base = this.ZOMBIE[zb.kind] || this.ZOMBIE.walker;
      const tier = zb.boss ? this.ZOMBIE_TIER.boss : zb.mini ? this.ZOMBIE_TIER.mini : zb.elite ? this.ZOMBIE_TIER.elite : null;
      return {
        body: tier ? tier.body : base.body,
        head: tier ? tier.head : base.head,
        w: base.w, h: base.h, lean: base.lean,
        longArms: base.longArms, tool: base.tool, sac: base.sac, mouth: base.mouth, fat: base.fat
      };
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Art;
  root.ZT = root.ZT || {};
  root.ZT.Art = Art;
})(typeof window !== 'undefined' ? window : globalThis);
