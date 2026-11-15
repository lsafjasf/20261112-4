// Terrain: elevation with three slope ridges, vegetation moisture, roads, village, water station.
import { createRng } from './rng.js';

export const W = 60;
export const H = 40;
export const CELL = 16; // px per cell on canvas

// Cell burn states
export const FUEL_OK = 0;
export const FUEL_BURNING = 1;
export const FUEL_BURNED = 2;
export const FUEL_NONE = 3; // road / water / firebreak / village floor

export function buildTerrain(seed) {
  const rng = createRng(seed ^ 0x9e3779b9);
  const elev = new Float32Array(W * H);
  const moisture = new Float32Array(W * H);
  const road = new Uint8Array(W * H);
  const fuel = new Uint8Array(W * H).fill(FUEL_OK);
  const intensity = new Float32Array(W * H);
  const breakProgress = new Float32Array(W * H);
  const scanned = new Float32Array(W * H);
  const fuelLoad = new Float32Array(W * H).fill(1);
  const wet = new Float32Array(W * H);

  // Three ridge lines (fire corridors): gaussian bumps along diagonal lines.
  const ridges = [
    { x0: 4, y0: 6, x1: 30, y1: 20 },
    { x0: 6, y0: 22, x1: 34, y1: 30 },
    { x0: 2, y0: 33, x1: 28, y1: 37 },
  ];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let e = 2 + rng.range(-0.3, 0.3);
      for (const r of ridges) {
        const d = distToSeg(x, y, r.x0, r.y0, r.x1, r.y1);
        e += 8 * Math.exp(-(d * d) / 18);
      }
      elev[i] = e;
      moisture[i] = clamp01(0.62 - e * 0.04 + rng.range(-0.08, 0.08));
    }
  }

  // Roads: horizontal valley road + vertical connector to village.
  for (let x = 2; x < W - 2; x++) road[18 * W + x] = 1;
  for (let y = 10; y < 30; y++) road[y * W + 46] = 1;
  for (let x = 40; x <= 46; x++) road[12 * W + x] = 1;

  // Village cluster (east, near road end).
  const village = [];
  for (let y = 9; y <= 13; y++) {
    for (let x = 50; x <= 55; x++) {
      if (rng.next() < 0.55) village.push(y * W + x);
    }
  }
  const waterStation = 18 * W + 44;

  for (let i = 0; i < W * H; i++) if (road[i]) fuel[i] = FUEL_NONE;

  return { elev, moisture, road, fuel, intensity, breakProgress, scanned, fuelLoad, wet, village, waterStation, ridges };
}

export function distToSeg(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x0) * dx + (py - y0) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x0 + t * dx, cy = y0 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
export const idx = (x, y) => y * W + x;
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
