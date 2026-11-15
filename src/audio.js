/* Web Audio: ambient rumble, aftershock alarm, UI blips and error buzz.
   Everything is synthesized; no external assets. Created lazily on the
   first user gesture so browser autoplay policies are respected. */
(function (root) {
  'use strict';

  function AudioManager() {
    this.ctx = null;
    this.master = null;
    this.ambientGain = null;
    this.muted = false;
    this.ambientNodes = [];
  }

  AudioManager.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    var Ctx = root.AudioContext || root.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(this.ctx.destination);
    this.startAmbient();
  };

  AudioManager.prototype.startAmbient = function () {
    var ctx = this.ctx;
    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = 0.05;
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    var osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = 55;
    var osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = 82.4;
    var lfo = ctx.createOscillator();
    lfo.frequency.value = 0.15;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain);
    lfoGain.connect(this.ambientGain.gain);
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(this.ambientGain);
    this.ambientGain.connect(this.master);
    osc1.start();
    osc2.start();
    lfo.start();
    this.ambientNodes = [osc1, osc2, lfo];
  };

  AudioManager.prototype._tone = function (freq, duration, type, volume, slideTo) {
    if (!this.ctx || this.muted) return;
    var ctx = this.ctx;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(slideTo,
        ctx.currentTime + duration);
    }
    gain.gain.setValueAtTime(volume || 0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001,
      ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  };

  AudioManager.prototype.alarm = function () {
    if (!this.ctx || this.muted) return;
    this._tone(880, 0.18, 'square', 0.18);
    var self = this;
    setTimeout(function () { self._tone(660, 0.28, 'square', 0.18); }, 220);
  };

  AudioManager.prototype.blip = function () {
    this._tone(520, 0.08, 'sine', 0.15, 720);
  };

  AudioManager.prototype.error = function () {
    this._tone(160, 0.25, 'sawtooth', 0.18, 90);
  };

  AudioManager.prototype.success = function () {
    this._tone(523, 0.12, 'sine', 0.18);
    var self = this;
    setTimeout(function () { self._tone(784, 0.2, 'sine', 0.18); }, 130);
  };

  AudioManager.prototype.toggleMute = function () {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.6;
    return this.muted;
  };

  root.RescueAudio = AudioManager;
})(typeof self !== 'undefined' ? self : this);
