import { altitudeAt, TARGETS } from "./simulation.js";

export class SceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.stars = [];
    this.milky = [];
    this.dustParticles = [];
    this.mountains = [];
    this.lastFrame = 0;
    this.elapsed = 0;
    this.seed = 0x6d2b79f5;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
    this.buildSky();
  }

  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.floor(rect.width * this.dpr);
    this.canvas.height = Math.floor(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.buildTerrain();
  }

  buildSky() {
    this.stars = Array.from({ length: 165 }, () => ({
      x: this.random(),
      y: this.random() * 0.68,
      radius: 0.35 + this.random() * 1.05,
      alpha: 0.2 + this.random() * 0.7,
      frequency: 0.5 + this.random() * 1.4,
      phase: this.random() * Math.PI * 2,
      warm: this.random() > 0.8,
    }));
    this.milky = Array.from({ length: 250 }, () => {
      const along = this.random();
      const spread = (this.random() - 0.5) * Math.pow(this.random(), 1.8) * 0.16;
      return {
        x: along * 0.92 + 0.03,
        y: 0.08 + along * 0.43 + spread,
        radius: 0.35 + this.random() * 1.6,
        alpha: 0.04 + this.random() * 0.2,
      };
    });
    this.dustParticles = Array.from({ length: 115 }, () => ({
      x: this.random(),
      y: 0.12 + this.random() * 0.75,
      length: 2 + this.random() * 22,
      speed: 0.08 + this.random() * 0.45,
      phase: this.random(),
      alpha: 0.08 + this.random() * 0.35,
    }));
  }

  buildTerrain() {
    const createRidge = (points, baseline, amplitude) => {
      const ridge = [];
      for (let index = 0; index <= points; index += 1) {
        const t = index / points;
        const shape =
          Math.sin(t * 18 + baseline * 33) * 0.22 +
          Math.sin(t * 7 + baseline * 19) * 0.48 +
          Math.sin(t * 31 + baseline * 11) * 0.12;
        ridge.push({ x: t, y: baseline - shape * amplitude - (this.random() - 0.5) * amplitude * 0.12 });
      }
      return ridge;
    };
    this.mountains = [
      { points: createRidge(20, 0.79, 0.115), color: "#2d2d2c", opacity: 1 },
      { points: createRidge(16, 0.855, 0.085), color: "#191b1b", opacity: 1 },
      { points: createRidge(23, 0.925, 0.045), color: "#0c0f0f", opacity: 1 },
    ];
  }

  draw(state, now = performance.now()) {
    if (!this.width || !this.height) return;
    const dt = this.lastFrame ? Math.min(0.06, (now - this.lastFrame) / 1000) : 0.016;
    this.lastFrame = now;
    this.elapsed += dt;
    const ctx = this.ctx;
    const W = this.width;
    const H = this.height;
    const target = this.getVisualTarget(state);
    const altitude = altitudeAt(target.id, state.time);
    const dust = state.dust || 0;
    const storm = state.stormActive ? Math.min(1, 0.25 + dust) : 0;

    this.drawSky(W, H, state, dust, altitude);
    this.drawMilkyWay(W, H);
    this.drawStars(W, H, state);
    this.drawTarget(W, H, target, altitude, state, dust);
    this.drawMountains(W, H, storm);
    this.drawDome(W, H, state, target, altitude);
    if (state.domeOpen && state.currentTask?.kind === "expose") {
      this.drawLightPath(W, H, target, altitude, state);
    }
    this.drawDust(W, H, dust, state.wind);
    this.drawHorizonHaze(W, H, dust);
    this.drawVignette(W, H);
  }

  getVisualTarget(state) {
    const group = state.currentTask?.group || (state.records?.A ? "B" : "A");
    return TARGETS[state.input.groups[group].targetId];
  }

  drawSky(W, H, state, dust, altitude) {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, "#03060c");
    gradient.addColorStop(0.38, "#080c15");
    gradient.addColorStop(0.65, "#17161a");
    gradient.addColorStop(0.78, `rgba(${94 + dust * 52}, ${52 + dust * 26}, ${28 + dust * 10}, 1)`);
    gradient.addColorStop(1, "#0a0c0d");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W * 0.28, H * 0.68, 0, W * 0.28, H * 0.68, W * 0.54);
    glow.addColorStop(0, `rgba(195, 113, 57, ${0.1 + dust * 0.2})`);
    glow.addColorStop(0.45, `rgba(88, 53, 34, ${0.06 + dust * 0.08})`);
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = "rgba(183, 146, 107, 0.22)";
    ctx.lineWidth = 1;
    for (let index = 1; index < 5; index += 1) {
      const y = (H * 0.11 * index) / 1;
      ctx.beginPath();
      ctx.moveTo(W * 0.08, y + 8);
      ctx.lineTo(W * 0.92, y);
      ctx.stroke();
    }
    ctx.restore();

    if (altitude < 38 || altitude > 70) {
      ctx.fillStyle = "rgba(240, 108, 95, 0.05)";
      ctx.fillRect(0, 0, W, H);
    }
  }

  drawMilkyWay(W, H) {
    const ctx = this.ctx;
    ctx.save();
    for (const star of this.milky) {
      ctx.beginPath();
      const x = star.x * W;
      const y = star.y * H;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, star.radius * 7);
      glow.addColorStop(0, `rgba(205, 196, 173, ${star.alpha})`);
      glow.addColorStop(1, "rgba(205, 196, 173, 0)");
      ctx.fillStyle = glow;
      ctx.arc(x, y, star.radius * 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawStars(W, H, state) {
    const ctx = this.ctx;
    ctx.save();
    for (const star of this.stars) {
      const twinkle = 0.55 + 0.45 * Math.sin(this.elapsed * star.frequency + star.phase);
      const x = star.x * W;
      const y = star.y * H;
      ctx.globalAlpha = star.alpha * twinkle;
      ctx.fillStyle = star.warm ? "#f4c89c" : "#d8e5ef";
      ctx.beginPath();
      ctx.arc(x, y, star.radius, 0, Math.PI * 2);
      ctx.fill();
      if (star.radius > 1.12) {
        ctx.globalAlpha *= 0.18;
        ctx.strokeStyle = star.warm ? "#f4c89c" : "#c9ddeb";
        ctx.beginPath();
        ctx.moveTo(x - 4, y);
        ctx.lineTo(x + 4, y);
        ctx.moveTo(x, y - 4);
        ctx.lineTo(x, y + 4);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  targetPoint(W, H, target, altitude) {
    return {
      x: W * 0.24 + ((target.az - 145) / 80) * W * 0.34,
      y: H * 0.71 - (Math.max(20, altitude) / 90) * H * 0.48,
    };
  }

  drawTarget(W, H, target, altitude, state, dust) {
    const ctx = this.ctx;
    const point = this.targetPoint(W, H, target, altitude);
    const visible = altitude >= target.minAltitude && altitude <= target.maxAltitude;
    const color = target.color;
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 1.2);
    ctx.save();
    ctx.globalAlpha = visible ? 0.82 : 0.35;
    const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, 34);
    glow.addColorStop(0, `${color}d8`);
    glow.addColorStop(0.18, `${color}64`);
    glow.addColorStop(1, `${color}00`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 34, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 0.75;
    ctx.globalAlpha = 0.5 + pulse * 0.3;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 8 + pulse * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.72;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(point.x - 22, point.y);
    ctx.lineTo(point.x - 12, point.y);
    ctx.moveTo(point.x + 12, point.y);
    ctx.lineTo(point.x + 22, point.y);
    ctx.moveTo(point.x, point.y - 22);
    ctx.lineTo(point.x, point.y - 12);
    ctx.moveTo(point.x, point.y + 12);
    ctx.lineTo(point.x, point.y + 22);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = "7px SFMono-Regular, Consolas, monospace";
    ctx.fillStyle = "rgba(240, 236, 226, 0.72)";
    ctx.fillText(`${target.catalog} / ${altitude.toFixed(1)}°`, point.x + 25, point.y - 3);
    ctx.fillStyle = visible ? color : "#f06c5f";
    ctx.font = "6px SFMono-Regular, Consolas, monospace";
    ctx.fillText(visible ? `WINDOW ${target.minAltitude}°–${target.maxAltitude}°` : "ALTITUDE OUT OF WINDOW", point.x + 25, point.y + 7);

    if (dust > 0.22) {
      ctx.strokeStyle = `rgba(240, 108, 95, ${Math.min(0.6, dust)})`;
      ctx.setLineDash([2, 3]);
      ctx.strokeRect(point.x - 19, point.y - 19, 38, 38);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawMountains(W, H, storm) {
    const ctx = this.ctx;
    for (const layer of this.mountains) {
      ctx.save();
      const gradient = ctx.createLinearGradient(0, H * 0.65, 0, H);
      gradient.addColorStop(0, layer.color);
      gradient.addColorStop(1, "#070909");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (const point of layer.points) {
        ctx.lineTo(point.x * W, point.y * H);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    if (storm > 0.2) {
      const haze = ctx.createLinearGradient(0, H * 0.55, 0, H);
      haze.addColorStop(0, "rgba(160, 91, 48, 0)");
      haze.addColorStop(0.7, `rgba(142, 78, 40, ${0.1 + storm * 0.2})`);
      haze.addColorStop(1, `rgba(82, 47, 29, ${0.22 + storm * 0.22})`);
      ctx.fillStyle = haze;
      ctx.fillRect(0, H * 0.55, W, H * 0.45);
    }
  }

  drawDome(W, H, state, target, altitude) {
    const ctx = this.ctx;
    const baseX = W * 0.73;
    const baseY = H * 0.825;
    const radius = Math.min(W * 0.14, H * 0.255);
    const point = this.targetPoint(W, H, target, altitude);
    const open = state.domeOpen;

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.beginPath();
    ctx.ellipse(baseX, baseY + 7, radius * 1.32, 11, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#0c0e0e";
    ctx.fillRect(baseX - radius * 1.32, baseY - 3, radius * 2.64, 10);
    ctx.fillStyle = "rgba(232, 164, 95, 0.32)";
    for (let index = 0; index < 5; index += 1) {
      ctx.fillRect(baseX - radius + index * (radius * 0.48), baseY + 1, 10, 1);
    }

    const domeGradient = ctx.createLinearGradient(baseX - radius, baseY - radius, baseX + radius, baseY);
    domeGradient.addColorStop(0, "#343837");
    domeGradient.addColorStop(0.35, "#252a29");
    domeGradient.addColorStop(0.75, "#151918");
    domeGradient.addColorStop(1, "#0c0f0f");
    ctx.fillStyle = domeGradient;
    ctx.beginPath();
    ctx.moveTo(baseX - radius, baseY);
    ctx.arc(baseX, baseY, radius, Math.PI, Math.PI * 2);
    ctx.lineTo(baseX + radius, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(220, 209, 187, 0.14)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.strokeStyle = "rgba(220, 209, 187, 0.13)";
    for (let index = 1; index < 6; index += 1) {
      const angle = Math.PI + (index / 6) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(baseX, baseY - radius * 0.92);
      ctx.lineTo(baseX + Math.cos(angle) * radius * 1.02, baseY + Math.sin(angle) * radius * 1.02);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(baseX, baseY - radius * 0.34, radius * 0.83, radius * 0.58, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    if (open) {
      ctx.fillStyle = "rgba(4, 6, 9, 0.93)";
      ctx.beginPath();
      ctx.moveTo(baseX + radius * 0.03, baseY - radius * 0.15);
      ctx.lineTo(baseX - radius * 0.18, baseY - radius * 0.88);
      ctx.lineTo(baseX + radius * 0.36, baseY - radius * 0.78);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(232, 164, 95, 0.36)";
      ctx.beginPath();
      ctx.moveTo(baseX - radius * 0.18, baseY - radius * 0.88);
      ctx.lineTo(baseX + radius * 0.03, baseY - radius * 0.15);
      ctx.lineTo(baseX + radius * 0.36, baseY - radius * 0.78);
      ctx.stroke();
    } else {
      ctx.fillStyle = "rgba(5, 7, 9, 0.86)";
      ctx.fillRect(baseX - 2, baseY - radius * 0.93, 4, radius * 0.5);
    }

    const pivot = { x: baseX, y: baseY - radius * 0.16 };
    let angle = Math.atan2(point.y - pivot.y, point.x - pivot.x);
    if (!open) angle = -Math.PI / 2.1;
    const tubeLength = radius * (open ? 0.8 : 0.55);
    const aperture = {
      x: pivot.x + Math.cos(angle) * tubeLength,
      y: pivot.y + Math.sin(angle) * tubeLength,
    };
    this.aperture = aperture;

    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.moveTo(pivot.x + 2, pivot.y + 3);
    ctx.lineTo(aperture.x + 2, aperture.y + 3);
    ctx.stroke();
    const tube = ctx.createLinearGradient(pivot.x, pivot.y, aperture.x, aperture.y);
    tube.addColorStop(0, "#4b5351");
    tube.addColorStop(0.5, "#202625");
    tube.addColorStop(1, "#66716d");
    ctx.strokeStyle = tube;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(pivot.x, pivot.y);
    ctx.lineTo(aperture.x, aperture.y);
    ctx.stroke();
    ctx.strokeStyle = "rgba(232, 164, 95, 0.65)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pivot.x, pivot.y);
    ctx.lineTo(aperture.x, aperture.y);
    ctx.stroke();
    ctx.fillStyle = "#111615";
    ctx.beginPath();
    ctx.arc(aperture.x, aperture.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = open ? "#77d7c7" : "rgba(119, 215, 199, 0.26)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(aperture.x, aperture.y, 5.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#202625";
    ctx.beginPath();
    ctx.arc(pivot.x, pivot.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = open ? "rgba(119, 215, 199, 0.8)" : "rgba(240, 108, 95, 0.65)";
    ctx.beginPath();
    ctx.arc(baseX + radius * 0.65, baseY - radius * 0.15, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "6px SFMono-Regular, Consolas, monospace";
    ctx.fillStyle = "rgba(240, 236, 226, 0.4)";
    ctx.fillText(open ? "SHUTTER OPEN" : "SHUTTER SAFE", baseX - radius * 0.25, baseY + 21);
    ctx.restore();
  }

  drawLightPath(W, H, target, altitude, state) {
    const ctx = this.ctx;
    const start = this.aperture;
    const end = this.targetPoint(W, H, target, altitude);
    if (!start) return;
    ctx.save();
    const beam = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
    beam.addColorStop(0, "rgba(255, 193, 117, 0.62)");
    beam.addColorStop(0.45, "rgba(232, 164, 95, 0.18)");
    beam.addColorStop(1, `${target.color}42`);
    ctx.strokeStyle = beam;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(232, 164, 95, 0.17)";
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.globalAlpha = 1;

    const progress = (state.time * 0.35 + this.elapsed * 0.3) % 1;
    for (let index = 0; index < 4; index += 1) {
      const t = (progress + index * 0.24) % 1;
      const x = start.x + (end.x - start.x) * t;
      const y = start.y + (end.y - start.y) * t;
      ctx.fillStyle = `rgba(255, 206, 146, ${0.5 - index * 0.08})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawDust(W, H, dust, wind) {
    if (dust <= 0.008) return;
    const ctx = this.ctx;
    ctx.save();
    const strength = Math.min(1, dust * 1.7);
    for (const particle of this.dustParticles) {
      const speed = particle.speed * (1.2 + wind * 0.09);
      const x = ((((particle.x + this.elapsed * speed * 0.12) % 1.2) + 1.2) % 1.2) * W;
      const drift = Math.sin(this.elapsed * 0.6 + particle.phase * 9) * 8 * strength;
      const y = particle.y * H + drift;
      const length = particle.length * (0.45 + strength * 0.9);
      ctx.strokeStyle = `rgba(195, 137, 83, ${particle.alpha * strength})`;
      ctx.lineWidth = 0.7 + strength;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + length, y + length * 0.1);
      ctx.stroke();
    }
    const bands = ctx.createLinearGradient(0, H * 0.18, W, H * 0.54);
    bands.addColorStop(0, `rgba(99, 62, 39, ${0.05 * strength})`);
    bands.addColorStop(0.35, `rgba(164, 100, 56, ${0.17 * strength})`);
    bands.addColorStop(0.65, `rgba(111, 69, 42, ${0.1 * strength})`);
    bands.addColorStop(1, "rgba(80, 51, 35, 0)");
    ctx.fillStyle = bands;
    ctx.beginPath();
    ctx.moveTo(0, H * 0.25);
    for (let x = 0; x <= W; x += W / 12) {
      ctx.lineTo(x, H * (0.33 + Math.sin(x / W * 7 + this.elapsed * 0.2) * 0.05));
    }
    ctx.lineTo(W, H * 0.63);
    ctx.lineTo(0, H * 0.56);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawHorizonHaze(W, H, dust) {
    if (dust <= 0.005) return;
    const ctx = this.ctx;
    const haze = ctx.createLinearGradient(0, H * 0.61, 0, H);
    haze.addColorStop(0, "rgba(177, 106, 60, 0)");
    haze.addColorStop(0.56, `rgba(163, 96, 54, ${dust * 0.18})`);
    haze.addColorStop(1, `rgba(94, 56, 35, ${dust * 0.42})`);
    ctx.fillStyle = haze;
    ctx.fillRect(0, H * 0.61, W, H * 0.39);
  }

  drawVignette(W, H) {
    const ctx = this.ctx;
    const vignette = ctx.createRadialGradient(W * 0.48, H * 0.46, H * 0.22, W * 0.5, H * 0.5, W * 0.68);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.7, "rgba(0, 0, 0, 0.12)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.55)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }
}
