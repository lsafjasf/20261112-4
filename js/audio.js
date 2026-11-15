const SFX_TABLE = {
  blip: { freq: 520, type: 'sine', dur: 0.07, gain: 0.08 },
  tick: { freq: 880, type: 'square', dur: 0.04, gain: 0.05 },
  thud: { freq: 140, type: 'triangle', dur: 0.12, gain: 0.12 },
  whoosh: { freq: 320, type: 'sawtooth', dur: 0.16, gain: 0.07 },
};

export class AudioBus {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.history = [];
  }

  ensure() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
  }

  resume() {
    this.ensure();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  play(sfx, at) {
    const spec = SFX_TABLE[sfx];
    this.history.push({ t: at ?? performance.now(), sfx });
    if (this.muted || !spec) return;
    this.ensure();
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, spec.freq * 0.6), t0 + spec.dur);
    gain.gain.setValueAtTime(spec.gain, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + spec.dur + 0.02);
  }
}
