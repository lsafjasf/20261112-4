function hash(seed) {
  let value = seed;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function roundedRect(ctx, x, y, width, height, radius) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
  return true;
}

export class SceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  draw(state, time, options = {}) {
    if (!this.width || !this.height) this.resize();
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const surfaceY = Math.round(h * 0.16);
    const seabedY = Math.round(h * 0.9);
    ctx.clearRect(0, 0, w, h);
    this.drawWater(ctx, w, h, surfaceY, seabedY, state, time);
    this.drawCurrents(ctx, w, surfaceY, seabedY, state, time);
    this.drawSeabed(ctx, w, h, seabedY, time);

    const margin = Math.max(26, w * 0.035);
    const gap = Math.max(10, w * 0.015);
    const cageWidth = (w - margin * 2 - gap * 2) / 3;
    const cageTop = surfaceY + 17;
    const cageBottom = seabedY - 14;
    state.cages.forEach((cage, index) => {
      const x = margin + index * (cageWidth + gap);
      this.drawCage(ctx, {
        cage,
        index,
        x,
        y: cageTop,
        width: cageWidth,
        height: cageBottom - cageTop,
        surfaceY,
        state,
        time,
        selected: options.selectedCage === cage.id
      });
    });
    this.drawSurface(ctx, w, surfaceY, state, time);
    this.drawHud(ctx, w, h, surfaceY, state, time);
  }

  drawWater(ctx, w, h, surfaceY, seabedY, state, time) {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, "#0b3d4d");
    gradient.addColorStop(0.28, "#082f3b");
    gradient.addColorStop(0.7, "#041f27");
    gradient.addColorStop(1, "#031419");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(w * 0.18, surfaceY - 20, 4, w * 0.18, surfaceY, w * 0.45);
    glow.addColorStop(0, "rgba(105, 214, 196, 0.16)");
    glow.addColorStop(1, "rgba(22, 96, 106, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w * 0.65, surfaceY + 80);

    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.strokeStyle = "#9ee8de";
    ctx.lineWidth = 1;
    for (let index = 0; index < 7; index += 1) {
      const x = w * (0.09 + index * 0.145) + Math.sin(time * 0.0002 + index) * 12;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 45, surfaceY);
      ctx.lineTo(x + 22, h * 0.52);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.35;
    for (let depth = 0; depth < 7; depth += 1) {
      const y = surfaceY + (seabedY - surfaceY) * (depth / 7);
      ctx.strokeStyle = depth === 6 ? "rgba(96, 170, 160, 0.13)" : "rgba(91, 167, 161, 0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(14, y);
      ctx.lineTo(w - 14, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawCurrents(ctx, w, surfaceY, seabedY, state, time) {
    const speed = state.tide.current;
    const strength = Math.min(1.7, 0.24 + speed * 0.58);
    const count = 18;
    ctx.save();
    for (let index = 0; index < count; index += 1) {
      const seed = hash(index + 17);
      const y = surfaceY + 10 + hash(index + 31) * (seabedY - surfaceY - 24);
      const drift = ((time * 0.035 * strength + index * 91) % (w + 140)) - 70;
      const length = 22 + seed * 74 * strength;
      const alpha = 0.06 + strength * 0.055;
      ctx.strokeStyle = `rgba(89, 199, 226, ${alpha})`;
      ctx.lineWidth = index % 4 === 0 ? 1.3 : 0.7;
      ctx.beginPath();
      ctx.moveTo(drift, y + Math.sin(time * 0.0012 + index) * 4);
      ctx.bezierCurveTo(
        drift + length * 0.35,
        y - 4,
        drift + length * 0.7,
        y + 4,
        drift + length,
        y + Math.sin(time * 0.001 + index * 0.7) * 3
      );
      ctx.stroke();
      if (index % 3 === 0) {
        ctx.beginPath();
        ctx.moveTo(drift + length, y);
        ctx.lineTo(drift + length - 5, y - 2);
        ctx.moveTo(drift + length, y);
        ctx.lineTo(drift + length - 5, y + 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawSurface(ctx, w, surfaceY, state, time) {
    ctx.save();
    const gradient = ctx.createLinearGradient(0, surfaceY - 9, 0, surfaceY + 35);
    gradient.addColorStop(0, "rgba(161, 238, 229, 0.45)");
    gradient.addColorStop(0.12, "rgba(89, 200, 194, 0.3)");
    gradient.addColorStop(1, "rgba(15, 68, 76, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, surfaceY - 8, w, 45);

    ctx.strokeStyle = "rgba(177, 241, 232, 0.45)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 5) {
      const wave =
        Math.sin(x * 0.026 + time * 0.0017) * (2.4 + state.tide.level * 1.8) +
        Math.sin(x * 0.011 - time * 0.0011) * 1.2;
      if (x === 0) ctx.moveTo(x, surfaceY + wave);
      else ctx.lineTo(x, surfaceY + wave);
    }
    ctx.stroke();

    const foam = ctx.createLinearGradient(0, surfaceY - 4, 0, surfaceY + 22);
    foam.addColorStop(0, "rgba(7, 28, 34, 0.1)");
    foam.addColorStop(1, "rgba(2, 14, 19, 0.58)");
    ctx.fillStyle = "rgba(4, 23, 29, 0.16)";
    ctx.fillRect(0, surfaceY + 11, w, 7);
    ctx.restore();
  }

  drawSeabed(ctx, w, h, seabedY, time) {
    const gradient = ctx.createLinearGradient(0, seabedY - 20, 0, h);
    gradient.addColorStop(0, "rgba(20, 43, 38, 0)");
    gradient.addColorStop(0.4, "rgba(24, 41, 34, 0.72)");
    gradient.addColorStop(1, "rgba(13, 28, 24, 0.96)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, seabedY - 26, w, h - seabedY + 26);

    ctx.save();
    ctx.strokeStyle = "rgba(100, 149, 119, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x += 18) {
      const y = seabedY + Math.sin(x * 0.025) * 3 + Math.sin(x * 0.08) * 1.5;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    const rockSeeds = [0.08, 0.17, 0.34, 0.48, 0.68, 0.83, 0.91];
    rockSeeds.forEach((ratio, index) => {
      const x = ratio * w;
      const size = 6 + hash(index + 8) * 15;
      ctx.fillStyle = "rgba(36, 65, 52, 0.62)";
      ctx.beginPath();
      ctx.ellipse(x, seabedY + 6, size * 1.8, size * 0.6, -0.1, Math.PI, Math.PI * 2);
      ctx.fill();
    });
  }

  drawCage(ctx, options) {
    const { cage, index, x, y, width, height, surfaceY, state, time, selected } = options;
    if (width < 20 || height < 20) return;
    const innerX = x + 6;
    const innerY = y;
    const innerW = width - 12;
    const innerH = height;
    const danger = cage.tear;
    const healthLow = cage.health < 66;
    const pollutionAlpha = Math.min(0.26, 0.03 + cage.pollution / 480);
    const seed = index * 19 + 7;

    ctx.save();
    roundedRect(ctx, x - 3, y - 10, width + 6, height + 14, 13);
    const back = ctx.createLinearGradient(0, y, 0, y + height);
    back.addColorStop(0, danger ? "rgba(103, 38, 42, 0.2)" : "rgba(30, 91, 95, 0.15)");
    back.addColorStop(1, "rgba(5, 30, 35, 0.28)");
    ctx.fillStyle = back;
    ctx.fill();

    if (selected) {
      ctx.strokeStyle = "rgba(109, 239, 204, 0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    roundedRect(ctx, innerX, innerY, innerW, innerH, 11);
    ctx.clip();

    const water = ctx.createLinearGradient(0, innerY, 0, innerY + innerH);
    water.addColorStop(0, "rgba(48, 135, 140, 0.08)");
    water.addColorStop(0.55, "rgba(8, 50, 56, 0.1)");
    water.addColorStop(1, "rgba(7, 28, 31, 0.24)");
    ctx.fillStyle = water;
    ctx.fillRect(innerX, innerY, innerW, innerH);

    this.drawPollution(ctx, cage, innerX, innerY, innerW, innerH, pollutionAlpha, time, seed);
    this.drawNet(ctx, cage, innerX, innerY, innerW, innerH, time, seed);
    this.drawFouling(ctx, cage, innerX, innerY, innerW, innerH, seed);
    this.drawFish(ctx, cage, innerX, innerY, innerW, innerH, time, seed, healthLow);
    if (cage.aerator) this.drawBubbles(ctx, cage, innerX, innerY, innerW, innerH, time, seed);
    if (cage.tear) this.drawTear(ctx, innerX, innerY, innerW, innerH, time);
    ctx.restore();

    this.drawCageFrame(ctx, cage, x, y, width, height, surfaceY, time);
    this.drawCageLabel(ctx, cage, x, y, width, state);
    this.drawFeedBoat(ctx, cage, state, x, surfaceY, width, time);
  }

  drawNet(ctx, cage, x, y, width, height, time, seed) {
    const mesh = 18;
    const sway = Math.sin(time * 0.001 + seed) * 1.3 + Math.min(2.1, cage.fouling / 50);
    ctx.save();
    ctx.strokeStyle = cage.tear ? "rgba(205, 127, 112, 0.34)" : "rgba(134, 196, 178, 0.3)";
    ctx.lineWidth = 0.75;
    for (let gx = x; gx <= x + width; gx += mesh) {
      ctx.beginPath();
      ctx.moveTo(gx, y);
      ctx.quadraticCurveTo(gx + sway, y + height * 0.5, gx + sway * 0.5, y + height);
      ctx.stroke();
    }
    for (let gy = y + 5; gy <= y + height; gy += mesh) {
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.quadraticCurveTo(x + width * 0.5, gy + sway * 0.35, x + width, gy);
      ctx.stroke();
    }
    ctx.strokeStyle = cage.tear ? "rgba(255, 112, 113, 0.58)" : "rgba(154, 216, 196, 0.58)";
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    ctx.moveTo(x, y + 1);
    ctx.quadraticCurveTo(x + width * 0.5, y + sway * 0.7, x + width, y + 1);
    ctx.stroke();
    ctx.restore();
  }

  drawPollution(ctx, cage, x, y, width, height, alpha, time, seed) {
    const haze = ctx.createLinearGradient(0, y + height * 0.35, 0, y + height);
    haze.addColorStop(0, "rgba(153, 105, 54, 0)");
    haze.addColorStop(0.65, `rgba(129, 91, 53, ${alpha * 0.55})`);
    haze.addColorStop(1, `rgba(111, 80, 48, ${alpha})`);
    ctx.fillStyle = haze;
    ctx.fillRect(x, y + height * 0.25, width, height * 0.75);

    const particleCount = Math.round(cage.pollution * 0.3);
    ctx.save();
    for (let index = 0; index < particleCount; index += 1) {
      const px = x + hash(seed + index * 3) * width;
      const baseY = y + height * 0.4 + hash(seed + index * 5 + 1) * height * 0.55;
      const py = baseY + Math.sin(time * 0.0007 + index) * 3;
      const r = 0.6 + hash(seed + index) * 1.3;
      ctx.fillStyle = `rgba(199, 147, 87, ${0.08 + alpha * 0.35})`;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawFouling(ctx, cage, x, y, width, height, seed) {
    const clusters = Math.round(cage.fouling * 0.45);
    ctx.save();
    for (let index = 0; index < clusters; index += 1) {
      const edge = hash(seed + index * 13) > 0.5 ? x + 2 : x + width - 2;
      const py = y + 10 + hash(seed + index * 17 + 2) * (height - 20);
      const size = 1.8 + hash(seed + index * 23) * 3.8;
      ctx.fillStyle = index % 3 === 0 ? "rgba(135, 151, 71, 0.52)" : "rgba(77, 119, 66, 0.42)";
      ctx.beginPath();
      ctx.ellipse(edge, py, size, size * 1.8, 0.45, 0, Math.PI * 2);
      ctx.fill();
      if (index % 5 === 0) {
        ctx.strokeStyle = "rgba(142, 162, 88, 0.38)";
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(edge, py);
        ctx.quadraticCurveTo(edge + (edge < x + width / 2 ? 5 : -5), py - 5, edge + (edge < x + width / 2 ? 3 : -3), py - 9);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawFish(ctx, cage, x, y, width, height, time, seed, healthLow) {
    const visible = Math.max(4, Math.round(13 - (100 - cage.health) * 0.08));
    ctx.save();
    for (let index = 0; index < visible; index += 1) {
      const direction = index % 2 === 0 ? 1 : -1;
      const speed = 0.00035 + hash(seed + index) * 0.00028;
      const phase = hash(seed + index * 3 + 4) * Math.PI * 2;
      const travel = ((time * speed + phase) % (Math.PI * 2));
      const fx = x + width * 0.5 + Math.sin(travel) * (width * 0.32);
      const fy = y + height * (0.28 + hash(seed + index * 7) * 0.52) + Math.sin(time * 0.001 + index) * 3;
      const size = 2.2 + hash(seed + index * 11) * 2.2;
      const alpha = healthLow ? 0.42 : 0.72;
      ctx.translate(fx, fy);
      ctx.scale(direction, 1);
      ctx.fillStyle = cage.tear
        ? `rgba(233, 152, 104, ${alpha})`
        : healthLow
          ? `rgba(180, 180, 133, ${alpha})`
          : `rgba(143, 223, 210, ${alpha})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 1.5, size * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-size * 1.25, 0);
      ctx.lineTo(-size * 2.1, -size * 0.58);
      ctx.lineTo(-size * 2.1, size * 0.58);
      ctx.closePath();
      ctx.fill();
      if (size > 3) {
        ctx.fillStyle = "rgba(4, 22, 25, 0.85)";
        ctx.beginPath();
        ctx.arc(size * 0.78, -size * 0.08, 0.65, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    if (cage.tear) {
      for (let index = 0; index < 4; index += 1) {
        const fx = x + width * 0.8 + hash(seed + index) * width * 0.4;
        const fy = y + height * (0.4 + hash(seed + index + 20) * 0.25);
        ctx.save();
        ctx.globalAlpha = 0.52;
        ctx.fillStyle = "#f2b07a";
        ctx.beginPath();
        ctx.ellipse(fx, fy, 4.2, 1.7, -0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  drawBubbles(ctx, cage, x, y, width, height, time, seed) {
    ctx.save();
    for (let index = 0; index < 18; index += 1) {
      const phase = (time * (0.00012 + hash(seed + index) * 0.00008) + hash(seed + index * 7)) % 1;
      const by = y + height - phase * height * 0.85;
      const bx = x + width * 0.5 + Math.sin(phase * 15 + index) * (8 + index * 0.5);
      const radius = 0.8 + hash(seed + index * 3) * 1.8;
      ctx.strokeStyle = `rgba(177, 248, 236, ${0.32 + phase * 0.35})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.arc(bx, by, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(166, 245, 232, 0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + width * 0.35, y + height - 4);
    ctx.lineTo(x + width * 0.65, y + height - 4);
    ctx.stroke();
    ctx.restore();
  }

  drawTear(ctx, x, y, width, height, time) {
    const tearX = x + width * 0.72;
    const tearY = y + height * 0.53;
    ctx.save();
    const glow = ctx.createRadialGradient(tearX, tearY, 0, tearX, tearY, 42);
    glow.addColorStop(0, "rgba(255, 77, 82, 0.25)");
    glow.addColorStop(1, "rgba(255, 77, 82, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(tearX - 45, tearY - 45, 90, 90);
    ctx.strokeStyle = `rgba(255, 137, 118, ${0.65 + Math.sin(time * 0.006) * 0.18})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(tearX - 12, tearY - 22);
    ctx.lineTo(tearX - 2, tearY - 8);
    ctx.lineTo(tearX - 9, tearY + 2);
    ctx.lineTo(tearX + 4, tearY + 17);
    ctx.lineTo(tearX - 2, tearY + 29);
    ctx.stroke();
    ctx.restore();
  }

  drawCageFrame(ctx, cage, x, y, width, height, surfaceY, time) {
    ctx.save();
    ctx.strokeStyle = "rgba(165, 225, 210, 0.55)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.lineTo(x + width, y + height);
    ctx.lineTo(x, y + height);
    ctx.closePath();
    ctx.stroke();

    const floatY = y - 5;
    const floatCount = Math.max(5, Math.round(width / 34));
    for (let index = 0; index <= floatCount; index += 1) {
      const fx = x + (width * index) / floatCount;
      const bob = Math.sin(time * 0.0017 + index * 0.75) * 1.3;
      ctx.fillStyle = cage.tear ? "rgba(202, 100, 84, 0.86)" : "rgba(195, 217, 165, 0.74)";
      ctx.beginPath();
      ctx.ellipse(fx, floatY + bob, 5.5, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(114, 173, 160, 0.28)";
      ctx.beginPath();
      ctx.moveTo(fx, floatY + 2);
      ctx.lineTo(fx, y + 2);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(91, 135, 123, 0.68)";
    ctx.fillRect(x + width * 0.47, y + height, 5, 11);
    ctx.fillStyle = "rgba(56, 88, 78, 0.8)";
    ctx.fillRect(x + width * 0.42, y + height + 10, width * 0.16, 4);

    if (cage.aerator) {
      ctx.fillStyle = "rgba(115, 240, 211, 0.52)";
      ctx.beginPath();
      ctx.arc(x + width * 0.5, y + height - 4, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawCageLabel(ctx, cage, x, y, width, state) {
    const alarm = cage.tear;
    const labelX = x + 8;
    const labelY = y + 10;
    const labelW = width - 16;
    ctx.save();
    roundedRect(ctx, labelX, labelY, labelW, 35, 5);
    ctx.fillStyle = alarm ? "rgba(69, 20, 25, 0.79)" : "rgba(4, 23, 29, 0.72)";
    ctx.fill();
    ctx.strokeStyle = alarm ? "rgba(255, 116, 124, 0.38)" : "rgba(117, 215, 195, 0.13)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "rgba(231, 250, 245, 0.92)";
    ctx.font = '600 10px "Tide Sans CJK", "PingFang SC", sans-serif';
    ctx.fillText(cage.name, labelX + 8, labelY + 14);
    ctx.fillStyle = alarm ? "#ff989c" : "rgba(117, 187, 175, 0.75)";
    ctx.font = '8px "SFMono-Regular", monospace';
    ctx.fillText(alarm ? "NET BROKEN" : cage.aerator ? "PUMP ON" : "PUMP OFF", labelX + 8, labelY + 26);

    const healthX = labelX + labelW - 8;
    ctx.textAlign = "right";
    ctx.fillStyle = cage.health < 66 ? "#ffb26f" : "#72e9c8";
    ctx.font = '500 12px "SFMono-Regular", monospace';
    ctx.fillText(cage.health.toFixed(1), healthX, labelY + 15);
    ctx.fillStyle = "rgba(117, 174, 164, 0.68)";
    ctx.font = '7px "SFMono-Regular", monospace';
    ctx.fillText(`DO ${cage.oxygen.toFixed(1)}  ·  ${cage.pollution.toFixed(1)}`, healthX, labelY + 27);
    ctx.restore();
  }

  drawFeedBoat(ctx, cage, state, x, surfaceY, width, time) {
    const job = state.pending.find((item) => item.type === "feed" && item.cageId === cage.id);
    if (!job) return;
    const total = Math.max(1, job.dueAt - job.issuedAt);
    const progress = Math.min(1, (state.tick - job.issuedAt) / total);
    const boatX = x + width * 0.25 + Math.sin(progress * Math.PI * 0.8) * width * 0.38;
    const boatY = surfaceY - 5 + Math.sin(time * 0.002 + cage.id) * 1.2;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 208, 131, 0.44)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(boatX, boatY + 4);
    ctx.quadraticCurveTo(boatX + width * 0.18, boatY + 20, x + width * 0.5, surfaceY + 18);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#d8a35f";
    ctx.beginPath();
    ctx.moveTo(boatX - 15, boatY);
    ctx.lineTo(boatX + 16, boatY);
    ctx.lineTo(boatX + 11, boatY + 7);
    ctx.lineTo(boatX - 10, boatY + 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#e8f0cc";
    ctx.fillRect(boatX - 5, boatY - 7, 9, 7);
    ctx.strokeStyle = "rgba(232, 246, 232, 0.75)";
    ctx.beginPath();
    ctx.moveTo(boatX - 1, boatY - 7);
    ctx.lineTo(boatX - 1, boatY - 16);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 212, 139, 0.22)";
    ctx.beginPath();
    ctx.ellipse(boatX, boatY + 9, 18, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawHud(ctx, w, h, surfaceY, state, time) {
    ctx.save();
    ctx.fillStyle = "rgba(136, 194, 183, 0.42)";
    ctx.font = '7px "SFMono-Regular", monospace';
    ctx.fillText("DEPTH / m", 16, h - 17);
    ctx.strokeStyle = "rgba(114, 181, 169, 0.2)";
    ctx.lineWidth = 1;
    for (let index = 0; index < 5; index += 1) {
      const y = surfaceY + 16 + ((h - surfaceY - 40) * index) / 4;
      const tick = index % 2 === 0 ? 8 : 4;
      ctx.beginPath();
      ctx.moveTo(15, y);
      ctx.lineTo(15 + tick, y);
      ctx.stroke();
      if (index % 2 === 0) {
        ctx.fillStyle = "rgba(128, 177, 168, 0.34)";
        ctx.fillText(`${index * 2}`, 27, y + 2);
      }
    }

    if (state.observation?.active) {
      const fraction = 1 - state.observation.ticksRemaining / (state.observation.endTick - state.observation.startTick);
      ctx.strokeStyle = "rgba(101, 236, 203, 0.18)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 8]);
      ctx.strokeRect(9, 7, w - 18, h - 14);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(101, 236, 203, 0.7)";
      ctx.fillRect(9, h - 9, (w - 18) * fraction, 2);
    }

    ctx.translate(w - 17, h - 15);
    ctx.strokeStyle = "rgba(99, 198, 222, 0.45)";
    ctx.beginPath();
    ctx.moveTo(-24, 0);
    ctx.lineTo(0, 0);
    ctx.moveTo(-4, -3);
    ctx.lineTo(0, 0);
    ctx.lineTo(-4, 3);
    ctx.stroke();
    ctx.restore();
  }
}
