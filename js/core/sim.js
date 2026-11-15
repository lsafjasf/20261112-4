// Sim orchestrator: fixed-timestep, command queue, event log, state hashing.
import { buildTerrain, W, H, idx, FUEL_BURNING, FUEL_BURNED } from './terrain.js';
import { createRng, hashString } from './rng.js';
import { stepFire, countBurning, ignite, SIM_TICKS, windAt } from './fire.js';
import { createTrucks, stepTruck, commandTruck } from './resources.js';
import { createCrew, stepCrew, commandDig, commandEvacuate, createDrone, stepDrone, commandDrone } from './crew.js';

export { SIM_TICKS };

export function createSim(seed) {
  const ter = buildTerrain(seed);
  const rng = createRng(seed);
  const sim = {
    seed, tick: 0, ter, rng,
    trucks: createTrucks(ter),
    crew: createCrew(ter),
    drone: createDrone(ter),
    events: [],
    hashes: [],
    scheduled: [],
    status: 'running',
    lostReason: null,
    wind: windAt(0, seed),
  };
  // Three ignition points, one on each ridge — deterministic from seed.
  for (const r of ter.ridges) {
    const t = 0.15 + rng.next() * 0.2;
    const x = Math.round(r.x0 + (r.x1 - r.x0) * t);
    const y = Math.round(r.y0 + (r.y1 - r.y0) * t);
    ignite(ter, idx(x, y));
  }
  sim.events.push({ tick: 0, type: 'ignition', points: 3 });
  return sim;
}

export function schedule(sim, tick, cmd) {
  sim.scheduled.push({ tick, cmd });
  sim.scheduled.sort((a, b) => a.tick - b.tick);
}

export function issue(sim, cmd) {
  applyCommand(sim, cmd);
}

function applyCommand(sim, cmd) {
  const t = sim.tick;
  if (cmd.type === 'truck') commandTruck(sim.trucks[cmd.id], sim.ter, cmd.cell, t, sim.events);
  else if (cmd.type === 'dig') commandDig(sim.crew, cmd.cells, t, sim.events);
  else if (cmd.type === 'evacuate') commandEvacuate(sim.crew, sim.ter, t, sim.events);
  else if (cmd.type === 'drone') commandDrone(sim.drone, cmd.cell, t, sim.events);
}

export function villageDamage(sim) {
  let damaged = 0;
  for (const c of sim.ter.village) {
    if (sim.ter.fuel[c] === FUEL_BURNING || sim.ter.fuel[c] === FUEL_BURNED) damaged++;
  }
  return sim.ter.village.length ? damaged / sim.ter.village.length : 0;
}

export function step(sim) {
  if (sim.status !== 'running') return;
  const tick = sim.tick;

  while (sim.scheduled.length && sim.scheduled[0].tick === tick) {
    applyCommand(sim, sim.scheduled.shift().cmd);
  }

  sim.wind = stepFire(sim.ter, sim.rng, tick, sim.seed, sim.events);
  for (const truck of sim.trucks) stepTruck(truck, sim.ter, tick, sim.events);
  stepCrew(sim.crew, sim.ter, tick, sim.events);
  stepDrone(sim.drone, sim.ter, tick, sim.events);

  for (let i = 0; i < W * H; i++) {
    if (sim.ter.scanned[i] > 0) sim.ter.scanned[i] = Math.max(0, sim.ter.scanned[i] - 0.005);
  }

  // Failure / victory evaluation.
  if (sim.crew.trapped) endSim(sim, 'lost', '开挖组被火围困');
  const dmg = villageDamage(sim);
  if (dmg > 0.4) endSim(sim, 'lost', `村庄损毁 ${(dmg * 100).toFixed(0)}%`);
  if (sim.tick >= SIM_TICKS && sim.status === 'running') {
    // "火线受控": no active fire within 8 cells of the village perimeter.
    let minDist = Infinity;
    for (let i = 0; i < W * H; i++) {
      if (sim.ter.fuel[i] !== FUEL_BURNING) continue;
      const x = i % W, y = (i / W) | 0;
      for (const v of sim.ter.village) {
        const d = Math.hypot(x - (v % W), y - ((v / W) | 0));
        if (d < minDist) minDist = d;
      }
    }
    if (minDist > 8) endSim(sim, 'won', '四小时控制火线,村庄安全');
    else endSim(sim, 'lost', `时间耗尽,火线距村庄仅 ${minDist.toFixed(1)} 格`);
  }

  sim.tick++;
  if (sim.tick % 10 === 0 || sim.status !== 'running') {
    sim.hashes.push({ tick: sim.tick, hash: stateHash(sim) });
  }
}

function endSim(sim, status, reason) {
  if (sim.status !== 'running') return;
  sim.status = status;
  sim.lostReason = status === 'lost' ? reason : null;
  sim.events.push({ tick: sim.tick, type: status, reason });
}

export function stateHash(sim) {
  const t = sim.ter;
  let s = `${sim.tick}|${sim.rng.getState()}|${sim.status}`;
  // Quantize floats to keep hash stable and cheap.
  for (let i = 0; i < W * H; i++) {
    s += t.fuel[i];
    s += ((t.intensity[i] * 255) | 0).toString(36);
    s += ((t.wet[i] * 255) | 0).toString(36);
  }
  for (const tr of sim.trucks) s += `T${tr.pos}${tr.water}${tr.mode}`;
  s += `C${sim.crew.pos}${sim.crew.trapped}${sim.crew.queue.length}${sim.crew.digging}`;
  s += `D${sim.drone.pos}${sim.drone.mode}`;
  return hashString(s);
}

// Detailed snapshot for failure-scenario forensics.
export function snapshot(sim, label) {
  return {
    label, tick: sim.tick, status: sim.status,
    wind: { dir: +sim.wind.dir.toFixed(3), speed: +sim.wind.speed.toFixed(3) },
    burning: countBurning(sim.ter),
    villageDamage: +villageDamage(sim).toFixed(3),
    crew: { pos: sim.crew.pos, trapped: sim.crew.trapped, queue: sim.crew.queue.length, digging: sim.crew.digging },
    trucks: sim.trucks.map(t => ({ id: t.id, pos: t.pos, water: t.water, mode: t.mode })),
    drone: { pos: sim.drone.pos, mode: sim.drone.mode },
    hash: stateHash(sim),
  };
}
