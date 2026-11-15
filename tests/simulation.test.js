import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSimulation,
  enqueueCommand,
  runSimulation,
  tickSimulation,
} from '../src/engine.js';
import { digest, stableStringify, verificationPayload } from '../src/digest.js';
import { getScenario } from '../src/scenarios.js';
import { RECOVERY_WATCH_SECONDS } from '../src/model.js';

test('same burst-replanning inputs produce identical tasks, resources, and final result', () => {
  const first = runSimulation(getScenario('burst-replan'));
  const second = runSimulation(getScenario('burst-replan'));
  const payloadA = verificationPayload(first.result);
  const payloadB = verificationPayload(second.result);

  assert.equal(stableStringify(payloadA), stableStringify(payloadB));
  assert.equal(digest(payloadA.taskSequence), digest(payloadB.taskSequence));
  assert.equal(digest(payloadA.resources), digest(payloadB.resources));
  assert.equal(digest(payloadA.final), digest(payloadB.final));
  assert.equal(first.result.status, 'passed');
  assert.equal(second.result.status, 'passed');
  assert.equal(first.result.finishedAtSec, second.result.finishedAtSec);
  const stationPumped = first.result.stationSummaries.reduce((sum, station) => sum + station.pumpedM3, 0);
  const stationEnergy = first.result.stationSummaries.reduce((sum, station) => sum + station.energyKWh, 0);
  assert.ok(Math.abs(first.result.totals.pumpedM3 - stationPumped) < 1);
  assert.ok(Math.abs(first.result.totals.energyKWh - stationEnergy) < 1);
  assert.ok(first.result.totals.pumpedM3 > 0);
});

test('burst incident records state before and after, then isolates and repairs', () => {
  const state = runSimulation(getScenario('burst-replan'));
  assert.equal(state.result.checks.burstIncidents, 1);
  const incident = state.faultRecords[0];
  assert.ok(incident);
  assert.equal(incident.segment, 'S2');
  assert.equal(incident.detectedClock, '01:07:30');
  assert.ok(incident.before);
  assert.ok(incident.after);
  assert.notEqual(incident.before.pressure.central, incident.after.pressure.central);
  assert.equal(incident.before.burst, null);
  assert.equal(incident.after.burst.status, 'active');
  assert.ok(incident.resolution.isolated);
  assert.ok(incident.resolution.repaired);
  assert.equal(incident.resolution.repaired.snapshot.burst.status, 'repaired');
});

test('post-recovery watch lasts 30 minutes with no pending commands or residual faults', () => {
  const state = runSimulation(getScenario('burst-replan'));
  const watch = state.result.checks.recoveryWatch;

  assert.equal(watch.requiredSec, RECOVERY_WATCH_SECONDS);
  assert.equal(watch.completed, true);
  assert.equal(watch.clean, true);
  assert.equal(watch.samples, RECOVERY_WATCH_SECONDS / 30);
  assert.equal(watch.endsAt - watch.startedAt, RECOVERY_WATCH_SECONDS);
  assert.deepEqual(watch.issues, []);
  assert.equal(state.recoveryWatch.pendingCommandTicks, 0);
  assert.equal(state.pendingCommands.length, 0);
  assert.equal(state.burst.status, 'repaired');
  assert.ok(Object.values(state.facilities).every((facility) => !facility.flooded));
});

test('unrecovered burst is a repeatable failure scenario', () => {
  const first = runSimulation(getScenario('burst-failure'));
  const second = runSimulation(getScenario('burst-failure'));

  assert.equal(first.result.status, 'failed');
  assert.equal(second.result.status, 'failed');
  assert.equal(first.result.finishedAtSec, second.result.finishedAtSec);
  assert.equal(first.result.reason, second.result.reason);
  assert.equal(first.result.finishedClock, second.result.finishedClock);
  assert.match(first.result.reason, /进水/);
  assert.equal(first.faultRecords[0].detectedClock, second.faultRecords[0].detectedClock);
  assert.equal(stableStringify(first.result.faultRecords), stableStringify(second.result.faultRecords));
});

test('pump commands honor configured control delay', () => {
  const state = createSimulation(getScenario('routine'));
  const task = enqueueCommand(state, { type: 'setPump', station: 'P1', value: 80 });
  assert.equal(task.effectiveAt, 45);
  tickSimulation(state);
  assert.equal(state.pumps.P1.targetSpeed, 54);
  tickSimulation(state);
  assert.equal(state.pumps.P1.targetSpeed, 54);
  tickSimulation(state);
  assert.equal(state.pumps.P1.targetSpeed, 80);
  assert.equal(task.status, 'applied');
  assert.equal(task.appliedAt, 60);
});

test('low network pressure marks fire hydrants unavailable', () => {
  const state = createSimulation(getScenario('routine'));
  for (const station of ['P1', 'P2', 'P3', 'P4']) {
    enqueueCommand(state, { type: 'setPump', station, value: 0 });
  }
  while (state.timeSec < 3600 && !state.result) tickSimulation(state);

  assert.ok(state.hydrantLowSec > 0);
  assert.ok(Object.values(state.zones).some((zone) => !zone.hydrantAvailable));
  assert.ok(Object.values(state.zones).every((zone) => zone.minPressure < 2.8));
});
