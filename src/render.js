import {
  LIMITS,
  NO_GO,
  STATION,
  WORLD,
  bandDistance,
  clamp,
  distance,
} from "./sim.js";

const TAU = Math.PI * 2;

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0xffffffff;
  };
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.dpr = 1;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.width = 0;
    this.height = 0;
    this.stars = [];
    this.effects = [];
    this.startTime = performance.now();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.scale = Math.min(width / WORLD.width, height / WORLD.height);
    this.offsetX = (width - WORLD.width * this.scale) / 2;
    this.offsetY = (height - WORLD.height * this.scale) / 2;
    this.buildStars();
  }

  buildStars() {
    const random = seeded(0x550aa1);
    this.stars = Array.from({ length: 170 }, (_, index) => ({
      x: random(),
      y: random(),
      size: 0.3 + random() * 1.6,
      alpha: 0.18 + random() * 0.65,
      layer: 0.22 + Math.floor(random() * 3) * 0.28,
      tint: index % 11 === 0 ? "#ffd9a3" : index % 7 === 0 ? "#8fe8ff" : "#d7f5ff",
    }));
  }

  pushEvent(event, state) {
    const now = performance.now();
    const x = state?.ship?.x ?? WORLD.width * 0.5;
    const y = state?.ship?.y ?? WORLD.height * 0.5;
    if (event.type === "capture") {
      this.effects.push({ type: "capture", start: now, life: 900, label: `锁定 · ${event.mass} kg`, x, y });
    } else if (event.type === "deliver") {
      this.effects.push({ type: "deliver", start: now, life: 1100, label: `交付 ${event.deliveredCount}/4`, x: STATION.x, y: STATION.y });
    } else if (event.type === "collision") {
      this.effects.push({ type: "collision", start: now, life: 650, label: `碰撞 ${event.count}/3`, x, y });
    } else if (event.type === "failure") {
      this.effects.push({ type: "failure", start: now, life: 1800, label: event.label, x, y });
    } else if (event.type === "mission-complete") {
      this.effects.push({ type: "complete", start: now, life: 1900, label: "全部碎片已回收", x: STATION.x, y: STATION.y });
    } else if (event.type === "solar-wind") {
      this.effects.push({ type: "wind", start: now, life: 1500, label: "太阳风侧向阵风", x: 820, y: 76 });
    }
  }

  render(sim, options = {}) {
    const ctx = this.ctx;
    const state = sim.state;
    const now = performance.now();
    const elapsed = (now - this.startTime) / 1000;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackdrop(ctx, state, elapsed);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    this.drawWorldBackdrop(ctx, state, elapsed);
    this.drawSolarWind(ctx, state, elapsed);
    const bands = sim.getBands();
    bands.forEach((band) => this.drawTrafficBand(ctx, band, state, elapsed));
    this.drawNoGoZone(ctx, state, elapsed);
    this.drawStation(ctx, state, elapsed, options);
    this.drawCable(ctx, state, elapsed);
    state.debris.forEach((debris) => this.drawDebris(ctx, debris, state, elapsed));
    this.drawShip(ctx, state, elapsed, options);
    this.drawEffects(ctx, now);
    this.drawWorldFrame(ctx, state, elapsed);
    ctx.restore();

    if (options.replay) this.drawReplayTag(ctx, elapsed, options);
    if (options.paused) this.drawPaused(ctx, elapsed);
    if (options.danger) this.drawDangerEdge(ctx, elapsed);
  }

  drawBackdrop(ctx, state, elapsed) {
    const width = this.width;
    const height = this.height;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#02070b");
    gradient.addColorStop(0.5, "#071620");
    gradient.addColorStop(1, "#03090e");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(width * 0.16, height * 1.03, 0, width * 0.16, height * 1.03, width * 0.74);
    glow.addColorStop(0, "rgba(31, 118, 143, 0.18)");
    glow.addColorStop(0.47, "rgba(8, 36, 49, 0.08)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    const drift = {
      x: (state.ship.x - 292) * 0.015,
      y: (state.ship.y - 668) * 0.012,
    };
    this.stars.forEach((star) => {
      const x = ((star.x * width - drift.x * star.layer + width) % width);
      const y = ((star.y * height - drift.y * star.layer + height) % height);
      ctx.globalAlpha = star.alpha;
      ctx.fillStyle = star.tint;
      ctx.fillRect(x, y, star.size, star.size);
    });
    ctx.globalAlpha = 1;
  }

  drawWorldBackdrop(ctx, state, elapsed) {
    const earthX = -136;
    const earthY = 1092;
    const earthR = 642;
    ctx.save();
    const atmosphere = ctx.createRadialGradient(earthX, earthY, earthR * 0.86, earthX, earthY, earthR * 1.06);
    atmosphere.addColorStop(0, "rgba(61, 179, 204, 0)");
    atmosphere.addColorStop(0.83, "rgba(73, 196, 222, 0.05)");
    atmosphere.addColorStop(0.9, "rgba(74, 218, 241, 0.22)");
    atmosphere.addColorStop(1, "rgba(20, 112, 135, 0)");
    ctx.fillStyle = atmosphere;
    ctx.beginPath();
    ctx.arc(earthX, earthY, earthR * 1.07, 0, TAU);
    ctx.fill();

    const planet = ctx.createRadialGradient(earthX - 240, earthY - 260, 30, earthX, earthY, earthR);
    planet.addColorStop(0, "#1b5c70");
    planet.addColorStop(0.32, "#0e3c50");
    planet.addColorStop(0.6, "#082737");
    planet.addColorStop(0.82, "#04141e");
    planet.addColorStop(1, "#01060a");
    ctx.fillStyle = planet;
    ctx.beginPath();
    ctx.arc(earthX, earthY, earthR, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "#87e9ff";
    ctx.lineWidth = 1.2;
    for (let index = 0; index < 5; index += 1) {
      ctx.beginPath();
      ctx.ellipse(earthX, earthY, earthR * (0.54 + index * 0.13), earthR * (0.22 + index * 0.05), -0.28, 0, TAU);
      ctx.stroke();
    }

    ctx.globalAlpha = 0.14;
    ctx.setLineDash([4, 13]);
    for (const radius of [456, 585, 729, 862]) {
      ctx.beginPath();
      ctx.arc(earthX + 20, earthY + 20, radius, -1.9, -0.92);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = "rgba(129, 224, 242, 0.045)";
    ctx.lineWidth = 1;
    for (let x = 100; x < WORLD.width; x += 100) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD.height);
      ctx.stroke();
    }
    for (let y = 100; y < WORLD.height; y += 100) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD.width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSolarWind(ctx, state, elapsed) {
    const wind = state.wind;
    if (!wind.active) return;
    const amount = Math.round(10 + wind.strength * 32);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let index = 0; index < amount; index += 1) {
      const seedValue = (index * 73 + 19) % 101;
      const x = ((index * 171 + elapsed * 280 * wind.direction + 1800) % 1800) - 100;
      const y = ((seedValue * 89 + index * 37) % 980) - 40;
      const length = 22 + (seedValue % 27) * 1.5;
      const alpha = 0.035 + (seedValue % 8) * 0.009;
      ctx.strokeStyle = `rgba(255, 214, 142, ${alpha})`;
      ctx.lineWidth = 0.8 + (seedValue % 3) * 0.35;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - length * wind.direction, y + 1.2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawTrafficBand(ctx, band, state, elapsed) {
    const half = band.width / 2;
    const shipInside = bandDistance(state.ship, band) < half + state.ship.radius;
    ctx.save();
    ctx.translate(WORLD.width * 0.5, band.centerY);
    ctx.rotate(band.angle);

    const fill = ctx.createLinearGradient(0, -half, 0, half);
    fill.addColorStop(0, "rgba(51, 176, 202, 0)");
    fill.addColorStop(0.18, "rgba(51, 176, 202, 0.045)");
    fill.addColorStop(0.5, "rgba(71, 207, 227, 0.075)");
    fill.addColorStop(0.82, "rgba(51, 176, 202, 0.045)");
    fill.addColorStop(1, "rgba(51, 176, 202, 0)");
    ctx.fillStyle = fill;
    ctx.fillRect(-1000, -half, 2000, band.width);

    ctx.strokeStyle = shipInside ? "rgba(255, 111, 91, 0.52)" : "rgba(106, 231, 255, 0.17)";
    ctx.lineWidth = 1;
    ctx.setLineDash([22, 16]);
    ctx.lineDashOffset = -elapsed * 28;
    for (const y of [-half, 0, half]) {
      ctx.beginPath();
      ctx.moveTo(-1000, y);
      ctx.lineTo(1000, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.fillStyle = shipInside ? "rgba(255, 93, 108, 0.07)" : "rgba(106, 231, 255, 0.025)";
    for (let x = -960 + ((elapsed * 36) % 44); x < 960; x += 44) {
      ctx.fillRect(x, -half + 4, 2, band.width - 8);
    }

    ctx.fillStyle = shipInside ? "#ff8d95" : "rgba(143, 230, 241, 0.56)";
    ctx.font = "600 8px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.letterSpacing = "0.12em";
    ctx.fillText(`SAT TRAFFIC / ${band.id.toUpperCase()}`, -620, -half - 9);
    ctx.letterSpacing = "0px";
    ctx.restore();

    band.satellites.forEach((satellite, index) => {
      const satelliteGlow = ctx.createRadialGradient(satellite.x, satellite.y, 0, satellite.x, satellite.y, 24);
      satelliteGlow.addColorStop(0, "rgba(159, 242, 255, 0.55)");
      satelliteGlow.addColorStop(0.4, "rgba(78, 205, 231, 0.14)");
      satelliteGlow.addColorStop(1, "rgba(78, 205, 231, 0)");
      ctx.fillStyle = satelliteGlow;
      ctx.beginPath();
      ctx.arc(satellite.x, satellite.y, 24, 0, TAU);
      ctx.fill();
      ctx.save();
      ctx.translate(satellite.x, satellite.y);
      ctx.rotate(elapsed * (0.7 + index * 0.16));
      ctx.strokeStyle = "rgba(175, 245, 255, 0.9)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(8, 0);
      ctx.lineTo(0, 8);
      ctx.lineTo(-8, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = "rgba(106, 231, 255, 0.55)";
      ctx.fillRect(-4, -1, 8, 2);
      ctx.fillRect(-1, -4, 2, 8);
      ctx.restore();
    });
  }

  drawNoGoZone(ctx, state, elapsed) {
    const inside = distance(state.ship, NO_GO) < NO_GO.radius;
    ctx.save();
    ctx.translate(NO_GO.x, NO_GO.y);
    const pulse = 0.5 + Math.sin(elapsed * 3.2) * 0.5;
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, NO_GO.radius * 1.3);
    glow.addColorStop(0, `rgba(255, 58, 75, ${0.11 + pulse * 0.03})`);
    glow.addColorStop(0.67, "rgba(255, 58, 75, 0.09)");
    glow.addColorStop(0.7, "rgba(255, 83, 102, 0.34)");
    glow.addColorStop(1, "rgba(255, 58, 75, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, NO_GO.radius * 1.3, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, NO_GO.radius, 0, TAU);
    ctx.clip();
    ctx.globalAlpha = inside ? 0.22 : 0.1;
    ctx.strokeStyle = "#ff596b";
    ctx.lineWidth = 5;
    for (let offset = -NO_GO.radius * 2; offset < NO_GO.radius * 2; offset += 18) {
      ctx.beginPath();
      ctx.moveTo(offset, -NO_GO.radius);
      ctx.lineTo(offset + NO_GO.radius * 2, NO_GO.radius);
      ctx.stroke();
    }
    ctx.restore();

    ctx.lineWidth = 1.4;
    ctx.strokeStyle = `rgba(255, 103, 117, ${0.5 + pulse * 0.4})`;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = elapsed * 18;
    ctx.beginPath();
    ctx.arc(0, 0, NO_GO.radius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(255, 93, 108, 0.65)";
    for (let index = 0; index < 4; index += 1) {
      const angle = index * Math.PI * 0.5 + Math.PI * 0.25;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * (NO_GO.radius - 12), Math.sin(angle) * (NO_GO.radius - 12));
      ctx.lineTo(Math.cos(angle) * (NO_GO.radius + 12), Math.sin(angle) * (NO_GO.radius + 12));
      ctx.stroke();
    }
    ctx.fillStyle = "#ff9ba3";
    ctx.font = "650 9px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.textAlign = "center";
    ctx.fillText("NO-GO / 禁航区", 0, -NO_GO.radius - 16);
    ctx.textAlign = "left";
    ctx.restore();
  }

  drawStation(ctx, state, elapsed, options) {
    ctx.save();
    ctx.translate(STATION.x, STATION.y);
    const delivered = state.deliveryOrder.length;
    const active = options.status === "active";
    const glow = ctx.createRadialGradient(0, 0, 8, 0, 0, 86);
    glow.addColorStop(0, "rgba(109, 232, 255, 0.16)");
    glow.addColorStop(0.45, "rgba(58, 173, 203, 0.07)");
    glow.addColorStop(1, "rgba(58, 173, 203, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 86, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = "rgba(131, 233, 250, 0.33)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 70, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = "rgba(106, 231, 255, 0.12)";
    ctx.beginPath();
    ctx.arc(0, 0, LIMITS.deliveryRange, 0, TAU);
    ctx.stroke();

    ctx.rotate(0.28);
    ctx.strokeStyle = "rgba(153, 226, 239, 0.65)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 50, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 201, 104, 0.5)";
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, 60, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let index = 0; index < 4; index += 1) {
      ctx.rotate(Math.PI * 0.5);
      ctx.fillStyle = "rgba(169, 231, 243, 0.54)";
      ctx.fillRect(29, -3, 34, 6);
      ctx.fillStyle = index < delivered ? "#9bf4c2" : "rgba(255, 201, 104, 0.68)";
      ctx.fillRect(55, -3, 4, 6);
    }

    ctx.rotate(-0.28 + elapsed * 0.07);
    ctx.strokeStyle = "rgba(106, 231, 255, 0.34)";
    ctx.lineWidth = 1;
    for (let index = 0; index < 3; index += 1) {
      ctx.beginPath();
      ctx.arc(0, 0, 19 + index * 6, index * 1.2, index * 1.2 + 2.2);
      ctx.stroke();
    }
    ctx.rotate(-elapsed * 0.07);
    ctx.fillStyle = "rgba(5, 23, 33, 0.9)";
    ctx.beginPath();
    ctx.arc(0, 0, 17, 0, TAU);
    ctx.fill();
    ctx.fillStyle = active ? "#8fefff" : "#ffc968";
    ctx.beginPath();
    ctx.arc(0, 0, 5 + Math.sin(elapsed * 2.8) * 1.2, 0, TAU);
    ctx.fill();
    ctx.shadowColor = active ? "#6ae7ff" : "#ffc968";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(198, 246, 255, 0.62)";
    ctx.font = "600 8px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.textAlign = "center";
    ctx.fillText("KESTREL MOTHER STATION", 0, 92);
    ctx.fillStyle = "rgba(255, 201, 104, 0.56)";
    ctx.font = "550 7px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.fillText("RELEASE ZONE / 释放区", 0, 103);
    ctx.textAlign = "left";
    ctx.restore();
  }

  drawCable(ctx, state, elapsed) {
    if (!state.attachedId) return;
    const debris = state.debris.find((item) => item.id === state.attachedId);
    if (!debris) return;
    const sx = state.ship.x - Math.cos(state.ship.angle) * 40;
    const sy = state.ship.y - Math.sin(state.ship.angle) * 40;
    const mx = (sx + debris.x) / 2 - Math.sin(state.ship.angle) * 12;
    const my = (sy + debris.y) / 2 + Math.cos(state.ship.angle) * 12;

    ctx.save();
    ctx.strokeStyle = "rgba(255, 201, 104, 0.17)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(mx, my, debris.x, debris.y);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 220, 145, 0.82)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = -elapsed * 28;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(mx, my, debris.x, debris.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffe5a7";
    ctx.beginPath();
    ctx.arc(debris.x, debris.y, 2.4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawDebris(ctx, debris, state, elapsed) {
    const isAttached = state.attachedId === debris.id;
    const isDelivered = debris.state === "delivered";
    const gap = distance(state.ship, debris);
    const inRange = debris.state === "free" && gap <= LIMITS.captureRange;
    const alpha = isDelivered ? 0.54 : 1;
    const color = debris.color;

    ctx.save();
    ctx.translate(debris.x, debris.y);
    ctx.globalAlpha = alpha;

    if (isAttached) {
      const pulse = 0.55 + Math.sin(elapsed * 6) * 0.25;
      ctx.strokeStyle = `rgba(255, 201, 104, ${pulse})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, debris.radius + 9, 0, TAU);
      ctx.stroke();
    } else if (inRange) {
      const pulse = 0.45 + Math.sin(elapsed * 5) * 0.2;
      ctx.strokeStyle = `rgba(106, 231, 255, ${pulse})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, debris.radius + 12, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(106, 231, 255, 0.8)";
      ctx.font = "600 7px 'SFMono-Regular', 'Noto Sans SC', monospace";
      ctx.textAlign = "center";
      ctx.fillText("[ E ]", 0, debris.radius + 21);
      ctx.textAlign = "left";
    }

    ctx.shadowColor = color;
    ctx.shadowBlur = isDelivered ? 4 : 12;
    ctx.rotate(debris.angle);
    ctx.strokeStyle = color;
    ctx.fillStyle = "rgba(8, 24, 32, 0.94)";
    ctx.lineWidth = 1.2;

    if (debris.type === "panel") {
      ctx.fillRect(-12, -7, 24, 14);
      ctx.strokeRect(-12, -7, 24, 14);
      ctx.beginPath();
      ctx.moveTo(-4, -7);
      ctx.lineTo(-4, 7);
      ctx.moveTo(4, -7);
      ctx.lineTo(4, 7);
      ctx.moveTo(-12, 0);
      ctx.lineTo(12, 0);
      ctx.stroke();
      ctx.fillStyle = "rgba(104, 213, 239, 0.24)";
      ctx.fillRect(-11, -6, 7, 5);
      ctx.fillRect(-11, 1, 7, 5);
      ctx.fillRect(5, -6, 6, 5);
    } else if (debris.type === "tank") {
      roundedRect(ctx, -8, -15, 16, 30, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillRect(-8, -5, 16, 2);
      ctx.fillRect(-8, 6, 16, 1);
      ctx.strokeStyle = "rgba(255, 201, 104, 0.35)";
      ctx.beginPath();
      ctx.moveTo(-12, -9);
      ctx.lineTo(-8, -9);
      ctx.moveTo(8, 9);
      ctx.lineTo(12, 9);
      ctx.stroke();
    } else if (debris.type === "truss") {
      ctx.fillRect(-18, -5, 36, 10);
      ctx.strokeRect(-18, -5, 36, 10);
      ctx.beginPath();
      for (let x = -13; x <= 13; x += 9) {
        ctx.moveTo(x, -5);
        ctx.lineTo(x + 5, 5);
        ctx.lineTo(x + 10, -5);
      }
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillRect(-20, -2, 4, 4);
      ctx.fillRect(16, -2, 4, 4);
    } else {
      ctx.beginPath();
      for (let index = 0; index < 8; index += 1) {
        const angle = index * (TAU / 8);
        const radius = index % 2 === 0 ? 20 : 14;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 3.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(184, 242, 162, ${0.35 + Math.sin(elapsed * 4) * 0.18})`;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, TAU);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = isDelivered ? "rgba(151, 242, 191, 0.74)" : "rgba(183, 229, 239, 0.68)";
    ctx.font = "550 7px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.textAlign = "center";
    const stateLabel = isDelivered ? "已交付" : isAttached ? "拖曳中" : `${debris.mass} kg`;
    ctx.fillText(stateLabel, debris.x, debris.y + debris.radius + 16);
    ctx.textAlign = "left";
    ctx.restore();
  }

  drawShip(ctx, state, elapsed, options) {
    const ship = state.ship;
    const thrusting = Math.abs(state.controls.thrust) > 0.05 && ship.fuel > 0 && options.status === "active";
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);

    if (thrusting) {
      const intensity = Math.abs(state.controls.thrust);
      const reverse = state.controls.thrust < 0;
      const flameX = reverse ? 17 : -17;
      const direction = reverse ? 1 : -1;
      const flame = ctx.createLinearGradient(flameX, 0, flameX + direction * (24 + intensity * 22), 0);
      flame.addColorStop(0, "rgba(231, 253, 255, 0.9)");
      flame.addColorStop(0.28, "rgba(106, 231, 255, 0.65)");
      flame.addColorStop(0.7, "rgba(63, 133, 255, 0.2)");
      flame.addColorStop(1, "rgba(63, 133, 255, 0)");
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.moveTo(flameX, -5);
      ctx.lineTo(flameX + direction * (18 + intensity * 22 + Math.sin(elapsed * 28) * 4), 0);
      ctx.lineTo(flameX, 5);
      ctx.closePath();
      ctx.fill();
    }

    ctx.shadowColor = "#6ae7ff";
    ctx.shadowBlur = 13;
    ctx.fillStyle = "#bfeaf2";
    ctx.strokeStyle = "#f0fdff";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.lineTo(9, -7);
    ctx.lineTo(-7, -8);
    ctx.lineTo(-13, -4);
    ctx.lineTo(-13, 4);
    ctx.lineTo(-7, 8);
    ctx.lineTo(9, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#103441";
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(4, -4);
    ctx.lineTo(-4, -3);
    ctx.lineTo(-5, 3);
    ctx.lineTo(3, 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(125, 232, 250, 0.5)";
    ctx.fillRect(-1, -2, 3, 2);

    ctx.fillStyle = "#ffc968";
    ctx.fillRect(-14, -3, 3, 6);
    ctx.fillStyle = "rgba(106, 231, 255, 0.42)";
    ctx.fillRect(10, -9, 4, 2);
    ctx.fillRect(10, 7, 4, 2);

    ctx.strokeStyle = "rgba(255, 201, 104, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-3, -8);
    ctx.lineTo(-16, -15);
    ctx.lineTo(-24, -13);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 201, 104, 0.75)";
    ctx.fillRect(-27, -14, 4, 3);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.58;
    ctx.strokeStyle = "rgba(106, 231, 255, 0.16)";
    ctx.lineWidth = 0.7;
    ctx.setLineDash([3, 8]);
    ctx.beginPath();
    ctx.arc(ship.x, ship.y, LIMITS.captureRange, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(166, 237, 248, 0.7)";
    ctx.font = "550 7px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.fillText("KESTREL-550", ship.x + 24, ship.y - 19);
    ctx.restore();
  }

  drawEffects(ctx, now) {
    this.effects = this.effects.filter((effect) => now - effect.start < effect.life);
    this.effects.forEach((effect) => {
      const phase = (now - effect.start) / effect.life;
      const alpha = 1 - phase;
      const radius = 16 + phase * (effect.type === "failure" ? 128 : 58);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = effect.type === "collision" || effect.type === "failure"
        ? "#ff6474"
        : effect.type === "capture" || effect.type === "wind"
          ? "#ffc968"
          : "#7bf0c1";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, radius, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = Math.min(1, alpha * 1.6);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = "600 8px 'SFMono-Regular', 'Noto Sans SC', monospace";
      ctx.textAlign = "center";
      ctx.fillText(effect.label, effect.x, effect.y - radius - 7);
      ctx.textAlign = "left";
      ctx.restore();
    });
  }

  drawWorldFrame(ctx, state, elapsed) {
    ctx.save();
    ctx.strokeStyle = "rgba(128, 222, 239, 0.13)";
    ctx.lineWidth = 1;
    const inset = 7;
    const corner = 22;
    const points = [
      [inset, inset, 1, 1],
      [WORLD.width - inset, inset, -1, 1],
      [inset, WORLD.height - inset, 1, -1],
      [WORLD.width - inset, WORLD.height - inset, -1, -1],
    ];
    points.forEach(([x, y, sx, sy]) => {
      ctx.beginPath();
      ctx.moveTo(x + sx * corner, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * corner);
      ctx.stroke();
    });

    ctx.fillStyle = "rgba(110, 179, 195, 0.43)";
    ctx.font = "550 7px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.fillText("LEO / 550 KM", 26, 26);
    ctx.textAlign = "right";
    ctx.fillText(`FIXED STEP 60 HZ  /  T+${state.time.toFixed(1)}s`, WORLD.width - 26, WORLD.height - 24);
    ctx.textAlign = "left";
    ctx.restore();
  }

  drawReplayTag(ctx, elapsed, options) {
    const width = this.width;
    ctx.save();
    ctx.font = "650 10px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = `rgba(255, 201, 104, ${0.65 + Math.sin(elapsed * 3) * 0.18})`;
    ctx.fillText(`TRAJECTORY REPLAY / ${options.replayLabel ?? "SEED 0550"}`, width / 2, 100);
    ctx.textAlign = "left";
    ctx.restore();
  }

  drawPaused(ctx, elapsed) {
    ctx.save();
    ctx.fillStyle = "rgba(2, 8, 13, 0.24)";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.translate(this.width / 2, this.height / 2);
    ctx.fillStyle = "rgba(4, 16, 24, 0.9)";
    ctx.strokeStyle = "rgba(106, 231, 255, 0.34)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(-98, -30, 196, 60);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#9decf8";
    ctx.font = "650 12px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.textAlign = "center";
    ctx.fillText("SIMULATION PAUSED", 0, -4);
    ctx.fillStyle = "rgba(134, 184, 197, 0.8)";
    ctx.font = "550 8px 'SFMono-Regular', 'Noto Sans SC', monospace";
    ctx.fillText("P 继续  /  . 单步  /  R 重置", 0, 14);
    ctx.textAlign = "left";
    ctx.strokeStyle = `rgba(106, 231, 255, ${0.15 + Math.sin(elapsed * 3) * 0.08})`;
    ctx.beginPath();
    ctx.moveTo(-150, 0);
    ctx.lineTo(-115, 0);
    ctx.moveTo(115, 0);
    ctx.lineTo(150, 0);
    ctx.stroke();
    ctx.restore();
  }

  drawDangerEdge(ctx, elapsed) {
    const pulse = 0.5 + Math.sin(elapsed * 5.8) * 0.5;
    ctx.save();
    const gradient = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      Math.min(this.width, this.height) * 0.28,
      this.width / 2,
      this.height / 2,
      Math.max(this.width, this.height) * 0.68,
    );
    gradient.addColorStop(0, "rgba(255, 45, 65, 0)");
    gradient.addColorStop(0.75, `rgba(255, 45, 65, ${0.02 + pulse * 0.025})`);
    gradient.addColorStop(1, `rgba(255, 45, 65, ${0.13 + pulse * 0.06})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  nearestFreeDebris(state) {
    return state.debris
      .filter((debris) => debris.state === "free")
      .map((debris) => ({ debris, gap: distance(state.ship, debris) }))
      .sort((a, b) => a.gap - b.gap)[0] ?? null;
  }

  isInTraffic(state, bands) {
    return bands.some((band) => bandDistance(state.ship, band) < band.width / 2);
  }
}
