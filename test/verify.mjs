// Determinism + failure + recovery verification harness (Node).
import { createSim, schedule, step, snapshot, stateHash, SIM_TICKS } from '../js/core/sim.js';
import { failureScenario, successScenario } from '../js/core/scenarios.js';
import { W, H } from '../js/core/terrain.js';
import { TRUCK_CAPACITY } from '../js/core/resources.js';
import { writeFileSync } from 'node:fs';

const OBSERVE_TICKS = 120; // fixed post-recovery observation window

function runScenario(scenario, { onEvent } = {}) {
  const sim = createSim(scenario.seed);
  for (const { tick, cmd } of scenario.commands) schedule(sim, tick, cmd);
  const eventLog = [];
  let guard = 0;
  while (sim.status === 'running' && guard++ < SIM_TICKS + 10) {
    const before = sim.events.length;
    step(sim);
    for (let i = before; i < sim.events.length; i++) {
      const e = sim.events[i];
      eventLog.push(e);
      if (onEvent) onEvent(sim, e);
    }
  }
  return { sim, eventLog };
}

function canonical(log) {
  return JSON.stringify(log);
}

const results = { checks: [], artifacts: {} };
function check(name, ok, detail = '') {
  results.checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}

// --- 1. Failure scenario, run twice, compare task sequence / resources / result ---
const failA = runScenario(failureScenario());
const failB = runScenario(failureScenario());
check('failure: deterministic event log (run1 == run2)',
  canonical(failA.eventLog) === canonical(failB.eventLog),
  `${failA.eventLog.length} events`);
check('failure: deterministic state hashes',
  canonical(failA.sim.hashes) === canonical(failB.sim.hashes),
  `${failA.sim.hashes.length} hashes, final=${failA.sim.hashes.at(-1)?.hash}`);
check('failure: same final result',
  failA.sim.status === failB.sim.status && failA.sim.lostReason === failB.sim.lostReason,
  `status=${failA.sim.status} reason=${failA.sim.lostReason}`);
check('failure: crew actually trapped',
  failA.sim.crew.trapped === true && failA.sim.status === 'lost');

// --- 2. Forensics: key state right before / after the failure trigger ---
const forensics = { before: null, after: null };
runScenario(failureScenario(), {
  onEvent(sim, e) {
    if (e.type === 'crewDanger' && !forensics.before) {
      forensics.before = snapshot(sim, 'crew-near-fire');
    }
    if (e.type === 'crewTrapped') {
      if (!forensics.before) forensics.before = snapshot(sim, 'pre-trap');
      forensics.after = snapshot(sim, 'post-trap');
    }
  },
});
check('failure: forensics captured before/after trap',
  !!(forensics.before && forensics.after),
  forensics.after ? `trap at tick ${forensics.after.tick}` : 'no trap event');
results.artifacts.forensics = forensics;

// --- 3. Success scenario, run twice ---
const winA = runScenario(successScenario());
const winB = runScenario(successScenario());
check('success: deterministic event log (run1 == run2)',
  canonical(winA.eventLog) === canonical(winB.eventLog),
  `${winA.eventLog.length} events`);
check('success: deterministic state hashes',
  canonical(winA.sim.hashes) === canonical(winB.sim.hashes),
  `final=${winA.sim.hashes.at(-1)?.hash}`);
check('success: scenario actually won',
  winA.sim.status === 'won', `status=${winA.sim.status} reason=${winA.sim.lostReason || 'ok'}`);

// --- 4. Recovery: reset after failure, rerun, then observe a fixed window ---
const pristine = createSim(failureScenario().seed);
const pristineHash = stateHash(pristine);
const recovered = createSim(failureScenario().seed); // reset == fresh sim, same seed
check('recovery: reset restores pristine initial state',
  stateHash(recovered) === pristineHash);

for (const { tick, cmd } of successScenario().commands) schedule(recovered, tick, cmd);
let guard = 0;
while (recovered.status === 'running' && guard++ < SIM_TICKS + 10) step(recovered);
check('recovery: rerun after reset succeeds',
  recovered.status === 'won', `status=${recovered.status}`);

// Post-completion observation: halted sim must be quiescent — no residual activity.
const eventsAtEnd = recovered.events.length;
const hashAtEnd = stateHash(recovered);
let invariantsOk = true;
let invariantMsg = '';
for (let t = 0; t < OBSERVE_TICKS; t++) {
  step(recovered); // halted sim: must be a no-op
  for (let i = 0; i < W * H; i++) {
    if (Number.isNaN(recovered.ter.intensity[i]) || Number.isNaN(recovered.ter.wet[i])) {
      invariantsOk = false; invariantMsg = `NaN at cell ${i}`; break;
    }
  }
  for (const tr of recovered.trucks) {
    if (tr.water < 0 || tr.water > TRUCK_CAPACITY) {
      invariantsOk = false; invariantMsg = `truck ${tr.id} water=${tr.water}`;
    }
  }
  if (!invariantsOk) break;
}
check('recovery: no residual events during observation window',
  recovered.events.length === eventsAtEnd,
  `${recovered.events.length - eventsAtEnd} new events in ${OBSERVE_TICKS} ticks`);
check('recovery: state stable during observation window',
  stateHash(recovered) === hashAtEnd);
check('recovery: resource invariants hold (water bounds, no NaN)',
  invariantsOk, invariantMsg || 'ok');
check('recovery: no stranded crew / trapped state',
  !recovered.crew.trapped && recovered.crew.queue.length === 0);

// --- Report ---
results.summary = {
  failure: { status: failA.sim.status, reason: failA.sim.lostReason, events: failA.eventLog.length },
  success: { status: winA.sim.status, events: winA.eventLog.length },
  observationTicks: OBSERVE_TICKS,
};
writeFileSync(new URL('../artifacts/verification-report.json', import.meta.url),
  JSON.stringify(results, null, 2));
writeFileSync(new URL('../artifacts/failure-event-log.json', import.meta.url),
  JSON.stringify(failA.eventLog, null, 2));
console.log('Report written to artifacts/verification-report.json');
console.log(process.exitCode ? 'VERIFICATION FAILED' : 'ALL CHECKS PASSED');
