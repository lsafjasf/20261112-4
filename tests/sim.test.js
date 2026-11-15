import test from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS,
  Simulation,
  getControlProfile,
} from "../src/sim.js";
import {
  buildAuditReport,
  buildFailureTrial,
  buildMissionTrial,
  observeRecovery,
  replayInputs,
} from "../src/scenarios.js";

test("fixed seed mission completes twice with identical task and resource traces", () => {
  const mission = buildMissionTrial({ seed: 550 });
  assert.equal(mission.result, "complete");
  assert.deepEqual(mission.deliveryOrder, ["panel", "tank", "truss", "core"]);

  const first = replayInputs(550, mission.inputs);
  const second = replayInputs(550, mission.inputs);
  assert.equal(first.snapshots.length, second.snapshots.length);
  assert.equal(first.sim.state.tick, mission.tick);
  assert.deepEqual(
    first.snapshots.map((snapshot) => JSON.stringify(snapshot)),
    second.snapshots.map((snapshot) => JSON.stringify(snapshot)),
  );
  assert.equal(first.sim.hash(), second.sim.hash());
  assert.equal(first.sim.state.status, "complete");
  assert.equal(first.sim.state.deliveredCount, 4);
  assert.deepEqual(first.sim.state.deliveryOrder, mission.deliveryOrder);
  assert.deepEqual(
    first.sim.state.events.map((event) => `${event.tick}:${event.type}`),
    second.sim.state.events.map((event) => `${event.tick}:${event.type}`),
  );
});

test("capturing debris changes mass, inertia and both control accelerations", () => {
  const mission = buildMissionTrial({ seed: 550 });
  const capture = mission.events.find((event) => event.type === "capture");
  assert.ok(capture);

  const before = replayInputs(550, mission.inputs.slice(0, capture.tick - 1));
  const after = replayInputs(550, mission.inputs.slice(0, capture.tick));
  assert.equal(before.sim.state.attachedId, null);
  assert.equal(after.sim.state.attachedId, "panel");

  const beforeProfile = getControlProfile(before.sim.state);
  const afterProfile = getControlProfile(after.sim.state);
  assert.ok(afterProfile.totalMass > beforeProfile.totalMass);
  assert.ok(afterProfile.inertia > beforeProfile.inertia);
  assert.ok(afterProfile.linearAccel < beforeProfile.linearAccel);
  assert.ok(afterProfile.angularAccel < beforeProfile.angularAccel);
});

test("repeatable no-go failure records state immediately before and at the trigger", () => {
  const first = buildFailureTrial({ seed: 550 });
  const second = buildFailureTrial({ seed: 550 });
  assert.equal(first.failure?.reason, "NO_GO");
  assert.equal(first.failure?.label, "进入禁航带");
  assert.equal(first.inputs.length, second.inputs.length);

  assert.equal(first.failure.before.tick, first.failure.at.tick - 1);
  assert.equal(first.failure.before.status, "active");
  assert.equal(first.failure.at.status, "failed");
  assert.equal(first.failure.at.failureReason, "NO_GO");
  assert.ok(first.failure.at.ship.x > 1000);
  assert.ok(first.failure.at.ship.y < 360);
  assert.deepEqual(first.failure.before.debris, first.failure.at.debris);

  const replayA = replayInputs(550, first.inputs);
  const replayB = replayInputs(550, second.inputs);
  assert.equal(replayA.sim.hash(), replayB.sim.hash());
  assert.equal(replayA.sim.state.failure.reason, replayB.sim.state.failure.reason);
});

test("reset recovery leaves no residual state during a fixed 10 second observation", () => {
  const failure = buildFailureTrial({ seed: 550 });
  const recovery = observeRecovery(550, failure.inputs, 600);
  assert.equal(recovery.pass, true);
  assert.equal(recovery.observationSeconds, 10);
  assert.equal(recovery.after.tick, 600);
  assert.equal(recovery.after.status, "active");
  assert.equal(recovery.after.failureReason, null);
  assert.equal(recovery.after.fuel, LIMITS.fuel);
  assert.equal(recovery.after.collisionCount, 0);
  assert.equal(recovery.after.deliveredCount, 0);
  assert.equal(recovery.after.attachedId, null);
  assert.equal(recovery.after.totalMass, 1200);
  assert.ok(recovery.after.debris.every((debris) => debris.state === "free"));

  const fresh = new Simulation({ seed: 550 });
  assert.equal(recovery.after.inertia, getControlProfile(fresh.state).inertia);
  assert.deepEqual(recovery.observations.at(-1), recovery.after);
});

test("audit report verifies success and failure branches together", () => {
  const report = buildAuditReport({ seed: 550 });
  assert.equal(report.mission.pass, true);
  assert.equal(report.mission.status, "complete");
  assert.equal(report.mission.deliveryOrder.length, 4);
  assert.equal(report.mission.traceHash, report.mission.replayHash);
  assert.equal(report.mission.controlChanged, true);
  assert.ok(report.mission.loadedProfile.linearAccel < report.mission.initialProfile.linearAccel);
  assert.equal(report.failure.pass, true);
  assert.equal(report.failure.reason, "NO_GO");
  assert.equal(report.failure.traceHash, report.failure.replayHash);
  assert.equal(report.recovery.pass, true);
  assert.equal(report.recovery.after.status, "active");
});
