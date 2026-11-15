function createNoiseBuffer(context, seconds = 4) {
  const sampleRate = context.sampleRate;
  const length = Math.floor(sampleRate * seconds);
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let value = 0.42;
  for (let index = 0; index < length; index += 1) {
    const white = Math.random() * 2 - 1;
    value = value * 0.82 + white * 0.18;
    data[index] = value * (0.3 + 0.7 * Math.random());
  }
  return buffer;
}

const CALL_PATTERNS = {
  oystercatcher: [
    { at: 0, duration: 0.15, from: 1220, to: 1480, gain: 0.17 },
    { at: 0.24, duration: 0.1, from: 1480, to: 1120, gain: 0.13 },
    { at: 0.43, duration: 0.16, from: 1260, to: 1540, gain: 0.14 },
  ],
  tern: [
    { at: 0, duration: 0.075, from: 2180, to: 2520, gain: 0.12 },
    { at: 0.11, duration: 0.08, from: 2340, to: 2760, gain: 0.11 },
    { at: 0.23, duration: 0.07, from: 2480, to: 2900, gain: 0.1 },
    { at: 0.34, duration: 0.12, from: 2760, to: 2060, gain: 0.12 },
  ],
  sandpiper: [
    { at: 0, duration: 0.21, from: 3100, to: 2050, gain: 0.13 },
    { at: 0.3, duration: 0.14, from: 2500, to: 3300, gain: 0.1 },
    { at: 0.48, duration: 0.18, from: 2900, to: 1850, gain: 0.09 },
  ],
};

