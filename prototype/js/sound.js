'use strict';
// 程序化音频（WebAudio，零音频文件）：3 总线 + 压缩器，全合成，无素材。
// 浏览器自动播放策略：首次 pointerdown/keydown 时 unlock。
window.ZT = window.ZT || {};
(function (Z) {
  const S = Z.Sound = {
    ctx: null, master: null, comp: null, sfxBus: null, ambBus: null, noiseBuf: null,
    enabled: true, unlocked: false, voices: 0, maxVoices: 16,
    last: {}, rumbleGain: null, rumbleNode: null,

    init: function () {
      if (this.ctx) return this.ctx;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        const ctx = this.ctx = new AC();
        this.comp = ctx.createDynamicsCompressor();
        this.comp.threshold.value = -18; this.comp.knee.value = 24; this.comp.ratio.value = 6;
        this.comp.attack.value = 0.004; this.comp.release.value = 0.22;
        this.master = ctx.createGain(); this.master.gain.value = this.enabled ? 0.9 : 0;
        this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 1.0;
        this.ambBus = ctx.createGain(); this.ambBus.gain.value = 0.55;
        this.sfxBus.connect(this.comp); this.ambBus.connect(this.comp);
        this.comp.connect(this.master); this.master.connect(ctx.destination);
        // 噪声缓冲
        const len = Math.floor(ctx.sampleRate * 1.0);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
        this.buildRumble();
        return ctx;
      } catch (e) { return null; }
    },

    unlock: function () {
      if (this.unlocked) return;
      const ctx = this.init();
      if (!ctx) return;
      try { if (ctx.state === 'suspended') ctx.resume(); } catch (e) {}
      this.unlocked = true;
      this.ambientStart();
    },

    setEnabled: function (on) {
      this.enabled = !!on;
      try { if (this.master) this.master.gain.value = this.enabled ? 0.9 : 0; } catch (e) {}
      try { localStorage.setItem('zt.sound', this.enabled ? '1' : '0'); } catch (e) {}
    },
    loadPref: function () {
      try { const v = localStorage.getItem('zt.sound'); if (v === '0') this.enabled = false; } catch (e) {}
    },
    toggle: function () { this.setEnabled(!this.enabled); return this.enabled; },

    // ---------------- 基元 ----------------
    noise: function (dur, type, freq, q, gain, dest, when, sweepTo) {
      const ctx = this.ctx; if (!ctx || !this.noiseBuf) return;
      const t = when || ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const flt = ctx.createBiquadFilter(); flt.type = type || 'bandpass';
      flt.frequency.value = freq || 1200; flt.Q.value = q == null ? 1 : q;
      if (sweepTo) flt.frequency.linearRampToValueAtTime(sweepTo, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(flt); flt.connect(g); g.connect(dest || this.sfxBus);
      src.start(t); src.stop(t + dur + 0.02);
    },
    tone: function (freq, dur, type, gain, dest, when, slideTo) {
      const ctx = this.ctx; if (!ctx) return;
      const t = when || ctx.currentTime;
      const o = ctx.createOscillator(); o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(dest || this.sfxBus);
      o.start(t); o.stop(t + dur + 0.02);
    },

    // ---------------- 音色表 ----------------
    play: function (name, opt) {
      opt = opt || {};
      if (!this.enabled || !this.ctx) return;
      if (this.voices >= this.maxVoices) return;
      const now = this.ctx.currentTime;
      const throttle = { mg: 0.045, flak: 0.07, flamer: 0.09, tesla: 0.08, mortar: 0.12, hit: 0.03, claw: 0.08 }[name] || 0.02;
      if (this.last[name] && now - this.last[name] < throttle) return;
      this.last[name] = now;
      this.voices++;
      const t = now;
      const vol = opt.vol == null ? 1 : opt.vol;
      switch (name) {
        case 'mg':
          this.noise(0.07, 'bandpass', 2400, 0.9, 0.13 * vol);
          this.tone(180, 0.06, 'square', 0.05 * vol);
          break;
        case 'flak':
          this.noise(0.10, 'bandpass', 900, 0.8, 0.20 * vol);
          this.tone(90, 0.09, 'sine', 0.12 * vol);
          break;
        case 'flamer':
          this.noise(0.16, 'lowpass', 700, 0.6, 0.12 * vol, null, t, 300);
          break;
        case 'tesla':
          this.tone(760, 0.13, 'sawtooth', 0.06 * vol, null, t, 260);
          this.noise(0.10, 'highpass', 2600, 0.7, 0.05 * vol);
          break;
        case 'mortar':
          this.noise(0.20, 'lowpass', 400, 0.5, 0.14 * vol, null, t, 120);
          this.tone(70, 0.16, 'sine', 0.14 * vol);
          break;
        case 'boom':
          this.noise(0.55, 'lowpass', 900, 0.4, 0.30 * vol, null, t, 70);
          this.tone(58, 0.5, 'sine', 0.22 * vol, null, t, 32);
          break;
        case 'hit':
          this.noise(0.045, 'highpass', 3200, 0.8, 0.10 * vol);
          break;
        case 'claw':
          this.noise(0.14, 'bandpass', 420, 1.0, 0.14 * vol);
          break;
        case 'growl':
          this.tone(92, 0.55, 'sawtooth', 0.05 * vol, this.ambBus, t, 62);
          this.tone(96, 0.5, 'sawtooth', 0.04 * vol, this.ambBus, t + 0.03, 70);
          break;
        case 'roar':
          this.tone(70, 0.9, 'sawtooth', 0.16 * vol, null, t, 34);
          this.noise(0.9, 'lowpass', 500, 0.5, 0.20 * vol, null, t, 90);
          break;
        case 'alarm':
          this.tone(880, 0.12, 'square', 0.09 * vol);
          this.tone(660, 0.12, 'square', 0.09 * vol, null, t + 0.16);
          break;
        case 'chime':
          this.tone(880, 0.14, 'sine', 0.10 * vol);
          this.tone(1320, 0.18, 'sine', 0.08 * vol, null, t + 0.09);
          break;
        case 'ui':
          this.tone(1200, 0.05, 'sine', 0.05 * vol);
          break;
        case 'win':
          [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'sine', 0.10 * vol, null, t + i * 0.12));
          break;
        case 'lose':
          [392, 330, 262].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.10 * vol, null, t + i * 0.18));
          break;
      }
      const self = this;
      setTimeout(function () { self.voices = Math.max(0, self.voices - 1); }, 260);
    },

    // ---------------- 持续层 ----------------
    buildRumble: function () {
      const ctx = this.ctx; if (!ctx) return;
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 120; flt.Q.value = 0.7;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(flt); flt.connect(g); g.connect(this.ambBus);
      src.start();
      this.rumbleNode = src; this.rumbleGain = g;
    },
    rumble: function (level) {
      if (!this.rumbleGain || !this.ctx) return;
      const v = Math.max(0, Math.min(1, level));
      try {
        this.rumbleGain.gain.setTargetAtTime(0.10 + v * 0.16, this.ctx.currentTime, 0.25);
        if (this.rumbleNode) this.rumbleNode.playbackRate.setTargetAtTime(0.85 + v * 0.35, this.ctx.currentTime, 0.3);
      } catch (e) {}
    },

    ambientStart: function () {
      // 环境底噪：极低音量的风声
      const ctx = this.ctx; if (!ctx || this._ambStarted) return;
      this._ambStarted = true;
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const flt = ctx.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = 420; flt.Q.value = 0.4;
      const g = ctx.createGain(); g.gain.value = 0.012;
      src.connect(flt); flt.connect(g); g.connect(this.ambBus);
      src.start();
    }
  };

  S.loadPref();

  // 首次交互解锁
  function once() {
    S.unlock();
    window.removeEventListener('pointerdown', once);
    window.removeEventListener('keydown', once);
  }
  window.addEventListener('pointerdown', once);
  window.addEventListener('keydown', once);
})(window.ZT);
