export class SalvageAudio {
  constructor() {
    this.context = null;
    this.enabled = true;
    this.ready = false;
    this.nodes = {};
  }

  async ensure() {
    if (this.ready) {
      if (this.context.state === "suspended") await this.context.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    this.context = new AudioContextClass();
    const ctx = this.context;

    const master = ctx.createGain();
    master.gain.value = this.enabled ? 0.55 : 0;
    master.connect(ctx.destination);

    const engine = ctx.createOscillator();
    engine.type = "sawtooth";
    engine.frequency.value = 46;
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 180;
    engineFilter.Q.value = 2.4;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engine.connect(engineFilter).connect(engineGain).connect(master);
    engine.start();

    const lock = ctx.createOscillator();
    lock.type = "sine";
    lock.frequency.value = 720;
    const lockGain = ctx.createGain();
    lockGain.gain.value = 0;
    lock.connect(lockGain).connect(master);
    lock.start();

    const alarm = ctx.createOscillator();
    alarm.type = "square";
    alarm.frequency.value = 155;
    const alarmFilter = ctx.createBiquadFilter();
    alarmFilter.type = "bandpass";
    alarmFilter.frequency.value = 420;
    alarmFilter.Q.value = 3;
    const alarmGain = ctx.createGain();
    alarmGain.gain.value = 0;
    alarm.connect(alarmFilter).connect(alarmGain).connect(master);
    alarm.start();

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = (Math.sin(index * 12.9898) * 43758.5453) % 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 950;
    noiseFilter.Q.value = 0.8;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(noiseFilter).connect(noiseGain).connect(master);
    noise.start();

    this.nodes = {
      master,
      engine,
      engineFilter,
      engineGain,
      lock,
      lockGain,
      alarm,
      alarmGain,
      noise,
      noiseFilter,
      noiseGain,
    };
    this.ready = true;
  }

  async setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) await this.ensure();
    if (!this.ready) return;
    this.nodes.master.gain.setTargetAtTime(enabled ? 0.55 : 0, this.context.currentTime, 0.03);
  }

  update({ thrust = 0, towing = false, danger = false, wind = 0, targetNear = false, status = "active" }) {
    if (!this.ready) return;
    const now = this.context.currentTime;
    const engineLevel = status === "active" ? Math.min(1, Math.abs(thrust)) : 0;
    this.nodes.engineGain.gain.setTargetAtTime(engineLevel * 0.11, now, 0.06);
    this.nodes.engine.frequency.setTargetAtTime(44 + engineLevel * 58 + (towing ? -9 : 0), now, 0.08);
    this.nodes.engineFilter.frequency.setTargetAtTime(150 + engineLevel * 520, now, 0.08);
    this.nodes.lockGain.gain.setTargetAtTime(
      status === "active" && (towing || targetNear) ? (towing ? 0.036 : 0.018) : 0,
      now,
      0.08,
    );
    this.nodes.lock.frequency.setTargetAtTime(towing ? 510 : 760, now, 0.16);
    const alarmLevel = danger && status === "active"
      ? 0.027 + Math.max(0, Math.sin(now * 7.4)) * 0.035
      : status === "failed" ? 0.032 : 0;
    this.nodes.alarmGain.gain.setTargetAtTime(alarmLevel, now, 0.08);
    this.nodes.noiseGain.gain.setTargetAtTime(wind * 0.019 + (danger ? 0.006 : 0), now, 0.16);
    this.nodes.noiseFilter.frequency.setTargetAtTime(620 + wind * 900, now, 0.2);
  }

  ping(kind = "lock") {
    if (!this.ready || !this.enabled) return;
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = kind === "warning" ? "square" : "sine";
    oscillator.frequency.value = kind === "capture" ? 1040 : kind === "warning" ? 190 : 680;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(kind === "warning" ? 0.08 : 0.055, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.24);
    oscillator.connect(gain).connect(this.nodes.master);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.26);
  }

  burst(kind = "collision") {
    if (!this.ready || !this.enabled) return;
    const ctx = this.context;
    const source = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
    }
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = kind === "wind" ? "lowpass" : "bandpass";
    filter.frequency.value = kind === "wind" ? 620 : 1400;
    const gain = ctx.createGain();
    gain.gain.value = 0.12;
    source.connect(filter).connect(gain).connect(this.nodes.master);
    source.start();
  }

  dispose() {
    if (!this.context) return;
    Object.values(this.nodes).forEach((node) => {
      if (typeof node.stop === "function") node.stop();
      if (typeof node.disconnect === "function") node.disconnect();
    });
    this.context.close();
    this.ready = false;
    this.nodes = {};
  }
}
