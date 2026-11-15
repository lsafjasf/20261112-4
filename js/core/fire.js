// Deterministic fire spread: wind + slope + moisture drive ignition probabilities.
import { W, H, idx, inBounds, FUEL_OK, FUEL_BURNING, FUEL_BURNED, FUEL_NONE, clamp01 } from './terrain.js';

export const TICK_SECONDS = 30;      // one sim tick = 30s
export const SIM_TICKS = 480;        // 4 hours

const DIRS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],           [1, 0],
  [-1, 1],  [0, 1],  [1, 1],
];

// Wind is a pure function of (tick, seed) — fully deterministic, no RNG needed.
export function windAt(tick, seed) {
  const t = tick * TICK_SECONDS;
  const phase = (seed % 1000) / 1000;
  const dir = 0.6 + 0.5 * Math.sin(t / 2400 + phase * 6.28) + 0.2 * Math.sin(t / 700);
  const speed = 3.5 + 2.5 * Math.sin(t / 1500 + phase * 3.1) + 1.5 * Math.sin(t / 430 + 1.7);
  return { dir, speed: Math.max(0.5, speed) }; // dir in radians, speed in m/s-ish
}

export function ignite(ter, i) {
  if (ter.fuel[i] !== FUEL_OK) return false;
  ter.fuel[i] = FUEL_BURNING;
  ter.intensity[i] = 0.25;
  return true;
}

// Advance fire one tick. rng draws happen in strict cell order -> deterministic.
export function stepFire(ter, rng, tick, seed, events) {
  const wind = windAt(tick, seed);
  const wx = Math.cos(wind.dir), wy = Math.sin(wind.dir);
  const toIgnite = [];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (ter.fuel[i] !== FUEL_BURNING) continue;

      // Burn-down: consume fuel load, decay wetness.
      const burnRate = 0.008 + wind.speed * 0.002 + (1 - ter.moisture[i]) * 0.01;
      ter.fuelLoad[i] -= burnRate;
      ter.intensity[i] = clamp01(ter.fuelLoad[i] * (0.6 + wind.speed * 0.06) * (1.3 - ter.moisture[i]));
      if (ter.fuelLoad[i] <= 0 || ter.intensity[i] <= 0.02) {
        ter.fuel[i] = FUEL_BURNED;
        ter.intensity[i] = 0;
        continue;
      }

      // Try to ignite neighbours.
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (ter.fuel[ni] !== FUEL_OK) continue;

        const dist = Math.hypot(dx, dy);
        const align = (dx / dist) * wx + (dy / dist) * wy; // -1..1
        const windFactor = 1 + align * wind.speed * 0.18;
        const slope = ter.elev[ni] - ter.elev[i];
        const slopeFactor = 1 + Math.max(-0.5, Math.min(1.5, slope * 0.35));
        const dryFactor = 1 - ter.moisture[ni];
        const wetFactor = 1 - ter.wet[ni];
        let p = 0.07 * ter.intensity[i] * windFactor * slopeFactor * dryFactor * wetFactor;
        p /= dist; // diagonal spread is slower
        if (rng.next() < p) toIgnite.push(ni);
      }
      // Wind-borne ember spotting: jump 3-6 cells downwind.
      const pSpot = 0.003 * (wind.speed / 8) * ter.intensity[i];
      if (rng.next() < pSpot) {
        const jump = 3 + Math.floor(rng.next() * 4);
        const jitter = rng.next() * 1.2 - 0.6;
        const sx = Math.round(x + Math.cos(wind.dir + jitter) * jump);
        const sy = Math.round(y + Math.sin(wind.dir + jitter) * jump);
        if (inBounds(sx, sy)) {
          const si = idx(sx, sy);
          if (ter.fuel[si] === FUEL_OK && ter.wet[si] < 0.4) toIgnite.push(si);
        }
      }
    }
  }

  // Wetness decays over time.
  for (let i = 0; i < W * H; i++) {
    if (ter.wet[i] > 0) ter.wet[i] = Math.max(0, ter.wet[i] - 0.01);
  }

  let ignitions = 0;
  for (const ni of toIgnite) {
    if (ignite(ter, ni)) ignitions++;
  }
  if (ignitions > 0) events.push({ tick, type: 'spread', count: ignitions });
  return wind;
}

// Apply water to a cell: suppress burning, soak unburned fuel.
export function applyWater(ter, i, amount) {
  ter.wet[i] = clamp01(ter.wet[i] + amount);
  if (ter.fuel[i] === FUEL_BURNING) {
    ter.intensity[i] -= amount * 1.5;
    if (ter.intensity[i] <= 0.05) {
      ter.fuel[i] = FUEL_BURNED; // knocked down; cell is scorched but safe
      ter.intensity[i] = 0;
      return true;
    }
  }
  return false;
}

export function countBurning(ter) {
  let n = 0;
  for (let i = 0; i < W * H; i++) if (ter.fuel[i] === FUEL_BURNING) n++;
  return n;
}

export { FUEL_OK, FUEL_BURNING, FUEL_BURNED, FUEL_NONE };