export class CoastAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.ambient = null;
    this.windGain = null;
    this.seaGain = null;
    this.lightGain = null;
    this.sources = new Set();
    this.nodes = new Set();
    this.voiceNodes = new Set();
    this.timers = new Set();
    this.enabled = false;
    this.paused = true;
    this.wind = 0;
    this.lightsOn = false;
  }

  async init() {
    if (this.context) {
      await this.context.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.context.destination);
    this.ambient = this.context.createGain();
    this.ambient.gain.value = 0;
    this.ambient.connect(this.master);

    const seaFilter = this.context.createBiquadFilter();
    seaFilter.type = "lowpass";
    seaFilter.frequency.value = 480;
    seaFilter.Q.value = 0.55;
    this.seaGain = this.context.createGain();
    this.seaGain.gain.value = 0.095;
    const seaSource = this.context.createBufferSource();
    seaSource.buffer = createNoiseBuffer(this.context, 4.5);
    seaSource.loop = true;
    seaSource.connect(seaFilter);
    seaFilter.connect(this.seaGain);
    this.seaGain.connect(this.ambient);
    this.sources.add(seaSource);
    this.nodes.add(seaFilter);
    this.nodes.add(this.seaGain);
    seaSource.start();

    const windFilter = this.context.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 1350;
    windFilter.Q.value = 0.38;
    this.windGain = this.context.createGain();
    this.windGain.gain.value = 0.015;
    const windSource = this.context.createBufferSource();
    windSource.buffer = createNoiseBuffer(this.context, 3);
    windSource.loop = true;
    windSource.playbackRate.value = 0.72;
    windSource.connect(windFilter);
    windFilter.connect(this.windGain);
    this.windGain.connect(this.ambient);
    this.sources.add(windSource);
    this.nodes.add(windFilter);
    this.nodes.add(this.windGain);
    windSource.start();

    const lightOsc = this.context.createOscillator();
    lightOsc.type = "sine";
    lightOsc.frequency.value = 61;
    this.lightGain = this.context.createGain();
    this.lightGain.gain.value = 0;
    lightOsc.connect(this.lightGain);
    this.lightGain.connect(this.master);
    this.sources.add(lightOsc);
    this.nodes.add(this.lightGain);
    lightOsc.start();
  }

  async enable() {
    await this.init();
    this.enabled = true;
    this.paused = false;
    this.applyEnvironment();
    await this.context.resume();
  }

  async disable() {
    this.enabled = false;
    this.paused = true;
    this.applyEnvironment();
    if (this.context) await this.context.suspend();
  }

  applyEnvironment() {
    if (!this.context || !this.enabled) {
      if (this.ambient) this.ambient.gain.setTargetAtTime(0, this.context.currentTime, 0.08);
      return;
    }
    const targetAmbient = this.paused ? 0 : 0.86;
    this.ambient.gain.setTargetAtTime(targetAmbient, this.context.currentTime, 0.2);
    this.seaGain.gain.setTargetAtTime(0.09 + this.wind * 0.004, this.context.currentTime, 0.4);
    this.windGain.gain.setTargetAtTime(
      this.paused ? 0 : 0.018 + Math.min(0.26, this.wind * 0.044),
      this.context.currentTime,
      0.45,
    );
    this.lightGain.gain.setTargetAtTime(
      this.paused || !this.lightsOn ? 0 : 0.018,
      this.context.currentTime,
      0.25,
    );
  }

  update({ wind = 0, lightsOn = false, paused = true } = {}) {
    this.wind = wind;
    this.lightsOn = lightsOn;
    this.paused = paused || !this.enabled;
    this.applyEnvironment();
  }

  scheduleTimer(callback, delay) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delay);
    this.timers.add(timer);
    return timer;
  }

  playBirdCall(callName, options = {}) {
    if (!this.context || !this.enabled || this.paused) return;
    const pattern = CALL_PATTERNS[callName] ?? CALL_PATTERNS.oystercatcher;
    const distortion = options.rejected ? 0.55 : 0;
    const quality = Math.max(0.35, Math.min(1, (options.quality ?? 84) / 100));
    const startAt = this.context.currentTime + 0.04;
    pattern.forEach((note, index) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = index % 2 === 0 ? "sine" : "triangle";
      const noteStart = startAt + note.at;
      const duration = note.duration * (0.8 + quality * 0.35);
      oscillator.frequency.setValueAtTime(note.from * (0.93 + quality * 0.08), noteStart);
      oscillator.frequency.exponentialRampToValueAtTime(
        note.to * (1 + (Math.random() - 0.5) * distortion),
        noteStart + duration,
      );
      const peak = note.gain * (options.rejected ? 0.72 : 1) * (0.86 + quality * 0.18);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(peak, noteStart + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + duration);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + duration + 0.03);
      this.nodes.add(gain);
      this.nodes.add(oscillator);
      this.voiceNodes.add(gain);
      this.voiceNodes.add(oscillator);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
        this.nodes.delete(oscillator);
        this.nodes.delete(gain);
        this.voiceNodes.delete(oscillator);
        this.voiceNodes.delete(gain);
      };
    });
  }

  playRejected() {
    if (!this.context || !this.enabled || this.paused) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(240, now);
    oscillator.frequency.exponentialRampToValueAtTime(92, now + 0.23);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.31);
    this.nodes.add(gain);
    this.nodes.add(oscillator);
    this.voiceNodes.add(gain);
    this.voiceNodes.add(oscillator);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      this.nodes.delete(oscillator);
      this.nodes.delete(gain);
      this.voiceNodes.delete(oscillator);
      this.voiceNodes.delete(gain);
    };
  }

  stopVoiceActivity() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const node of this.voiceNodes) {
      try {
        if (typeof node.stop === "function") node.stop();
        node.disconnect();
      } catch {
        // Voice may already have ended.
      }
      this.nodes.delete(node);
    }
    this.voiceNodes.clear();
  }

  resourceCount() {
    return {
      contextState: this.context?.state ?? "closed",
      activeNodes: this.nodes.size,
      dynamicVoiceNodes: this.voiceNodes.size,
      scheduledTimers: this.timers.size,
      sources: this.sources.size,
    };
  }

  async dispose() {
    this.stopVoiceActivity();
    this.enabled = false;
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // Closing an already suspended context is harmless.
      }
      this.context = null;
      this.master = null;
      this.ambient = null;
      this.windGain = null;
      this.seaGain = null;
      this.lightGain = null;
    }
  }
}
