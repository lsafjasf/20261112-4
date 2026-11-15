import { FLOCKS, ZONE_NAMES, coverageRadius, getWind } from "./core.js";

const LOGICAL_WIDTH = 1040;
const LOGICAL_HEIGHT = 650;
const ZONE_X = [186, 520, 854];
const FLOCK_Y = [276, 304, 338];
const FONT_MONO = "'SFMono-Regular', 'Noto Sans SC', monospace";
const FONT_SANS = "'Noto Sans SC', sans-serif";

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, r);
}

function drawBird(ctx, x, y, size, flap, color, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, size * 0.16);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-size, flap * size * 0.48);
  ctx.quadraticCurveTo(-size * 0.42, -flap * size * 0.14, 0, size * 0.08);
  ctx.quadraticCurveTo(size * 0.42, -flap * size * 0.14, size, flap * size * 0.48);
  ctx.stroke();
  ctx.restore();
}

function star(ctx, x, y, radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

export class CoastRenderer {
  constructor(canvas, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.getState = options.getState;
    this.getSelected = options.getSelected;
    this.onDeviceClick = options.onDeviceClick;
    this.onZoneClick = options.onZoneClick;
    this.pointer = { x: 0, y: 0, inside: false };
    this.deviceHits = [];
    this.animationFrame = null;
    this.lastFrame = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
    this.bindPointer();
    this.loop = this.loop.bind(this);
    this.animationFrame = requestAnimationFrame(this.loop);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.scale = Math.min(this.canvas.width / LOGICAL_WIDTH, this.canvas.height / LOGICAL_HEIGHT);
    this.offsetX = (this.canvas.width - LOGICAL_WIDTH * this.scale) / 2;
    this.offsetY = (this.canvas.height - LOGICAL_HEIGHT * this.scale) / 2;
    this.cssScale = rect.width / Math.max(1, this.canvas.width);
  }

  bindPointer() {
    this.canvas.addEventListener("pointermove", (event) => {
      const point = this.toLogical(event);
      this.pointer = { ...point, inside: true };
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.pointer.inside = false;
    });
    this.canvas.addEventListener("click", (event) => {
      const point = this.toLogical(event);
      const deviceHit = this.deviceHits.find(
        (hit) => Math.hypot(point.x - hit.x, point.y - hit.y) < hit.radius,
      );
      if (deviceHit) {
        this.onDeviceClick?.(deviceHit.device.id);
        return;
      }
      const zone = this.zoneAt(point);
      if (zone !== null) this.onZoneClick?.(zone);
    });
  }

  toLogical(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) * (this.canvas.width / rect.width) - this.offsetX) / this.scale;
    const y = ((event.clientY - rect.top) * (this.canvas.height / rect.height) - this.offsetY) / this.scale;
    return { x, y };
  }

  zoneAt(point) {
    const threshold = 148;
    let bestZone = null;
    let bestDistance = threshold;
    for (let zone = 0; zone < ZONE_X.length; zone += 1) {
      const distance = Math.abs(point.x - ZONE_X[zone]);
      if (distance < bestDistance && point.y > 120) {
        bestZone = zone;
        bestDistance = distance;
      }
    }
    return bestZone;
  }

  loop(timestamp) {
    const state = this.getState();
    const delta = timestamp - this.lastFrame;
    this.lastFrame = timestamp;
    this.draw(state, timestamp / 1000, delta);
    this.animationFrame = requestAnimationFrame(this.loop);
  }

  drawBackground(ctx, time) {
    const sea = ctx.createLinearGradient(0, 0, 0, LOGICAL_HEIGHT);
    sea.addColorStop(0, "#05161f");
    sea.addColorStop(0.42, "#0a2631");
    sea.addColorStop(0.75, "#0a2a32");
    sea.addColorStop(1, "#061a21");
    ctx.fillStyle = sea;
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    const glow = ctx.createRadialGradient(650, 60, 0, 650, 60, 470);
    glow.addColorStop(0, "rgba(70, 173, 164, 0.16)");
    glow.addColorStop(0.55, "rgba(34, 105, 117, 0.06)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, LOGICAL_WIDTH, 500);

    ctx.save();
    ctx.strokeStyle = "rgba(112, 206, 194, 0.06)";
    ctx.lineWidth = 1;
    for (let x = -40; x <= LOGICAL_WIDTH + 40; x += 74) {
      ctx.beginPath();
      ctx.moveTo(x, 100);
      ctx.lineTo(x + 100, 430);
      ctx.stroke();
    }
    for (let y = 100; y < 410; y += 58) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(LOGICAL_WIDTH, y - 20);
      ctx.stroke();
    }
    ctx.restore();

    for (let index = 0; index < 38; index += 1) {
      const x = ((index * 223 + time * 4) % (LOGICAL_WIDTH + 100)) - 50;
      const y = 88 + ((index * 71) % 290);
      const alpha = 0.08 + (index % 4) * 0.025;
      ctx.fillStyle = `rgba(180, 235, 229, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, 1 + (index % 2), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.strokeStyle = "rgba(126, 213, 203, 0.075)";
    ctx.lineWidth = 1.1;
    for (let wave = 0; wave < 9; wave += 1) {
      const y = 184 + wave * 27;
      ctx.beginPath();
      for (let x = -20; x <= LOGICAL_WIDTH + 20; x += 16) {
        const waveY = y + Math.sin(x * 0.021 + time * 0.65 + wave) * 3.4;
        if (x === -20) ctx.moveTo(x, waveY);
        else ctx.lineTo(x, waveY);
      }
      ctx.stroke();
    }
    ctx.restore();

    this.drawCoast(ctx, time);
  }

  drawCoast(ctx, time) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-10, 650);
    ctx.lineTo(-10, 470);
    ctx.bezierCurveTo(150, 434, 234, 456, 350, 440);
    ctx.bezierCurveTo(438, 425, 477, 400, 548, 421);
    ctx.bezierCurveTo(654, 451, 725, 412, 845, 428);
    ctx.bezierCurveTo(930, 438, 988, 463, 1050, 452);
    ctx.lineTo(1050, 650);
    ctx.closePath();
    const land = ctx.createLinearGradient(0, 420, 0, 650);
    land.addColorStop(0, "#102f35");
    land.addColorStop(0.35, "#0d282d");
    land.addColorStop(1, "#071c23");
    ctx.fillStyle = land;
    ctx.fill();

    ctx.strokeStyle = "rgba(133, 215, 197, 0.34)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-10, 470);
    ctx.bezierCurveTo(150, 434, 234, 456, 350, 440);
    ctx.bezierCurveTo(438, 425, 477, 400, 548, 421);
    ctx.bezierCurveTo(654, 451, 725, 412, 845, 428);
    ctx.bezierCurveTo(930, 438, 988, 463, 1050, 452);
    ctx.stroke();

    ctx.strokeStyle = "rgba(215, 196, 136, 0.24)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-10, 476);
    ctx.bezierCurveTo(150, 440, 234, 462, 350, 446);
    ctx.bezierCurveTo(438, 431, 477, 406, 548, 427);
    ctx.bezierCurveTo(654, 457, 725, 418, 845, 434);
    ctx.bezierCurveTo(930, 444, 988, 469, 1050, 458);
    ctx.stroke();

    for (let index = 0; index < 18; index += 1) {
      const x = (index * 139 + 42) % LOGICAL_WIDTH;
      const y = 472 + (index % 6) * 19;
      ctx.fillStyle = "rgba(157, 195, 180, 0.14)";
      ctx.beginPath();
      ctx.ellipse(x, y, 8 + (index % 3) * 4, 1.5, -0.12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    for (let zone = 0; zone < 3; zone += 1) {
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(195, 225, 218, 0.5)";
      ctx.font = `600 11px ${FONT_MONO}`;
      ctx.letterSpacing = "2px";
      ctx.fillText(`0${zone + 1} · ${ZONE_NAMES[zone]}`, ZONE_X[zone], 594);
      ctx.strokeStyle = "rgba(126, 205, 194, 0.13)";
      ctx.beginPath();
      ctx.moveTo(ZONE_X[zone], 100);
      ctx.lineTo(ZONE_X[zone], 470);
      ctx.setLineDash([2, 7]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    this.drawStation(ctx, time);
  }

  drawStation(ctx, time) {
    const x = ZONE_X[1];
    const y = 476;
    ctx.save();
    ctx.fillStyle = "rgba(7, 22, 28, 0.92)";
    roundedRect(ctx, x - 55, y - 16, 110, 35, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(143, 225, 211, 0.24)";
    ctx.stroke();
    ctx.fillStyle = "rgba(84, 231, 195, 0.74)";
    ctx.fillRect(x - 44, y - 4, 32, 2);
    ctx.fillRect(x - 44, y + 3, 20, 2);
    ctx.fillStyle = "rgba(255, 199, 107, 0.6)";
    ctx.beginPath();
    ctx.arc(x + 39, y - 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `8px ${FONT_MONO}`;
    ctx.fillStyle = "rgba(197, 226, 220, 0.48)";
    ctx.textAlign = "center";
    ctx.fillText("WATCH STATION 07", x, y + 13);
    ctx.strokeStyle = "rgba(155, 211, 201, 0.16)";
    ctx.beginPath();
    ctx.moveTo(x + 39, y - 5);
    ctx.lineTo(x + 39, y - 48);
    ctx.stroke();
    ctx.restore();
  }

  drawLights(ctx, state, time) {
    if (!state.lightsOn) return;
    const x = ZONE_X[1] + 39;
    const y = 428;
    ctx.save();
    const cone = ctx.createLinearGradient(x, y, x, 135);
    cone.addColorStop(0, "rgba(255, 214, 125, 0.28)");
    cone.addColorStop(0.65, "rgba(255, 199, 107, 0.09)");
    cone.addColorStop(1, "rgba(255, 199, 107, 0)");
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(x - 8, y);
    ctx.lineTo(x - 125, 132);
    ctx.lineTo(x + 130, 132);
    ctx.lineTo(x + 8, y);
    ctx.closePath();
    ctx.fill();
    const pulse = 0.66 + Math.sin(time * 3.1) * 0.15;
    ctx.fillStyle = `rgba(255, 220, 145, ${pulse})`;
    ctx.shadowColor = "#ffc76b";
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(x, y - 3, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawWind(ctx, state, time) {
    const wind = state.wind;
    if (wind <= 0) return;
    ctx.save();
    ctx.strokeStyle = `rgba(157, 215, 209, ${0.06 + wind * 0.026})`;
    ctx.lineWidth = 0.8 + wind * 0.16;
    ctx.lineCap = "round";
    for (let index = 0; index < 11; index += 1) {
      const offset = (time * (18 + wind * 10) + index * 133) % 1250;
      const x = LOGICAL_WIDTH - offset + 70;
      const y = 120 + ((index * 59) % 260);
      const length = 26 + wind * 12 + (index % 3) * 8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + length * 0.55, y - 4, x + length, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  devicePosition(device, state) {
    const zone = device.queuedZone ?? device.zone;
    const recorders = Object.values(state.devices)
      .filter((item) => item.kind === "recorder" && item.zone === device.zone)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (device.kind === "drone") {
      return { x: ZONE_X[zone], y: 352 };
    }
    const index = recorders.findIndex((item) => item.id === device.id);
    return { x: ZONE_X[device.zone] + (index - (recorders.length - 1) / 2) * 34, y: 506 };
  }

  drawCoverage(ctx, state) {
    const selected = this.getSelected();
    for (const device of Object.values(state.devices)) {
      const position = this.devicePosition(device, state);
      const radius = coverageRadius(device) * (device.kind === "drone" ? 278 : 320);
      const isSelected = selected === device.id;
      const color = device.kind === "drone" ? "115, 210, 255" : "84, 231, 195";
      const alpha = isSelected ? 0.17 : 0.065;
      ctx.save();
      ctx.setLineDash(device.kind === "drone" ? [5, 6] : []);
      ctx.strokeStyle = `rgba(${color}, ${isSelected ? 0.62 : 0.22})`;
      ctx.lineWidth = isSelected ? 1.3 : 0.75;
      ctx.fillStyle = `rgba(${color}, ${alpha})`;
      ctx.beginPath();
      ctx.ellipse(
        position.x,
        Math.min(456, position.y - 28),
        radius,
        radius * 0.5,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.stroke();
      if (isSelected) {
        ctx.setLineDash([]);
        ctx.strokeStyle = `rgba(${color}, 0.12)`;
        ctx.beginPath();
        ctx.ellipse(
          position.x,
          Math.min(456, position.y - 28),
          radius * 0.62,
          radius * 0.31,
          0,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawMovePreview(ctx, state, time) {
    for (const device of Object.values(state.devices)) {
      if (device.queuedZone === null) continue;
      const from = this.devicePosition(device, state);
      const toX = ZONE_X[device.queuedZone];
      const toY = device.kind === "drone" ? 352 : 506;
      ctx.save();
      ctx.setLineDash([4, 6]);
      ctx.lineDashOffset = -time * 18;
      ctx.strokeStyle = "rgba(255, 199, 107, 0.62)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo((from.x + toX) / 2, Math.min(from.y, toY) - 45, toX, toY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255, 199, 107, 0.08)";
      ctx.strokeStyle = "rgba(255, 199, 107, 0.45)";
      ctx.beginPath();
      ctx.ellipse(toX, toY + 17, 31, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffc76b";
      ctx.font = `8px ${FONT_MONO}`;
      ctx.textAlign = "center";
      ctx.fillText("下一段落点", toX, toY + 38);
      ctx.restore();
    }
  }

  drawTracks(ctx, state, time) {
    const valid = Object.entries(state.tracks.valid);
    for (let trackIndex = 0; trackIndex < valid.length; trackIndex += 1) {
      const [flockId, track] = valid[trackIndex];
      const flockSpec = FLOCKS.find((flock) => flock.id === flockId);
      const flockIndex = FLOCKS.findIndex((flock) => flock.id === flockId);
      const points = [];
      const start = Math.max(0, track.tick - 4);
      for (let routeIndex = start; routeIndex <= track.tick; routeIndex += 1) {
        const routeZone = flockSpec.route[Math.min(routeIndex, flockSpec.route.length - 1)];
        points.push({
          x: ZONE_X[routeZone] + (routeIndex - track.tick) * 10,
          y: FLOCK_Y[flockIndex] + routeIndex * 2.2,
        });
      }
      points.push({ x: ZONE_X[track.zone], y: FLOCK_Y[flockIndex] });
      if (points.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = flockSpec.color;
      ctx.lineWidth = 1.55;
      ctx.globalAlpha = 0.75;
      ctx.shadowColor = flockSpec.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = flockSpec.color;
      points.forEach((point, index) => {
        if (index === points.length - 1 || index % 2 === 0) {
          ctx.beginPath();
          ctx.arc(point.x, point.y, index === points.length - 1 ? 2.5 : 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      const labelX = points[0].x;
      const labelY = points[0].y - 12;
      ctx.globalAlpha = 0.82;
      ctx.font = `7px ${FONT_MONO}`;
      ctx.textAlign = "left";
      ctx.fillStyle = flockSpec.color;
      ctx.fillText(`TRK-${trackIndex + 1}  ${track.quality.toFixed(1)}dB`, labelX, labelY);
      ctx.restore();
    }
  }

  drawDevice(ctx, state, device, time) {
    const position = this.devicePosition(device, state);
    const selected = this.getSelected() === device.id;
    const isDrone = device.kind === "drone";
    const color = isDrone ? "#73d2ff" : "#54e7c3";
    const warning = device.status === "offline" || device.status === "low-power";
    const outline = warning ? "#ff8d78" : color;
    const bob = isDrone ? Math.sin(time * 1.8 + device.zone) * 4 : 0;
    const y = position.y + bob;

    ctx.save();
    if (selected) {
      ctx.strokeStyle = `${outline}88`;
      ctx.lineWidth = 1.1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(position.x, y, 27 + Math.sin(time * 2.5) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = "rgba(4, 17, 22, 0.92)";
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(position.x, y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (isDrone) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(position.x - 7, y - 5);
      ctx.lineTo(position.x + 7, y + 5);
      ctx.moveTo(position.x + 7, y - 5);
      ctx.lineTo(position.x - 7, y + 5);
      ctx.stroke();
      ctx.fillStyle = "rgba(115, 210, 255, 0.15)";
      [ -7, 7 ].forEach((offsetX) => {
        [ -5, 5 ].forEach((offsetY) => {
          ctx.beginPath();
          ctx.arc(position.x + offsetX, y + offsetY, 2.8, 0, Math.PI * 2);
          ctx.fill();
        });
      });
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(position.x, y - 7);
      ctx.lineTo(position.x, y + 1);
      ctx.moveTo(position.x - 5, y - 2);
      ctx.lineTo(position.x - 5, y + 5);
      ctx.moveTo(position.x + 5, y - 2);
      ctx.lineTo(position.x + 5, y + 5);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillRect(position.x - 8, y + 4, 16, 3);
    }

    if (device.settling) {
      ctx.strokeStyle = "rgba(255, 199, 107, 0.55)";
      ctx.beginPath();
      ctx.arc(position.x, y, 18 + (time * 14) % 10, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = selected ? "#f2fffb" : "rgba(221, 239, 235, 0.82)";
    ctx.font = `${selected ? "600" : "500"} 8px ${FONT_MONO}`;
    ctx.textAlign = "center";
    ctx.fillText(device.id, position.x, y + 28);
    if (selected) {
      ctx.fillStyle = "rgba(152, 186, 181, 0.75)";
      ctx.font = `7px ${FONT_MONO}`;
      ctx.fillText(`${device.battery.toFixed(0)}% · ${device.power}W`, position.x, y + 38);
    }
    ctx.restore();
    this.deviceHits.push({
      device,
      x: position.x,
      y,
      radius: 22,
    });
  }

  drawFlock(ctx, state, flockSpec, time, flockIndex) {
    const flock = state.flocks[flockSpec.id];
    const baseX = ZONE_X[flock.zone];
    const baseY = FLOCK_Y[flockIndex];
    const drift = Math.sin(time * 0.7 + flockIndex * 1.8) * 12;
    const x = baseX + drift;
    const y = baseY + Math.cos(time * 0.8 + flockIndex) * 4;
    const flap = 0.5 + Math.sin(time * 4.2 + flockIndex) * 0.5;

    ctx.save();
    if (flock.clear) {
      ctx.strokeStyle = "rgba(84, 231, 195, 0.22)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(x, y, 42 + Math.sin(time * 2 + flockIndex) * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (flock.disturbed) {
      ctx.fillStyle = "rgba(255, 199, 107, 0.08)";
      ctx.strokeStyle = "rgba(255, 199, 107, 0.6)";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(x, y, 35, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const offsets = [
      [-13, 2, 0.95],
      [8, -7, 1.16],
      [21, 7, 0.78],
    ];
    offsets.forEach(([offsetX, offsetY, scale], birdIndex) => {
      drawBird(
        ctx,
        x + offsetX,
        y + offsetY + Math.sin(time * 2.4 + birdIndex) * 1.5,
        7 * scale,
        flap,
        flockSpec.color,
        flock.clear ? 0.95 : 0.78,
      );
    });
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(219, 238, 233, 0.78)";
    ctx.font = `600 8px ${FONT_SANS}`;
    ctx.fillText(flock.name, x, y + 30);
    ctx.fillStyle = flock.clear ? "#54e7c3" : "rgba(143, 172, 168, 0.55)";
    ctx.font = `7px ${FONT_MONO}`;
    ctx.fillText(flock.clear ? "CLEAR · 已收录" : `ZONE 0${flock.zone + 1}`, x, y + 40);
    ctx.restore();
  }

  drawHover(ctx) {
    if (!this.pointer.inside) return;
    const zone = this.zoneAt(this.pointer);
    if (zone === null) return;
    ctx.save();
    ctx.strokeStyle = "rgba(84, 231, 195, 0.28)";
    ctx.setLineDash([2, 5]);
    ctx.strokeRect(ZONE_X[zone] - 96, 182, 192, 330);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(84, 231, 195, 0.45)";
    ctx.font = `7px ${FONT_MONO}`;
    ctx.textAlign = "center";
    ctx.fillText("设为落点", ZONE_X[zone], 535);
    ctx.restore();
  }

  drawResult(ctx, state) {
    if (state.status !== "completed") return;
    const success = state.outcome === "success";
    const color = success ? "84, 231, 195" : "255, 141, 120";
    ctx.save();
    const gradient = ctx.createLinearGradient(0, 270, 0, 390);
    gradient.addColorStop(0, `rgba(${color}, 0)`);
    gradient.addColorStop(0.5, `rgba(${color}, 0.17)`);
    gradient.addColorStop(1, `rgba(${color}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 240, LOGICAL_WIDTH, 190);
    ctx.textAlign = "center";
    ctx.fillStyle = success ? "#8ff7dc" : "#ffad9d";
    ctx.font = `650 24px ${FONT_SANS}`;
    ctx.fillText(success ? "监测任务完成" : "监测任务失败", LOGICAL_WIDTH / 2, 306);
    ctx.fillStyle = "rgba(229, 245, 241, 0.7)";
    ctx.font = `9px ${FONT_MONO}`;
    ctx.fillText(
      success ? "RECORDINGS 3/3 · TRACKS 2/2 · DISTURBANCE 0" : "查看右侧事件流与验收证据",
      LOGICAL_WIDTH / 2,
      328,
    );
    ctx.restore();
  }

  draw(state) {
    if (!state) return;
    const ctx = this.ctx;
    const time = performance.now() / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
    this.deviceHits = [];
    this.drawBackground(ctx, time);
    this.drawLights(ctx, state, time);
    this.drawCoverage(ctx, state);
    this.drawWind(ctx, state, time);
    this.drawTracks(ctx, state, time);
    this.drawMovePreview(ctx, state, time);
    FLOCKS.forEach((flock, index) => this.drawFlock(ctx, state, flock, time, index));
    Object.values(state.devices).forEach((device) => this.drawDevice(ctx, state, device, time));
    this.drawHover(ctx);
    this.drawResult(ctx, state);
  }

  destroy() {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
  }
}
