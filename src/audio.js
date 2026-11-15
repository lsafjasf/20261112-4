// Web Audio：压缩机低鸣随工作箱数量变化，温度/损伤警报独立发声。
// 浏览器自动策略要求首次声音由用户手势触发，因此 init 绑定到首次点击。
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.compressor = null;
    this.compressorGain = null;
    this.alarmTimer = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 68;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 240;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(this.ctx.destination);
    osc.start();
    this.compressor = osc;
    this.compressorGain = gain;
  }

  // activeCount：正在制冷/制热的箱子数；degraded 时音调下沉表示功率下降
  updateCompressor(activeCount, degraded) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const target = activeCount === 0 ? 0 : 0.04 + activeCount * 0.018;
    this.compressorGain.gain.setTargetAtTime(target, now, 0.15);
    this.compressor.frequency.setTargetAtTime(
      degraded ? 46 : 68 + activeCount * 6,
      now,
      0.2,
    );
  }

  // 警报：间歇性双音，温度超限或急刹损伤过高时调用
  setAlarm(active) {
    if (!this.ctx) return;
    if (active && !this.alarmTimer && !this.muted) {
      let high = true;
      const beep = () => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "square";
        osc.frequency.value = high ? 880 : 660;
        gain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.08, this.ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.18);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.2);
        high = !high;
      };
      beep();
      this.alarmTimer = setInterval(beep, 420);
    } else if (!active && this.alarmTimer) {
      clearInterval(this.alarmTimer);
      this.alarmTimer = null;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) {
      this.setAlarm(false);
      if (this.compressorGain)
        this.compressorGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }
}
