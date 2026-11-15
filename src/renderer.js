import {
  FACILITIES,
  RESERVOIRS,
  RESERVOIR_IDS,
  SIM_DURATION_SECONDS,
  STATIONS,
  STATION_IDS,
  ZONES,
  formatClock,
  rainfallAt,
} from './model.js';

const W = 1320;
const H = 760;
const GEO = {
  P1: { x: 54, y: 116, w: 188, h: 102 },
  P2: { x: 54, y: 242, w: 188, h: 102 },
  P3: { x: 54, y: 368, w: 188, h: 102 },
  P4: { x: 54, y: 494, w: 188, h: 102 },
  WTP: { x: 570, y: 238, w: 218, h: 188 },
  R1: { x: 1082, y: 116, w: 184, h: 98 },
  R2: { x: 842, y: 250, w: 184, h: 98 },
  R3: { x: 1038, y: 390, w: 228, h: 98 },
  D1: { x: 56, y: 654, w: 230, h: 72 },
  D2: { x: 304, y: 654, w: 230, h: 72 },
  D3: { x: 552, y: 654, w: 230, h: 72 },
};

const SEGMENTS = {
  S1: { points: [[242, 167], [476, 88], [970, 88], [1082, 165]], label: 'S1 北干管' },
  S2: { points: [[242, 293], [440, 293], [500, 326], [570, 326]], label: 'S2 中心干管' },
  S3: { points: [[242, 419], [444, 419], [500, 380], [570, 380]], label: 'S3 南支管' },
  S4: { points: [[242, 545], [452, 545], [520, 474], [570, 460], [862, 440], [1038, 440]], label: 'S4 滨河干管' },
};

function pressureColor(pressure, burst = false) {
  if (burst) return '#ff4d6d';
  if (pressure < 2.2) return '#ff3b5c';
  if (pressure < 2.8) return '#ff9f43';
  if (pressure < 4.6) return '#38bdf8';
  if (pressure < 6.6) return '#2dd4bf';
  if (pressure < 7.85) return '#facc15';
  return '#fb7185';
}

function roundedRect(ctx, x, y, w, h, radius = 10) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function text(ctx, value, x, y, size = 13, color = '#d9f3f5', weight = 500, align = 'left') {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px "Stormwater Noto", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y);
}

function drawWater(ctx, x, y, w, h, level, time, color = '#0ea5c6') {
  const fill = Math.max(0, Math.min(1, level));
  const waterY = y + h * (1 - fill);
  const gradient = ctx.createLinearGradient(0, waterY, 0, y + h);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, '#064a68');
  ctx.save();
  roundedRect(ctx, x, y, w, h, 5);
  ctx.clip();
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(x, waterY);
  for (let px = 0; px <= w; px += 8) {
    const wave = Math.sin(px * 0.11 + time * 1.8) * 2.2 + Math.sin(px * 0.035 - time) * 1.4;
    ctx.lineTo(x + px, waterY + wave);
  }
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = '#9ceaff';
  ctx.lineWidth = 1;
  for (let row = 0; row < 3; row += 1) {
    const yy = waterY + 13 + row * 17;
    if (yy > y + h) break;
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.lineTo(x + w, yy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPipe(ctx, points, color, width, animated = false, time = 0) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = width;
  ctx.beginPath();
  points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#d6fbff';
  ctx.globalAlpha = 0.36;
  ctx.lineWidth = Math.max(1, width * 0.22);
  ctx.stroke();
  if (animated) {
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 16]);
    ctx.lineDashOffset = -time * 45;
    ctx.stroke();
  }
  ctx.restore();
}

