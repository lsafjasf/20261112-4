import test from "node:test";
import assert from "node:assert/strict";
import { BlackwaterGame, TICK } from "../src/game.js";
import { makeWorld, checkReachability } from "../src/world.js";
import {
  runFailureScenario,
  runRecoveryScenario,
  runDoubleAudit,
} from "../src/scenarios.js";

const SEED = 7319;

test("fixed seed produces an identical, fully reachable map", () => {
  const first = makeWorld(SEED);
  const second = makeWorld(SEED);
  assert.equal(first.layoutHash, second.layoutHash);
  assert.deepEqual(first.obstacles, second.obstacles);
  assert.deepEqual(first.artifacts, second.artifacts);

  const reachability = checkReachability(first);
  assert.equal(reachability.ok, true);
  assert.equal(reachability.passed, reachability.total);
  assert.ok(reachability.checks.some((check) => check.id === "A"));
  assert.ok(reachability.checks.some((check) => check.id === "B"));
  assert.ok(reachability.checks.some((check) => check.id === "C"));
});

test("three real samples are completed, then the return leg fails", () => {
  const evidence = runFailureScenario(SEED);
  assert.equal(evidence.sampledCount, 3);
  assert.equal(evidence.final.artifacts.A, "SAMPLED");
  assert.equal(evidence.final.artifacts.B, "SAMPLED");
  assert.equal(evidence.final.artifacts.C, "SAMPLED");
  assert.equal(evidence.final.status, "failed");
  assert.equal(evidence.failure.phase, "RETURN");
  assert.equal(evidence.failure.reason, "BATTERY_DEPLETED");
  assert.ok(evidence.faults.length >= 1);
  assert.equal(evidence.faults[0].before.activeFault, null);
  assert.equal(evidence.faults[0].after.activeFault, "PROPULSION-LEAK");
  assert.ok(evidence.faults[0].delta.arm < 0);
  assert.deepEqual(evidence.final.routeNodes, ["R1", "R2", "R3"]);
  assert.ok(evidence.timeline.length > 20);
});

test("the same inputs executed twice match in sequence, resources, and outcome", () => {
  const audit = runDoubleAudit(SEED);
  assert.equal(audit.first.layoutHash, audit.second.layoutHash);
  assert.equal(audit.first.inputDigest, audit.second.inputDigest);
  assert.deepEqual(audit.first.missionSequence, audit.second.missionSequence);
  assert.deepEqual(audit.first.timeline, audit.second.timeline);
  assert.deepEqual(audit.first.final, audit.second.final);
  assert.deepEqual(audit.first.failure, audit.second.failure);
  assert.equal(audit.pass, true);
  assert.equal(audit.first.final.status, "failed");
  assert.equal(audit.first.sampledCount, 3);
});

test("recovery is followed by ten seconds with no residual fault state", () => {
  const evidence = runRecoveryScenario(SEED);
  assert.equal(evidence.fault.code, "PROPULSION-LEAK");
  assert.equal(evidence.fault.before.activeFault, null);
  assert.equal(evidence.fault.after.activeFault, "PROPULSION-LEAK");
  assert.ok(evidence.recovery);
  assert.ok(evidence.observation.observedSeconds >= 10);
  assert.equal(evidence.residualAudit.activeFault, null);
  assert.equal(evidence.residualAudit.noActiveFault, true);
  assert.equal(evidence.residualAudit.noActiveLeak, true);
  assert.equal(evidence.residualAudit.noActivePings, true);
  assert.equal(evidence.residualAudit.noActiveSampling, true);
  assert.equal(evidence.residualAudit.noPendingTimers, true);
  assert.equal(evidence.residualAudit.stable, true);
  assert.equal(evidence.residualAudit.resourceInBounds, true);
  assert.equal(evidence.observation.end.activeFault, null);
  assert.equal(evidence.observation.end.activePings, 0);
  assert.equal(evidence.observation.end.sampling, null);
  assert.equal(evidence.observation.start.resources.arm, evidence.observation.end.resources.arm);
  assert.ok(evidence.observation.end.resources.oxygen < evidence.observation.start.resources.oxygen);
  assert.ok(evidence.observation.end.resources.battery < evidence.observation.start.resources.battery);
});

test("pause, single-step, and reset preserve deterministic control", () => {
  const game = new BlackwaterGame({ seed: SEED });
  game.start();
  game.ping();
  const beforePause = game.snapshot();
  game.setPaused(true);
  game.advanceFor(1, TICK);
  assert.deepEqual(game.snapshot(), beforePause);
  const stepped = game.stepOnce(0.1);
  assert.ok(stepped.time > beforePause.time);
  assert.equal(game.paused, true);
  assert.deepEqual(game.snapshot(), stepped);

  const reset = new BlackwaterGame({ seed: SEED });
  assert.equal(reset.snapshot().time, 0);
  assert.equal(reset.world.layoutHash, game.world.layoutHash);
  assert.deepEqual(reset.resources, { oxygen: 100, battery: 100, arm: 100 });
});
