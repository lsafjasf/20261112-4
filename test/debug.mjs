// Debug helper: print ignition points and fire-front progression.
import { createSim, step } from '../js/core/sim.js';
import { countBurning } from '../js/core/fire.js';
import { W, H, FUEL_BURNING } from '../js/core/terrain.js';
import { SEED } from '../js/core/scenarios.js';

const sim = createSim(SEED);
const pts = [];
for (let i = 0; i < W * H; i++) {
  if (sim.ter.fuel[i] === FUEL_BURNING) pts.push(`(${i % W},${(i / W) | 0})`);
}
console.log('ignition points:', pts.join(' '));
console.log('village cells:', sim.ter.village.map(c => `(${c % W},${(c / W) | 0})`).join(' '));

for (let t = 0; t <= 480; t++) {
  if (t % 40 === 0) {
    let minX = 99, maxX = -1, minY = 99, maxY = -1;
    for (let i = 0; i < W * H; i++) {
      if (sim.ter.fuel[i] === FUEL_BURNING) {
        const x = i % W, y = (i / W) | 0;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    const w = sim.wind;
    console.log(`t=${t} burning=${countBurning(sim.ter)} bbox=(${minX},${minY})-(${maxX},${maxY}) wind=${w.speed.toFixed(1)}@${(w.dir * 180 / Math.PI).toFixed(0)}deg`);
  }
  if (sim.status === 'running') step(sim);
}
console.log('final:', sim.status, sim.lostReason);
