// Canvas renderer: terrain, fire line, smoke, roads, vehicles, drone, crew.
import { W, H, CELL, FUEL_OK, FUEL_BURNING, FUEL_BURNED, FUEL_NONE } from '../core/terrain.js';

const smoke = []; // visual-only particles, not part of the deterministic sim

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const terrainLayer = document.createElement('canvas');
  terrainLayer.width = canvas.width;
  terrainLayer.height = canvas.height;
  let terrainSim = null;

  function paintTerrain(sim) {
    terrainSim = sim;
    const tctx = terrainLayer.getContext('2d');
    const ter = sim.ter;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let color;
        if (ter.road[i]) color = '#5a5f66';
        else {
          const e = ter.elev[i], m = ter.moisture[i];
          const g = 90 + m * 90 - e * 4;
          const r = 60 + e * 8;
          color = `rgb(${r | 0},${Math.max(40, g) | 0},50)`;
        }
        tctx.fillStyle = color;
        tctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    // Village houses.
    tctx.fillStyle = '#c9a86a';
    for (const c of ter.village) {
      tctx.fillRect((c % W) * CELL + 3, ((c / W) | 0) * CELL + 3, CELL - 6, CELL - 6);
    }
    // Water station.
    const ws = ter.waterStation;
    tctx.fillStyle = '#3aa7ff';
    tctx.fillRect((ws % W) * CELL + 2, ((ws / W) | 0) * CELL + 2, CELL - 4, CELL - 4);
  }

  function draw(sim, selected, digMode) {
    if (terrainSim !== sim) paintTerrain(sim);
    const ter = sim.ter;
    ctx.drawImage(terrainLayer, 0, 0);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const px = x * CELL, py = y * CELL;
        if (ter.fuel[i] === FUEL_BURNED) {
          ctx.fillStyle = 'rgba(20,18,16,0.85)';
          ctx.fillRect(px, py, CELL, CELL);
        } else if (ter.fuel[i] === FUEL_BURNING) {
          const it = ter.intensity[i];
          ctx.fillStyle = `rgba(255,${120 - it * 80 | 0},20,${0.45 + it * 0.55})`;
          ctx.fillRect(px, py, CELL, CELL);
          if (Math.random() < it * 0.25) {
            smoke.push({ x: px + CELL / 2, y: py, vy: -0.5 - Math.random(), vx: (Math.random() - 0.5) * 0.6, life: 1 });
          }
        } else if (ter.fuel[i] === FUEL_NONE && !ter.road[i] && ter.breakProgress[i] >= 1) {
          ctx.fillStyle = '#8a6b3d';
          ctx.fillRect(px, py, CELL, CELL);
        }
        if (ter.breakProgress[i] > 0 && ter.breakProgress[i] < 1) {
          ctx.fillStyle = 'rgba(200,160,90,0.7)';
          ctx.fillRect(px, py, CELL, CELL * ter.breakProgress[i]);
        }
        if (ter.wet[i] > 0.05 && ter.fuel[i] !== FUEL_BURNING) {
          ctx.fillStyle = `rgba(60,140,255,${ter.wet[i] * 0.45})`;
          ctx.fillRect(px, py, CELL, CELL);
        }
        // Drone fog: unscanned area dimmed.
        if (ter.scanned[i] < 0.25) {
          ctx.fillStyle = `rgba(8,10,14,${0.45 - ter.scanned[i] * 1.2})`;
          ctx.fillRect(px, py, CELL, CELL);
        }
      }
    }
    drawSmoke(ctx, sim);
    drawUnits(ctx, sim, selected);
    drawWind(ctx, sim);
    if (digMode) {
      ctx.fillStyle = 'rgba(255,200,80,0.12)';
      ctx.fillRect(0, 0, W * CELL, H * CELL);
    }
  }

  return { draw };
}

function drawSmoke(ctx, sim) {
  const wind = sim.wind;
  for (let i = smoke.length - 1; i >= 0; i--) {
    const p = smoke[i];
    p.x += p.vx + Math.cos(wind.dir) * wind.speed * 0.15;
    p.y += p.vy + Math.sin(wind.dir) * wind.speed * 0.15;
    p.life -= 0.012;
    if (p.life <= 0) { smoke.splice(i, 1); continue; }
    ctx.fillStyle = `rgba(120,120,125,${p.life * 0.35})`;
    const r = 3 + (1 - p.life) * 9;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (smoke.length > 600) smoke.splice(0, smoke.length - 600);
}

function drawUnits(ctx, sim, selected) {
  // Trucks: blue squares with water-level bar.
  for (const t of sim.trucks) {
    const px = (t.pos % W) * CELL, py = ((t.pos / W) | 0) * CELL;
    ctx.fillStyle = t.mode === 'refilling' ? '#2b6cb0' : '#63b3ed';
    ctx.fillRect(px + 2, py + 4, CELL - 4, CELL - 8);
    ctx.fillStyle = '#1a202c';
    ctx.fillRect(px + 2, py + 1, CELL - 4, 2);
    ctx.fillStyle = '#4fd1ff';
    ctx.fillRect(px + 2, py + 1, (CELL - 4) * (t.water / 100), 2);
    if (selected === `truck${t.id}`) ring(ctx, px, py, '#fff');
  }
  // Crew: orange dot, red flash when trapped.
  const c = sim.crew;
  const cpx = (c.pos % W) * CELL, cpy = ((c.pos / W) | 0) * CELL;
  ctx.fillStyle = c.trapped ? '#ff2222' : '#ff9f43';
  ctx.beginPath();
  ctx.arc(cpx + CELL / 2, cpy + CELL / 2, 5, 0, Math.PI * 2);
  ctx.fill();
  if (c.digging !== -1 || c.queue.length) ring(ctx, cpx, cpy, '#ffcf8a');
  // Dig queue preview.
  ctx.strokeStyle = 'rgba(255,200,80,0.5)';
  for (const q of c.queue) {
    ctx.strokeRect((q % W) * CELL + 2, ((q / W) | 0) * CELL + 2, CELL - 4, CELL - 4);
  }
  // Drone: white triangle.
  const d = sim.drone;
  const dpx = (d.pos % W) * CELL, dpy = ((d.pos / W) | 0) * CELL;
  ctx.fillStyle = '#e8ecff';
  ctx.beginPath();
  ctx.moveTo(dpx + CELL / 2, dpy + 2);
  ctx.lineTo(dpx + CELL - 3, dpy + CELL - 3);
  ctx.lineTo(dpx + 3, dpy + CELL - 3);
  ctx.closePath();
  ctx.fill();
  if (selected === 'drone') ring(ctx, dpx, dpy, '#fff');
  if (d.mode === 'scanning') {
    ctx.strokeStyle = 'rgba(140,220,255,0.6)';
    ctx.beginPath();
    ctx.arc(dpx + CELL / 2, dpy + CELL / 2, d.scanRadius * CELL, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function ring(ctx, px, py, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(px - 1, py - 1, CELL + 2, CELL + 2);
  ctx.lineWidth = 1;
}

function drawWind(ctx, sim) {
  const { dir, speed } = sim.wind;
  const cx = W * CELL - 50, cy = 34;
  ctx.strokeStyle = '#8fd3ff';
  ctx.fillStyle = '#8fd3ff';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(dir) * (14 + speed * 2), cy + Math.sin(dir) * (14 + speed * 2));
  ctx.stroke();
  ctx.font = '11px sans-serif';
  ctx.fillText(`风 ${speed.toFixed(1)}`, cx - 24, cy + 26);
}