function drawRainInset(ctx, state) {
  const x = 750;
  const y = 20;
  const w = 506;
  const h = 76;
  ctx.fillStyle = 'rgba(5, 25, 34, 0.82)';
  roundedRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(76, 201, 240, 0.22)';
  ctx.stroke();
  text(ctx, '6H 降雨预报', x + 12, y + 14, 11, '#7fb7c4', 600);
  ctx.beginPath();
  for (let i = 0; i <= 120; i += 1) {
    const t = (i / 120) * SIM_DURATION_SECONDS;
    const px = x + 10 + (i / 120) * (w - 20);
    const py = y + h - 8 - (rainfallAt(t) / 55) * (h - 26);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = 'rgba(65, 219, 255, 0.78)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const markerX = x + 10 + (state.timeSec / SIM_DURATION_SECONDS) * (w - 20);
  ctx.beginPath();
  ctx.moveTo(markerX, y + 8);
  ctx.lineTo(markerX, y + h - 6);
  ctx.strokeStyle = '#ffcf5c';
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, `${state.rainfallMmH.toFixed(1)} mm/h`, x + w - 12, y + 14, 11, '#ffcf5c', 700, 'right');
}

function drawHeader(ctx, state, time) {
  ctx.fillStyle = '#06151d';
  ctx.fillRect(0, 0, W, 102);
  ctx.fillStyle = 'rgba(14, 165, 198, 0.08)';
  ctx.fillRect(0, 100, W, 2);
  text(ctx, '城市水务联合调度中心', 26, 28, 20, '#ecfeff', 700);
  text(ctx, 'STORMWATER CONTROL / LIVE NETWORK', 26, 50, 10, '#5f99a7', 600);
  text(ctx, formatClock(state.timeSec), 26, 78, 22, '#7dd3fc', 700);
  text(ctx, state.scenarioName, 150, 79, 12, '#9bc6cf', 500);
  drawRainInset(ctx, state);
  const critical = state.alerts.filter((alert) => alert.severity === 'critical').length;
  const warnings = state.alerts.filter((alert) => alert.severity === 'warning').length;
  text(ctx, critical ? `${critical} 严重告警` : warnings ? `${warnings} 预警` : '系统稳定', 1294, 50, 12, critical ? '#ff7990' : warnings ? '#facc15' : '#5ee6c2', 700, 'right');
  const pulse = 0.55 + Math.sin(time * 3) * 0.25;
  ctx.fillStyle = critical ? `rgba(255, 77, 109, ${pulse})` : 'rgba(94, 230, 194, 0.85)';
  ctx.beginPath();
  ctx.arc(1300, 50, 5, 0, Math.PI * 2);
  ctx.fill();
}

function severityForTarget(state, target) {
  if (state.alerts.some((alert) => alert.target === target && alert.severity === 'critical')) return 'critical';
  if (state.alerts.some((alert) => alert.target === target && alert.severity === 'warning')) return 'warning';
  return 'ok';
}

function drawPump(ctx, state, id, time) {
  const box = GEO[id];
  const pump = state.pumps[id];
  const well = state.wetWells[id];
  const severity = severityForTarget(state, id) === 'ok'
    ? well.level >= 0.82 ? 'warning' : 'ok'
    : severityForTarget(state, id);
  const border = severity === 'critical' ? '#ff4d6d' : severity === 'warning' ? '#facc15' : 'rgba(80, 194, 210, 0.45)';
  roundedRect(ctx, box.x, box.y, box.w, box.h, 10);
  ctx.fillStyle = 'rgba(8, 31, 42, 0.96)';
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = severity === 'ok' ? 1 : 1.5;
  ctx.stroke();
  ctx.fillStyle = border;
  ctx.fillRect(box.x, box.y + 12, 3, box.h - 24);
  text(ctx, pump.name, box.x + 14, box.y + 17, 12, '#e9fbff', 650);
  text(ctx, `${pump.speed.toFixed(0)}%`, box.x + box.w - 14, box.y + 17, 15, border === 'rgba(80, 194, 210, 0.45)' ? '#7dd3fc' : border, 700, 'right');
  drawWater(ctx, box.x + 12, box.y + 38, 95, 48, well.level, time + box.y * 0.01, well.level > 0.86 ? '#f97316' : '#0ea5c6');
  text(ctx, '湿井', box.x + 12, box.y + 32, 9, '#6d9ba6', 500);
  text(ctx, `${(well.level * 100).toFixed(0)}%`, box.x + 59, box.y + 63, 16, '#f0fdff', 700, 'center');
  text(ctx, `${pump.flowM3s.toFixed(1)} m³/s`, box.x + 119, box.y + 49, 13, '#c4f5ff', 700);
  text(ctx, `目标 ${pump.targetSpeed.toFixed(0)}%`, box.x + 119, box.y + 68, 10, '#75aab6', 500);
  const pending = state.pendingCommands.filter((task) => task.target === id).length;
  if (pending) {
    ctx.fillStyle = 'rgba(250, 204, 21, 0.16)';
    roundedRect(ctx, box.x + 112, box.y + 79, 64, 14, 7);
    ctx.fill();
    text(ctx, `延迟 ${pending}`, box.x + 144, box.y + 86, 9, '#facc15', 700, 'center');
  }
}

