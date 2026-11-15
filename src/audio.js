export class SurveyAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.propGain = null;
    this.propOsc = null;
    this.servoGain = null;
    this.alarmGain = null;
    this.droneGain = null;
    this.noiseGain = null;
    this.enabled = true;
    this.started = false;
    this.voices = 0;
  }

  async ensureStarted() {
    if (this.started) {
      if (this.context?.state === "suspended") await this.context.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      this.context = new AudioContextClass();
      this.started = true;
      this.buildGraph();
      if (this.context.state === "suspended") await this.context.resume();
    } catch {
      this.enabled = false;
    }
  }

  buildGraph() {
    const ctx = this.context;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.82 : 0;
    this.master.connect(ctx.destination);

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 16;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.02;
    compressor.release.value = 0.24;
    compressor.connect(this.master);

    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.024;
    this.droneGain.connect(compressor);
    const drone = ctx.createOscillator();
    drone.type = "sine";
    drone.frequency.value = 43;
    drone.connect(this.droneGain);
    drone.start();
    const droneHigh = ctx.createOscillator();
    droneHigh.type = "triangle";
    droneHigh.frequency.value = 86.5;
    const highGain = ctx.createGain();
    highGain.gain.value = 0.35;
    droneHigh.connect(highGain).connect(this.droneGain);
    droneHigh.start();

    this.propGain = ctx.createGain();
    this.propGain.gain.value = 0;
    this.propGain.connect(compressor);
    this.propOsc = ctx.createOscillator();
    this.propOsc.type = "triangle";
    this.propOsc.frequency.value = 74;
    this.propOsc.connect(this.propGain);
    this.propOsc.start();

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let randomState = 1739;
    for (let index = 0; index < data.length; index += 1) {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      data[index] = (randomState / 4294967296) * 2 - 1;
    }
    this.noiseBuffer = noiseBuffer;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 640;
    noiseFilter.Q.value = 0.8;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    noise.connect(noiseFilter).connect(this.noiseGain).connect(compressor);
    noise.start();

    this.servoGain = ctx.createGain();
    this.servoGain.gain.value = 0;
    this.servoGain.connect(compressor);
    const servo = ctx.createOscillator();
    servo.type = "sawtooth";
    servo.frequency.value = 218;
    servo.connect(this.servoGain);
    servo.start();

    this.alarmGain = ctx.createGain();
    this.alarmGain.gain.value = 0;
    this.alarmGain.connect(compressor);
    const alarm = ctx.createOscillator();
    alarm.type = "square";
    alarm.frequency.value = 610;
    const alarmFilter = ctx.createBiquadFilter();
    alarmFilter.type = "lowpass";
    alarmFilter.frequency.value = 1200;
    alarm.connect(alarmFilter).connect(this.alarmGain);
    alarm.start();
  }

  update(game, now = performance.now() / 1000) {
    if (!this.started || !this.context) return;
    const speed = Math.hypot(game.velocity.x, game.velocity.y);
    const thrust = Math.abs(game.controls.thrust);
    const targetProp = this.enabled && game.status === "running" ? 0.025 + thrust * 0.07 + (game.controls.boost ? 0.055 : 0) : 0;
    this.propGain.gain.setTargetAtTime(targetProp, this.context.currentTime, 0.08);
    this.propOsc.frequency.setTargetAtTime(66 + speed * 1.65, this.context.currentTime, 0.1);
    const wake = this.enabled && speed > 50 ? 0.045 : 0;
    this.noiseGain.gain.setTargetAtTime(wake, this.context.currentTime, 0.12);
    this.servoGain.gain.setTargetAtTime(
      this.enabled && game.sampling ? 0.026 + Math.sin(now * 15) * 0.012 : 0,
      this.context.currentTime,
      0.06,
    );
    const alarm = this.enabled && game.activeFault
      ? 0.018 + Math.max(0, Math.sin(now * 5.4)) * 0.036
      : 0;
    this.alarmGain.gain.setTargetAtTime(alarm, this.context.currentTime, 0.04);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!this.master) return;
    this.master.gain.setTargetAtTime(enabled ? 0.82 : 0, this.context.currentTime, 0.12);
  }

  ping() {
    if (!this.started || !this.enabled) return;
    const ctx = this.context;
    const at = ctx.currentTime + 0.015;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1180, at);
    osc.frequency.exponentialRampToValueAtTime(310, at + 0.46);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(0.12, at + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.62);
    osc.connect(gain).connect(this.master);
    osc.start(at);
    osc.stop(at + 0.66);
    this.trackVoice(0.66);
  }

  echo(blocked = false) {
    if (!this.started || !this.enabled) return;
    const ctx = this.context;
    const at = ctx.currentTime + 0.68;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = blocked ? 218 : 806;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(blocked ? 0.025 : 0.06, at + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + (blocked ? 0.35 : 0.58));
    osc.connect(gain).connect(this.master);
    osc.start(at);
    osc.stop(at + 0.64);
    this.trackVoice(1.32);
  }

  collision() {
    if (!this.started || !this.enabled) return;
    const ctx = this.context;
    const at = ctx.currentTime + 0.01;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(740, at);
    filter.frequency.exponentialRampToValueAtTime(180, at + 0.5);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.28, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.46);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(at);
    source.stop(at + 0.5);
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(92, at);
    thump.frequency.exponentialRampToValueAtTime(42, at + 0.3);
    thumpGain.gain.setValueAtTime(0.16, at);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);
    thump.connect(thumpGain).connect(this.master);
    thump.start(at);
    thump.stop(at + 0.36);
    this.trackVoice(0.5);
  }

  sampleComplete() {
    if (!this.started || !this.enabled) return;
    const ctx = this.context;
    const at = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(310, at);
    osc.frequency.linearRampToValueAtTime(520, at + 0.18);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(0.06, at + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
    osc.connect(gain).connect(this.master);
    osc.start(at);
    osc.stop(at + 0.45);
    this.trackVoice(0.45);
  }

  trackVoice(seconds) {
    this.voices += 1;
    setTimeout(() => {
      this.voices = Math.max(0, this.voices - 1);
    }, seconds * 1000);
  }

  diagnostics() {
    return {
      started: this.started,
      enabled: this.enabled,
      state: this.context?.state ?? "not-started",
      activeVoices: this.voices,
    };
  }
}
