// Resources: 2 water trucks (road-bound), 1 recon drone, 1 firebreak crew.
import { W, H, idx, inBounds, FUEL_BURNING, FUEL_NONE } from './terrain.js';
import { applyWater } from './fire.js';

export const TRUCK_CAPACITY = 100;
export const TRUCK_REFILL_TICKS = 20;
export const TRUCK_SPRAY_RANGE = 4;
export const CREW_DIG_TICKS = 6; // ticks to cut one cell of firebreak

// BFS over road cells, deterministic neighbour order.
export function roadPath(ter, from, to) {
  if (from === to) return [from];
  const prev = new Int32Array(W * H).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    if (cur === to) break;
    const cx = cur % W, cy = (cur / W) | 0;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!inBounds(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (!ter.road[ni] && ni !== to) continue;
      if (prev[ni] !== -1) continue;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (prev[to] === -1) return null;
  const path = [];
  for (let c = to; c !== from; c = prev[c]) path.push(c);
  path.push(from);
  return path.reverse();
}

export function nearestRoadCell(ter, target) {
  let best = -1, bestD = Infinity;
  const tx = target % W, ty = (target / W) | 0;
  for (let i = 0; i < W * H; i++) {
    if (!ter.road[i]) continue;
    const d = Math.abs(i % W - tx) + Math.abs(((i / W) | 0) - ty);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

export function createTrucks(ter) {
  const base = ter.waterStation;
  return [0, 1].map(id => ({
    id, pos: base, water: TRUCK_CAPACITY,
    mode: 'idle', path: [], target: -1, refillLeft: 0, sprayedCells: 0,
  }));
}

export function stepTruck(truck, ter, tick, events) {
  if (truck.mode === 'moving' || truck.mode === 'returning') {
    if (truck.path.length > 0) truck.pos = truck.path.shift();
    if (truck.path.length === 0) {
      if (truck.mode === 'returning') {
        truck.mode = 'refilling';
        truck.refillLeft = TRUCK_REFILL_TICKS;
        events.push({ tick, type: 'truckRefillStart', id: truck.id });
      } else {
        truck.mode = 'spraying';
        events.push({ tick, type: 'truckArrive', id: truck.id, pos: truck.pos });
      }
    }
    return;
  }
  if (truck.mode === 'refilling') {
    if (--truck.refillLeft <= 0) {
      truck.water = TRUCK_CAPACITY;
      truck.mode = 'idle';
      events.push({ tick, type: 'truckRefilled', id: truck.id });
    }
    return;
  }
  if (truck.mode === 'spraying') {
    if (truck.water <= 0) {
      const home = nearestRoadCell(ter, ter.waterStation);
      truck.path = roadPath(ter, truck.pos, home) || [];
      truck.path.shift();
      truck.mode = 'returning';
      events.push({ tick, type: 'truckEmpty', id: truck.id });
      return;
    }
    // Spray the hottest cell within range of the truck's assigned target area.
    const cell = pickSprayCell(truck, ter);
    if (cell === -1) { truck.mode = 'idle'; return; }
    truck.water -= 5;
    truck.sprayedCells++;
    // 3x3 spray pattern: full dose on the hot cell, falloff around it.
    const cx = cell % W, cy = (cell / W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (!inBounds(nx, ny)) continue;
        applyWater(ter, idx(nx, ny), dx === 0 && dy === 0 ? 0.5 : 0.25);
      }
    }
    if (ter.fuel[cell] !== FUEL_BURNING) {
      events.push({ tick, type: 'extinguished', id: truck.id, cell });
    }
  }
}

function pickSprayCell(truck, ter) {
  const tx = truck.target % W, ty = (truck.target / W) | 0;
  let best = -1, bestScore = -1;
  for (let dy = -TRUCK_SPRAY_RANGE; dy <= TRUCK_SPRAY_RANGE; dy++) {
    for (let dx = -TRUCK_SPRAY_RANGE; dx <= TRUCK_SPRAY_RANGE; dx++) {
      const nx = tx + dx, ny = ty + dy;
      if (!inBounds(nx, ny)) continue;
      const ni = idx(nx, ny);
      const burning = ter.fuel[ni] === FUEL_BURNING;
      let score = -1;
      if (burning) {
        score = 10 + ter.intensity[ni] * 2;
      } else if (ter.fuel[ni] === 0 && ter.wet[ni] < 0.6) {
        // Defensive soaking: keep unburned fuel near the target wet.
        score = 1 - ter.wet[ni];
      }
      if (score > bestScore) {
        bestScore = score;
        best = ni;
      }
    }
  }
  return bestScore > 0 ? best : -1;
}

export function commandTruck(truck, ter, targetCell, tick, events) {
  const roadCell = nearestRoadCell(ter, targetCell);
  const path = roadPath(ter, truck.pos, roadCell);
  if (!path) return false;
  truck.path = path;
  truck.path.shift();
  truck.target = targetCell;
  truck.mode = truck.path.length ? 'moving' : 'spraying';
  events.push({ tick, type: 'cmdTruck', id: truck.id, target: targetCell });
  return true;
}
