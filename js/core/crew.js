// Firebreak crew + recon drone. Crew danger model is deterministic:
// if the cell the crew stands on ignites, the crew is trapped -> mission fails.
import { W, H, idx, inBounds, FUEL_BURNING, FUEL_NONE } from './terrain.js';
import { CREW_DIG_TICKS } from './resources.js';

export function createCrew(ter) {
  return { pos: ter.waterStation, queue: [], digging: -1, digLeft: 0, trapped: false, evacuating: false };
}

export function commandDig(crew, cells, tick, events) {
  crew.queue = cells.slice();
  crew.evacuating = false;
  events.push({ tick, type: 'cmdDig', cells: cells.length });
}

export function commandEvacuate(crew, ter, tick, events) {
  crew.queue = [];
  crew.digging = -1;
  crew.evacuating = true;
  events.push({ tick, type: 'cmdEvacuate', pos: crew.pos });
}

function stepToward(pos, target) {
  const px = pos % W, py = (pos / W) | 0;
  const tx = target % W, ty = (target / W) | 0;
  const dx = Math.sign(tx - px), dy = Math.sign(ty - py);
  if (dx !== 0 && dy !== 0) return idx(px + dx, py); // deterministic: x first
  return idx(px + dx, py + dy);
}

export function stepCrew(crew, ter, tick, events) {
  if (crew.trapped) return;

  // Danger check: standing on (or next to) a burning cell.
  if (ter.fuel[crew.pos] === FUEL_BURNING) {
    crew.trapped = true;
    events.push({ tick, type: 'crewTrapped', pos: crew.pos });
    return;
  }

  if (crew.evacuating) {
    if (ter.road[crew.pos]) {
      crew.evacuating = false;
      events.push({ tick, type: 'crewSafe', pos: crew.pos });
      return;
    }
    // Head for the horizontal valley road (row 18), deterministic greedy step.
    const px = crew.pos % W;
    crew.pos = stepToward(crew.pos, idx(Math.min(px, W - 3), 18));
    return;
  }

  if (crew.digging !== -1) {
    if (--crew.digLeft <= 0) {
      ter.breakProgress[crew.digging] = 1;
      ter.fuel[crew.digging] = FUEL_NONE;
      events.push({ tick, type: 'breakDone', cell: crew.digging });
      crew.digging = -1;
    }
    return;
  }

  if (crew.queue.length === 0) return;
  const next = crew.queue[0];
  if (crew.pos !== next) {
    crew.pos = stepToward(crew.pos, next);
    // Warn when working close to the fire front.
    if (fireNear(ter, crew.pos, 2)) events.push({ tick, type: 'crewDanger', pos: crew.pos });
    return;
  }
  crew.queue.shift();
  if (ter.fuel[next] === FUEL_NONE) return; // already barren
  crew.digging = next;
  crew.digLeft = CREW_DIG_TICKS;
  events.push({ tick, type: 'digStart', cell: next });
}

export function fireNear(ter, cell, radius) {
  const cx = cell % W, cy = (cell / W) | 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (!inBounds(nx, ny)) continue;
      if (ter.fuel[idx(nx, ny)] === FUEL_BURNING) return true;
    }
  }
  return false;
}

// --- Recon drone ---
export function createDrone(ter) {
  return { pos: ter.waterStation, target: -1, mode: 'idle', scanRadius: 4 };
}

export function commandDrone(drone, cell, tick, events) {
  drone.target = cell;
  drone.mode = 'flying';
  events.push({ tick, type: 'cmdDrone', target: cell });
}

export function stepDrone(drone, ter, tick, events) {
  if (drone.mode === 'flying') {
    // Drone is fast: two greedy steps per tick, ignores terrain.
    for (let s = 0; s < 2 && drone.pos !== drone.target; s++) {
      drone.pos = stepToward(drone.pos, drone.target);
    }
    if (drone.pos === drone.target) {
      drone.mode = 'scanning';
      events.push({ tick, type: 'droneArrive', pos: drone.pos });
    }
  }
  if (drone.mode === 'scanning') {
    const cx = drone.pos % W, cy = (drone.pos / W) | 0;
    for (let dy = -drone.scanRadius; dy <= drone.scanRadius; dy++) {
      for (let dx = -drone.scanRadius; dx <= drone.scanRadius; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (inBounds(nx, ny)) ter.scanned[idx(nx, ny)] = 1;
      }
    }
  }
}
