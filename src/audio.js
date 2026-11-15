import { STATION_IDS } from './model.js';

export class WaterAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.pumps = {};
    this.enabled = true;
    this.nextAlarmAt = 0;
  }

  async start() {
    if (this.context) {
      if (this.context.state === 'suspended') await this.context.resume();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.enabled ? 0.75 : 0;
    this.master.connect(this.context.destination);

    for (const id of STATION_IDS) {
      const hum = this.context.createOscillator();
      const overtone = this.context.createOscillator();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      hum.type = 'sawtooth';
      overtone.type = 'sine';
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      filter.Q.value = 1.4;
      gain.gain.value = 0;
      hum.connect(filter);
      overtone.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      hum.start();
      overtone.start();
      this.pumps[id] = { hum, overtone, filter, gain };
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(enabled ? 0.75 : 0, this.context.currentTime, 0.05);
    }
  }

  update(state) {
    if (!this.context || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    let index = 0;
    for (const id of STATION_IDS) {
      const pump = this.pumps[id];
      const speed = state.pumps[id].speed / 100;
      const base = 46 + index * 6;
      pump.hum.frequency.setTargetAtTime(base + speed * 72, now, 0.16);
      pump.overtone.frequency.setTargetAtTime((base + speed * 72) * 2.01, now, 0.2);
      pump.gain.gain.setTargetAtTime(0.004 + speed * 0.022, now, 0.2);
      pump.filter.frequency.setTargetAtTime(220 + speed * 520, now, 0.2);
      index += 1;
    }

    const critical = state.alerts.some((alert) => alert.severity === 'critical');
    const warning = state.alerts.some((alert) => alert.severity === 'warning');
    if ((critical || warning) && now >= this.nextAlarmAt) {
      this.playAlarm(critical ? 880 : 540, critical ? 0.16 : 0.1);
      this.nextAlarmAt = now + (critical ? 0.9 : 2.4);
    }
  }

  playAlarm(frequency, duration) {
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.78, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
}
