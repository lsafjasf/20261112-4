export class ObservatoryAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.enabled = false;
    this.windNodes = [];
    this.slewNodes = [];
    this.transientNodes = new Set();
    this.windGain = null;
    this.lastTaskKind = null;
    this.lastExposure = false;
    this.seed = 0x4a11c2;
  }

  get activeVoices() {
    return this.windNodes.length + this.slewNodes.length + this.transientNodes.size;
  }

  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  async enable() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.58;
      this.master.connect(this.context.destination);
    }
    await this.context.resume();
    this.enabled = true;
    this.startAmbient();
    return true;
  }

  async ensure() {
    if (!this.context) return this.enable();
    if (this.context.state === "suspended") await this.context.resume();
    this.enabled = true;
    if (!this.windNodes.length) this.startAmbient();
    return true;
  }

  setMuted(muted) {
    this.enabled = !muted;
    if (!this.context) return;
    if (muted) {
      this.stopAll();
    } else {
      this.context.resume().then(() => this.startAmbient());
    }
  }

  makeNoise(duration = 2) {
    const ctx = this.context;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < length; index += 1) {
      const white = this.random() * 2 - 1;
      last = last * 0.72 + white * 0.28;
      data[index] = last;
    }
    return buffer;
  }

  startAmbient() {
    if (!this.enabled || !this.context || this.windNodes.length) return;
    const ctx = this.context;
    const source = ctx.createBufferSource();
    source.buffer = this.makeNoise(2.5);
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 520;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0.018;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.13;
    lfoGain.gain.value = 0.008;
    lfo.connect(lfoGain).connect(gain.gain);
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
    lfo.start();
    this.windGain = gain;
    this.windNodes = [source, lfo, filter, gain, lfoGain];
  }

  setEnvironment(dust = 0, wind = 0) {
    if (!this.context || !this.windGain) return;
    const now = this.context.currentTime;
    const level = 0.012 + Math.min(0.055, wind * 0.0018 + dust * 0.045);
    this.windGain.gain.cancelScheduledValues(now);
    this.windGain.gain.setTargetAtTime(level, now, 0.35);
  }

  startSlew() {
    if (!this.enabled || !this.context || this.slewNodes.length) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const motor = ctx.createOscillator();
    motor.type = "sawtooth";
    motor.frequency.setValueAtTime(43, now);
    motor.frequency.linearRampToValueAtTime(54, now + 0.45);
    const harmonic = ctx.createOscillator();
    harmonic.type = "triangle";
    harmonic.frequency.value = 86;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 210;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.038, now + 0.18);
    motor.connect(filter);
    harmonic.connect(filter);
    filter.connect(gain).connect(this.master);
    motor.start();
    harmonic.start();
    this.slewNodes = [motor, harmonic, filter, gain];
  }

  stopSlew() {
    if (!this.context || !this.slewNodes.length) return;
    const now = this.context.currentTime;
    const [motor, harmonic, filter, gain] = this.slewNodes;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(0.0001, now, 0.05);
    window.setTimeout(() => {
      try {
        motor.stop();
        harmonic.stop();
      } catch {
        // Already stopped by a previous reset or safety action.
      }
      [motor, harmonic, filter, gain].forEach((node) => node.disconnect());
    }, 140);
    this.slewNodes = [];
  }

  shutter() {
    if (!this.enabled || !this.context) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.makeNoise(0.16);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 820;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.13, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 0.13);
    this._trackTransient(source, [filter, gain]);

    const thunk = ctx.createOscillator();
    const thunkGain = ctx.createGain();
    thunk.frequency.setValueAtTime(128, now);
    thunk.frequency.exponentialRampToValueAtTime(48, now + 0.09);
    thunkGain.gain.setValueAtTime(0.07, now);
    thunkGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    thunk.connect(thunkGain).connect(this.master);
    thunk.start(now);
    thunk.stop(now + 0.11);
    this._trackTransient(thunk, [thunkGain]);
  }

  successTone() {
    if (!this.enabled || !this.context) return;
    const ctx = this.context;
    [392, 523.25].forEach((frequency, index) => {
      const now = ctx.currentTime + index * 0.12;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.035, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      oscillator.connect(gain).connect(this.master);
      oscillator.start(now);
      oscillator.stop(now + 0.52);
      this._trackTransient(oscillator, [gain]);
    });
  }

  _trackTransient(source, otherNodes) {
    this.transientNodes.add(source);
    source.onended = () => {
      this.transientNodes.delete(source);
      otherNodes.forEach((node) => node.disconnect());
      source.disconnect();
    };
  }

  update(state) {
    if (!this.enabled || !this.context) return;
    this.setEnvironment(state.dust || 0, state.wind || 0);
    const isMotion = state.phase === "running" && ["slew", "filter", "dome"].includes(state.currentTask?.kind);
    if (isMotion) this.startSlew();
    else this.stopSlew();
  }

  stopAll() {
    this.stopSlew();
    if (this.windNodes.length) {
      const [source, lfo, filter, gain, lfoGain] = this.windNodes;
      try {
        source.stop();
        lfo.stop();
      } catch {
        // Sources can already be ended when reset comes from the same gesture.
      }
      [source, lfo, filter, gain, lfoGain].forEach((node) => node.disconnect());
      this.windNodes = [];
      this.windGain = null;
    }
    this.transientNodes.forEach((source) => {
      try {
        source.stop();
      } catch {
        // One-shot sources may already have reached their scheduled end.
      }
    });
    this.transientNodes.clear();
    this.lastTaskKind = null;
    this.lastExposure = false;
  }
}