function drawReservoir(ctx, state, id, time) {
  const box = GEO[id];
  const reservoir = state.reservoirs[id];
  const severity = severityForTarget(state, id);
  const border = severity === 'critical' ? '#ff4d6d' : severity === 'warning' ? '#facc15' : 'rgba(80, 194, 210, 0.45)';
  roundedRect(ctx, box.x, box.y, box.w, box.h, 10);
  ctx.fillStyle = 'rgba(8, 31, 42, 0.96)';
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, reservoir.name, box.x + 13, box.y + 16, 12, '#e9fbff', 650);
  text(ctx, `闸 ${reservoir.gate.toFixed(0)}%`, box.x + box.w - 13, box.y + 16, 10, '#7dd3fc', 700, 'right');
  drawWater(ctx, box.x + 12, box.y + 30, box.w - 24, 48, reservoir.level, time + box.x * 0.01, '#1ca3b9');
  text(ctx, `${(reservoir.level * 100).toFixed(1)}%`, box.x + (box.w - 24) / 2 + 12, box.y + 55, 17, '#f0fdff', 700, 'center');
  text(ctx, `${(reservoir.volumeM3 / 1000).toFixed(1)}k m³`, box.x + 13, box.y + 88, 10, '#78aeb9', 500);
  const weight = state.priority.indexOf(id) + 1;
  text(ctx, `P${weight}`, box.x + box.w - 13, box.y + 88, 10, '#ffcf5c', 700, 'right');
}

