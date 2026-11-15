// Scripted command scenarios — same input sequence must replay deterministically.
import { idx, W } from './terrain.js';

export const SEED = 20261115;

function vline(x, y0, y1) {
  const cells = [];
  for (let y = y0; y <= y1; y++) cells.push(idx(x, y));
  return cells;
}

function hline(y, x0, x1) {
  const cells = [];
  for (let x = x0; x <= x1; x++) cells.push(idx(x, y));
  return cells;
}

// FAILURE: crew ordered to cut a firebreak right on the active fire front
// (ridge 1, upwind side). Fire reaches the crew before the line is done.
export function failureScenario() {
  return {
    name: 'failure-crew-trapped',
    seed: SEED,
    commands: [
      { tick: 2, cmd: { type: 'drone', cell: idx(14, 12) } },
      { tick: 5, cmd: { type: 'dig', cells: vline(16, 10, 16) } },
      // No evacuation order — the crew keeps digging as the front arrives.
    ],
  };
}

// SUCCESS: recon first, trucks hold the flanks, firebreak cut well ahead of
// the front between the ridges and the village, crew pulled out early.
export function successScenario() {
  return {
    name: 'success-standard',
    seed: SEED,
    commands: [
      { tick: 2, cmd: { type: 'drone', cell: idx(30, 15) } },
      { tick: 4, cmd: { type: 'truck', id: 0, cell: idx(48, 8) } },
      { tick: 6, cmd: { type: 'truck', id: 1, cell: idx(50, 12) } },
      // Close the gap between the north end of the vertical road and the
      // village's north edge — the only flank not covered by existing roads.
      { tick: 8, cmd: { type: 'dig', cells: [...vline(46, 0, 9), ...hline(9, 47, 49)] } },
      { tick: 120, cmd: { type: 'evacuate' } },
      { tick: 150, cmd: { type: 'drone', cell: idx(44, 11) } },
    ],
  };
}

export function cellName(cell) {
  return `(${cell % W},${(cell / W) | 0})`;
}
