import test from "node:test";
import assert from "node:assert/strict";
import {
  CLEAR_THRESHOLD,
  createGame,
  digestRun,
  executeStep,
  qualityCheck,
  runPlan,
  serializeGame,
  restoreGame,
  summarizeRun,
} from "../src/core.js";
import { runVerification, SUCCESS_PLAN } from "../src/verification.js";

const SEED = 20261112;

test("same input produces identical task sequence, resources, and outcome", () => {
  const verification = runVerification();
  assert.equal(verification.checks.deterministic, true);
  assert.deepEqual(verification.match, {
    digest: true,
    taskSequence: true,
    resources: true,
    result: true,
  });
  assert.equal(verification.runs.successA.summary.outcome, "success");
  assert.equal(verification.runs.successB.summary.outcome, "success");
});

test("GUST-01 repeatably fails without intervention and keeps before/after snapshots", () => {
  const first = runPlan({ scenarioId: "gust", seed: SEED, plan: {} });
  const second = runPlan({ scenarioId: "gust", seed: SEED, plan: {} });
  assert.equal(first.outcome, "failure");
  assert.equal(second.outcome, "failure");
  assert.equal(digestRun(first), digestRun(second));
  assert.equal(first.fault.triggeredAt, 2);
  assert.equal(first.fault.before.tick, 1);
  assert.equal(first.fault.after.tick, 2);
  assert.ok(first.retakeQueue.length >= 3);
  assert.ok(first.events.some((event) => event.type === "MISSION_FAILURE"));
});

test("wind noise rejects samples and triggers a later successful rerecord", () => {
  const verification = runVerification();
  const run = verification.runs.successA;
  assert.ok(run.noise.windRejectedCount > 0);
  assert.ok(run.noise.retakeEvents.length > 0);
  assert.ok(run.noise.retakeEvents.every((event) => event.tick > run.fault.triggeredAt));

  const noisyEvents = verification.runs.successA.summary;
  assert.ok(noisyEvents.rejectedRecordings >= 3);
  assert.ok(run.noise.retakeEvents.some((event) => event.message.includes("清晰录音")));
});

test("recovery is followed by four clean fixed observation segments", () => {
  const verification = runVerification();
  const run = verification.runs.successA;
  const records = run.observation.records;
  assert.equal(records.length, 4);
  assert.equal(run.observation.passed, true);
  assert.deepEqual(
    records.map((record) => record.tick),
    [run.observation.startTick + 1, run.observation.startTick + 2, run.observation.startTick + 3, run.observation.startTick + 4],
  );
  for (const record of records) {
    assert.equal(record.pendingRetakes, 0);
    assert.equal(record.faultActive, false);
    assert.equal(record.errorEvents, 0);
    assert.equal(record.passed, true);
  }
  assert.deepEqual(run.observation.residualErrorFlags, []);
  assert.equal(run.summary.pendingRetakes, 0);
  assert.equal(run.summary.faultStatus, "recovered");
});

test("lights change flock paths, count disturbances, and prevent success", () => {
  const plan = {
    1: {
      ...SUCCESS_PLAN[1],
      lightsOn: true,
    },
  };
  const state = runPlan({ scenarioId: "gust", seed: SEED, plan, maxTicks: 14 });
  assert.equal(state.outcome, "failure");
  assert.ok(state.disturbanceCount > 0);
  assert.ok(Object.values(state.flocks).some((flock) => flock.disturbed));
  assert.ok(
    state.events.some((event) => event.type === "DISTURBANCE" && event.tick === 1),
  );
});

test("mid-run device move applies a settling penalty in the next segment", () => {
  let initial = createGame({ scenarioId: "calm", seed: SEED });
  initial.devices.R2.queuedZone = 1;
  initial.devices.R2.power = 95;
  initial.devices.R2.frequency = 3;
  let state = executeStep(initial);
  assert.equal(state.devices.R2.zone, 1);
  assert.equal(state.devices.R2.settling, true);
  assert.ok(state.events.some((event) => event.type === "DEVICE_MOVED"));
  state = executeStep(state);
  assert.equal(state.devices.R2.settling, false);
});

test("game state persists and resumes to the same deterministic digest", () => {
  let initial = createGame({ scenarioId: "gust", seed: SEED });
  initial.devices.R2.power = 95;
  initial.devices.R2.frequency = 3;
  initial.devices.R2.queuedZone = 1;
  const uninterrupted = executeStep(initial);
  const saved = serializeGame(uninterrupted);
  const restored = restoreGame(saved);
  assert.equal(digestRun(restored), digestRun(uninterrupted));
  const continuedRaw = executeStep(uninterrupted);
  const continuedRestored = executeStep(restored);
  assert.equal(digestRun(continuedRestored), digestRun(continuedRaw));
  assert.equal(summarizeRun(continuedRestored).ticks, 2);
});

test("quality checks reject high wind even at high sampling frequency", () => {
  const result = qualityCheck("recording", 99, {
    wind: 4,
    frequency: 3,
    settling: false,
  });
  assert.equal(result.status, "rejected");
  assert.ok(result.issues.includes("风噪"));
  assert.equal(result.checks.find((check) => check.id === "signal").passed, true);
  assert.ok(CLEAR_THRESHOLD > 0);
});

test("reset factory creates a clean idle run", () => {
  const fresh = createGame({ scenarioId: "gust", seed: SEED });
  assert.equal(fresh.tick, 0);
  assert.equal(fresh.status, "planning");
  assert.equal(fresh.outcome, "active");
  assert.equal(fresh.retakeQueue.length, 0);
  assert.equal(fresh.fault.active, false);
  assert.equal(fresh.fault.status, "idle");
  assert.equal(fresh.disturbanceCount, 0);
  assert.equal(fresh.recoveryObservation.completed, 0);
  assert.ok(Object.values(fresh.devices).every((device) => device.battery === 100));
});