function drawWtp(ctx, state, time) {
  const box = GEO.WTP;
  const wtp = state.facilities.WTP;
  const border = wtp.flooded ? '#ff4d6d' : 'rgba(94, 230, 194, 0.52)';
  roundedRect(ctx, box.x, box.y, box.w, box.h, 16);
  ctx.fillStyle = 'rgba(8, 31, 42, 0.98)';
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = wtp.flooded ? 2 : 1.2;
  ctx.stroke();
  text(ctx, '净水厂 / WTP', box.x + 17, box.y + 24, 15, '#e9fbff', 700);
  text(ctx, `${state.wtpInflowM3s.toFixed(2)} m³/s 进水`, box.x + 17, box.y + 50, 19, '#7dd3fc', 700);
  const target = 7.4;
  ctx.fillStyle = 'rgba(125, 211, 252, 0.12)';
  roundedRect(ctx, box.x + 17, box.y + 68, box.w - 34, 10, 5);
  ctx.fill();
  ctx.fillStyle = state.wtpInflowM3s >= target * 0.85 ? '#2dd4bf' : '#facc15';
  roundedRect(ctx, box.x + 17, box.y + 68, Math.min(1, state.wtpInflowM3s / target) * (box.w - 34), 10, 5);
  ctx.fill();
  text(ctx, `处理目标 ${target.toFixed(1)} m³/s`, box.x + 17, box.y + 94, 10, '#7babb5', 500);
  drawWater(ctx, box.x + 17, box.y + 112, box.w - 34, 46, 0.28 + Math.sin(time * 0.8) * 0.015, time, '#0e7490');
  const severity = severityForTarget(state, 'WTP');
  text(ctx, wtp.flooded ? '进水保护失败' : severity === 'critical' ? '进水风险' : '进水保护正常', box.x + box.w - 17, box.y + 94, 10, wtp.flooded ? '#ff7990' : '#5ee6c2', 700, 'right');
  const pulse = 0.35 + Math.sin(time * 2.5) * 0.18;
  ctx.strokeStyle = `rgba(94, 230, 194, ${pulse})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(box.x + box.w / 2, box.y + box.h / 2, 88 + Math.sin(time * 1.8) * 4, 0, Math.PI * 2);
  ctx.stroke();
}

function drawFacility(ctx, state, id, time) {
  const box = GEO[id];
  const facility = state.facilities[id];
  const severity = facility.flooded ? 'critical' : facility.floodM3 > facility.floodLimitM3 * 0.55 ? 'warning' : 'ok';
  const border = severity === 'critical' ? '#ff4d6d' : severity === 'warning' ? '#facc15' : 'rgba(94, 230, 194, 0.45)';
  roundedRect(ctx, box.x, box.y, box.w, box.h, 9);
  ctx.fillStyle = 'rgba(7, 27, 36, 0.96)';
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.stroke();
  if (facility.floodM3 > 0) {
    const depth = Math.min(1, facility.floodM3 / facility.floodLimitM3);
    drawWater(ctx, box.x + 8, box.y + 36, box.w - 100, 27, depth * 0.55, time, '#f97316');
  }
  text(ctx, facility.name, box.x + 12, box.y + 17, 12, '#e9fbff', 650);
  text(ctx, facility.kind, box.x + 12, box.y + 31, 9, '#79aab5', 500);
  text(ctx, facility.flooded ? '已进水' : facility.floodM3 > 0 ? '积水' : '干燥', box.x + 12, box.y + 55, 12, border === 'rgba(94, 230, 194, 0.45)' ? '#5ee6c2' : border, 700);
  text(ctx, `${facility.floodM3.toFixed(1)} m³`, box.x + box.w - 12, box.y + 53, 12, facility.floodM3 > 0 ? '#ffcf5c' : '#6f9ba4', 700, 'right');
}

function drawBackdrop(ctx, time) {
  const gradient = ctx.createLinearGradient(0, 100, 0, H);
  gradient.addColorStop(0, '#071923');
  gradient.addColorStop(1, '#041018');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 102, W, H - 102);

  ctx.strokeStyle = 'rgba(68, 155, 173, 0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 102);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 102; y <= H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(113, 206, 230, 0.15)';
  for (let index = 0; index < 42; index += 1) {
    const x = (index * 97 + time * 21) % W;
    const y = 104 + ((index * 53 + time * 88) % (H - 120));
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 5, y + 12);
    ctx.stroke();
  }

  text(ctx, '管网拓扑 / 实时压力', 278, 124, 12, '#7fb7c4', 700);
  text(ctx, '蓄水优先顺序', 862, 238, 11, '#6b9ba6', 600);
}

function pressurePill(ctx, label, pressure, x, y, burst = false) {
  const color = pressureColor(pressure, burst);
  ctx.fillStyle = 'rgba(3, 17, 24, 0.88)';
  roundedRect(ctx, x, y, 106, 25, 12);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
  text(ctx, label, x + 10, y + 12, 9, '#86b5c0', 600);
  text(ctx, `${pressure.toFixed(2)} bar`, x + 96, y + 12, 11, color, 700, 'right');
}

function drawNetwork(ctx, state, time) {
  drawPipe(ctx, [[1040, 165], [880, 196], [788, 246]], 'rgba(56, 189, 248, 0.35)', 5);
  drawPipe(ctx, [[842, 300], [788, 314]], 'rgba(56, 189, 248, 0.35)', 5);
  drawPipe(ctx, [[1038, 440], [888, 407], [788, 382]], 'rgba(56, 189, 248, 0.32)', 5);

  for (const [id, segment] of Object.entries(SEGMENTS)) {
    const zone = ZONES[id === 'S1' ? 'north' : id === 'S4' ? 'lowland' : 'central'];
    const activeBurst = state.burst?.segment === id && state.burst.status === 'active';
    const color = pressureColor(state.zones[zone.id].pressure, activeBurst);
    const station = id === 'S1' ? 'P1' : id === 'S2' ? 'P2' : id === 'S3' ? 'P3' : 'P4';
    drawPipe(ctx, segment.points, color, activeBurst ? 13 : 8, state.pumps[station].flowM3s > 0.1, time);
    const mid = segment.points[Math.floor(segment.points.length / 2)];
    text(ctx, segment.label, mid[0] + 8, mid[1] - 15, 9, color, 700);
  }

  pressurePill(ctx, '北片', state.zones.north.pressure, 500, 108);
  pressurePill(ctx, '中心', state.zones.central.pressure, 438, 246);
  pressurePill(ctx, '滨河', state.zones.lowland.pressure, 806, 486);

  if (state.burst) {
    const points = SEGMENTS[state.burst.segment].points;
    const [bx, by] = points[2] ?? points[1];
    const active = state.burst.status === 'active';
    const color = active ? '#ff4d6d' : '#facc15';
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    for (let ring = 0; ring < 3; ring += 1) {
      ctx.globalAlpha = 0.65 - ring * 0.16;
      ctx.beginPath();
      ctx.arc(bx, by, 14 + ((time * 24 + ring * 20) % 42), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(bx, by, 6, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, active ? `爆管 ${state.burst.segment}` : `${state.burst.segment} 已隔离`, bx + 12, by + 28, 10, color, 700);
    ctx.restore();
  }

  for (const id of STATION_IDS) {
    const box = GEO[id];
    ctx.fillStyle = '#bdf7ff';
    ctx.beginPath();
    ctx.arc(box.x + box.w, box.y + box.h / 2, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawLegend(ctx, state) {
  const x = 818;
  const y = 644;
  roundedRect(ctx, x, y, 444, 86, 10);
  ctx.fillStyle = 'rgba(5, 24, 33, 0.94)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(80, 194, 210, 0.28)';
  ctx.stroke();
  text(ctx, '压力色带 (bar)', x + 14, y + 15, 10, '#80b4bf', 700);
  const bands = [
    ['< 2.2', '#ff3b5c'],
    ['2.2–2.8', '#ff9f43'],
    ['2.8–4.6', '#38bdf8'],
    ['4.6–6.6', '#2dd4bf'],
    ['6.6–7.85', '#facc15'],
    ['> 7.85', '#fb7185'],
  ];
  bands.forEach(([label, color], index) => {
    const bx = x + 14 + index * 70;
    ctx.fillStyle = color;
    roundedRect(ctx, bx, y + 31, 58, 7, 3.5);
    ctx.fill();
    text(ctx, label, bx, y + 49, 8, '#8fbac4', 500);
  });
  text(ctx, '流量虚线 = 泵机运行', x + 14, y + 68, 9, '#6f9ca6', 500);
  text(ctx, '红色脉冲 = 爆管外泄', x + 188, y + 68, 9, '#ff7990', 600);
  text(ctx, '黄色 = 指令延迟', x + 332, y + 68, 9, '#facc15', 600);
}

export function renderCanvas(canvas, state, nowMs = performance.now()) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 10) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const targetWidth = Math.round(rect.width * dpr);
  const targetHeight = Math.round(rect.height * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(targetWidth / W, 0, 0, targetHeight / H, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const time = nowMs / 1000;
  drawBackdrop(ctx, time);
  drawHeader(ctx, state, time);
  drawNetwork(ctx, state, time);
  for (const id of STATION_IDS) drawPump(ctx, state, id, time);
  for (const id of RESERVOIR_IDS) drawReservoir(ctx, state, id, time);
  drawWtp(ctx, state, time);
  for (const id of ['D1', 'D2', 'D3']) drawFacility(ctx, state, id, time);
  drawLegend(ctx, state);
}
