export class HarborAudio {
  constructor(button) {
    this.button = button;
    this.context = null;
    this.enabled = false;
    this.nodes = null;
  }

  async enable() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio");
    if (!this.context) this.build(AudioContextClass);
    await this.context.resume();
    this.enabled = true;
    this.button.classList.add("is-on");
    this.button.setAttribute("aria-pressed", "true");
    this.button.querySelector("span").textContent = "环境声开";
    this.applyTargets(this.lastState, true);
  }

  async disable() {
    this.enabled = false;
    this.button.classList.remove("is-on");
    this.button.setAttribute("aria-pressed", "false");
    this.button.querySelector("span").textContent = "环境声";
    if (this.context) this.applyTargets(this.lastState, true);
  }

  async toggle() {
    if (this.enabled) return this.disable();
    return this.enable();
  }

  build(AudioContextClass) {
    this.context = new AudioContextClass();
    const ctx = this.context;
    const master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < data.length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.94 + white * 0.06;
      data[index] = last;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const seaFilter = ctx.createBiquadFilter();
    seaFilter.type = "lowpass";
    seaFilter.frequency.value = 380;
    seaFilter.Q.value = 0.55;
    const seaGain = ctx.createGain();
    seaGain.gain.value = 0;
    noise.connect(seaFilter).connect(seaGain).connect(master);

    const pumpGain = ctx.createGain();
    pumpGain.gain.value = 0;
    const pumpFilter = ctx.createBiquadFilter();
    pumpFilter.type = "lowpass";
    pumpFilter.frequency.value = 230;
    const pumpOsc = ctx.createOscillator();
    pumpOsc.type = "sawtooth";
    pumpOsc.frequency.value = 74;
    const pumpOsc2 = ctx.createOscillator();
    pumpOsc2.type = "sine";
    pumpOsc2.frequency.value = 148;
    const pumpGain2 = ctx.createGain();
    pumpGain2.gain.value = 0.28;
    const tremolo = ctx.createOscillator();
    tremolo.frequency.value = 2.4;
    const tremoloDepth = ctx.createGain();
    tremoloDepth.gain.value = 0.55;
    const pumpBus = ctx.createGain();
    pumpBus.gain.value = 0.55;
    tremolo.connect(tremoloDepth).connect(pumpBus.gain);
    pumpOsc.connect(pumpFilter);
    pumpOsc2.connect(pumpGain2).connect(pumpFilter);
    pumpFilter.connect(pumpBus).connect(pumpGain).connect(master);

    noise.start();
    pumpOsc.start();
    pumpOsc2.start();
    tremolo.start();

    this.nodes = {
      master,
      seaGain,
      seaFilter,
      pumpGain,
      pumpOsc,
      pumpOsc2,
      pumpFilter,
      tremolo
    };
  }

  update(state) {
    this.lastState = state;
    if (!this.context || !this.nodes) return;
    this.applyTargets(state, false);
  }

  applyTargets(state, immediate) {
    if (!this.context || !this.nodes || !state) return;
    const now = this.context.currentTime;
    const time = immediate ? 0.02 : 0.22;
    const current = state.tide.current;
    const pumps = state.cages.filter((cage) => cage.aerator).length;
    const enabled = this.enabled ? 1 : 0;
    const { seaGain, seaFilter, pumpGain, pumpOsc, pumpOsc2, pumpFilter, tremolo } = this.nodes;

    seaGain.gain.setTargetAtTime(enabled * (0.018 + Math.min(0.045, current * 0.026)), now, time);
    seaFilter.frequency.setTargetAtTime(230 + current * 310 + state.tide.exchange * 170, now, time);
    pumpGain.gain.setTargetAtTime(enabled * Math.min(0.12, pumps * 0.032), now, time);
    pumpOsc.frequency.setTargetAtTime(68 + pumps * 7 + current * 3, now, time);
    pumpOsc2.frequency.setTargetAtTime(136 + pumps * 14 + current * 5, now, time);
    pumpFilter.frequency.setTargetAtTime(190 + pumps * 32 + current * 24, now, time);
    tremolo.frequency.setTargetAtTime(1.8 + pumps * 0.45, now, time);
  }

  alarm() {
    if (!this.context || !this.enabled) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(480, now);
    osc.frequency.exponentialRampToValueAtTime(710, now + 0.14);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.055, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
    osc.connect(gain).connect(this.nodes.master);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  confirm() {
    if (!this.context || !this.enabled) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(620, now);
    osc.frequency.exponentialRampToValueAtTime(820, now + 0.08);
    gain.gain.setValueAtTime(0.025, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain).connect(this.nodes.master);
    osc.start(now);
    osc.stop(now + 0.13);
  }
}
