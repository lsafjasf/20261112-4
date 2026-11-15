// Web Audio: wind bed + fire crackle, driven by sim wind speed and fire load.
import { W, H, FUEL_BURNING } from '../core/terrain.js';

export function createAudio() {
  let ctx = null;
  let windGain, fireGain, crackleTimer = 0;
  let enabled = false;

  function ensure() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const noiseBuf = makeNoise(ctx, 2);

    // Wind: looping noise through a lowpass, gain follows wind speed.
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuf;
    windSrc.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 400;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windFilter).connect(windGain).connect(ctx.destination);
    windSrc.start();

    // Fire: noise through bandpass, gain follows burning cell count.
    const fireSrc = ctx.createBufferSource();
    fireSrc.buffer = noiseBuf;
    fireSrc.loop = true;
    fireSrc.playbackRate.value = 0.7;
    const fireFilter = ctx.createBiquadFilter();
    fireFilter.type = 'bandpass';
    fireFilter.frequency.value = 1800;
    fireFilter.Q.value = 0.8;
    fireGain = ctx.createGain();
    fireGain.gain.value = 0;
    fireSrc.connect(fireFilter).connect(fireGain).connect(ctx.destination);
    fireSrc.start();
  }

  function update(sim, dt) {
    if (!ctx || !enabled) return;
    const wind = sim.wind;
    let burning = 0, intensitySum = 0;
    for (let i = 0; i < W * H; i++) {
      if (sim.ter.fuel[i] === FUEL_BURNING) { burning++; intensitySum += sim.ter.intensity[i]; }
    }
    const t = ctx.currentTime;
    windGain.gain.setTargetAtTime(Math.min(0.25, wind.speed * 0.03), t, 0.3);
    const fireLevel = Math.min(0.4, (burning / 400) * 0.35 + intensitySum / 2000);
    fireGain.gain.setTargetAtTime(fireLevel, t, 0.4);
    // Random crackle pops, rate proportional to fire load.
    crackleTimer -= dt;
    if (crackleTimer <= 0 && burning > 0) {
      crackleTimer = 0.05 + Math.random() * (300 / (burning + 50));
      pop(Math.min(0.3, 0.05 + intensitySum / 3000));
    }
  }

  function pop(level) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = 900 + Math.random() * 2400;
    g.gain.setValueAtTime(level, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.06);
  }

  return {
    toggle(on) {
      enabled = on;
      if (on) { ensure(); ctx.resume(); }
      else if (ctx) {
        windGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        fireGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      }
    },
    update,
  };
}

function makeNoise(ctx, seconds) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}
