'use strict';
// 一次性提示：每个 key 只弹一次，记录在 localStorage。
window.ZT = window.ZT || {};
(function (Z) {
  const KEY = 'zt.tips.v1';
  const Tips = Z.Tips = {
    seen: {},
    loaded: false,
    load: function () {
      if (this.loaded) return;
      this.loaded = true;
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) this.seen = JSON.parse(raw) || {};
      } catch (e) { this.seen = {}; }
    },
    save: function () {
      try { localStorage.setItem(KEY, JSON.stringify(this.seen)); } catch (e) {}
    },
    has: function (key) { this.load(); return !!this.seen[key]; },
    reset: function () { this.load(); this.seen = {}; this.save(); },
    // 显示（若未看过），返回是否真的弹了
    show: function (key, text, kind) {
      this.load();
      if (this.seen[key]) return false;
      this.seen[key] = 1;
      this.save();
      if (Z.UI) Z.UI.toast('提示 · ' + text, kind || 'tip');
      return true;
    }
  };

  // 文案集中在这里，方便改口吻
  Tips.TEXT = {
    start: '武器会自动索敌开火 · 点底部的车厢条可以改装和升级',
    goalEscort: '护送关：最后的货柜不能死，它挂在车尾——记得给它留装甲和修理',
    goalSprint: '限速关：速度掉到阈值以下超过数秒就失败，车厢别贪多',
    goalHold: '守站关：撑过倒计时就赢，守住列车别让车厢全爆',
    endless: '无尽模式：车厢每 2 km 一节、没有上限，挂得越多越慢；开不动就算结束',
    station: '站台是安全的：补给、接难民、改装都停着，点「继续出发」才开走',
    caroffer: '同类型车厢可以重复获得 · 但每多一节，最高速度 -3%',
    cardead: '车厢损毁会让里面的难民一起死 · 到站记得整车维修',
    refugee: '车厢耐久掉到 80/60/40/20% 时，每次死 2 个难民',
    skills: '技能：Q 紧急制动 · W 全弹齐射 · E 强制过载',
    night: '夜战：能见度 165 米，武器也打不到看不见的目标',
    tunnel: '隧道：能见度只有 120 米，好在顶灯会一路亮着',
    canyon: '连续弯道：山体会挡住射界，火力别全堆在一节车厢',
    straight: '长直道：速度上限 +20%，但正面会冲来更多冲锋者',
    rain: '雨战：刹车距离变长，火焰武器伤害 -30%',
    bridge: '铁桥：两侧没有地面，尸群只能沿轨道过来',
    boss: 'Boss 出现：优先集火，别让它贴上列车',
    repair: '轨道被撬断：撑住这十几秒，修满会自动出发'
  };

  // 捷径：Tips.tip('start')
  Tips.tip = function (key, kind) {
    const t = this.TEXT[key];
    if (!t) return false;
    return this.show(key, t, kind);
  };
})(window.ZT);
