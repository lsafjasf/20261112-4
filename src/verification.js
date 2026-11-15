import {
  digestRun,
  runPlan,
  summarizeRun,
} from "./core.js";

const HIGH_POWER = { power: 95, frequency: 3 };

export const SUCCESS_PLAN = {
  1: {
    lightsOn: false,
    devices: {
      R1: { ...HIGH_POWER },
      R2: { ...HIGH_POWER, moveTo: 1 },
      R3: { ...HIGH_POWER, moveTo: 2 },
      D1: { ...HIGH_POWER },
    },
  },
};

export const FAILURE_PLAN = {};

function errorChecks(state) {
  const flags = [];
  if (state.retakeQueue.length > 0) flags.push("pending-retakes");
  if (state.fault.active) flags.push("active-fault");
  if (state.devices.D1.status === "offline") flags.push("drone-offline");
  if (state.disturbanceCount > 0) flags.push("bird-disturbance");
  if (state.recoveryObservation.active) flags.push("observation-running");
  return flags;
}

function collectRunProof(state) {
  const summary = summarizeRun(state);
  const faultEvent = state.events.find((event) => event.type === "FAULT_TRIGGERED");
  const recoveredEvent = state.events.find((event) => event.type === "FAULT_RECOVERED");
  const rejectedEvents = state.events.filter((event) => event.type === "QUALITY_REJECTED");
  const retakeEvents = state.events.filter(
    (event) => event.type === "RECORDING_CLEAR" && event.data?.isRetake,
  );
  return {
    summary,
    digest: digestRun(state),
    errorFlags: errorChecks(state),
    fault: {
      armedAt: state.events.find((event) => event.type === "FAULT_ARMED")?.tick ?? null,
      triggeredAt: state.fault.triggeredAt,
      recoveredAt: state.fault.recoveredAt,
      reason: state.fault.reason,
      before: state.fault.before,
      after: state.fault.after,
      triggerMessage: faultEvent?.message ?? null,
      recoveryMessage: recoveredEvent?.message ?? null,
    },
    noise: {
      rejectedCount: rejectedEvents.length,
      windRejectedCount: rejectedEvents.filter((event) =>
        event.data?.checks?.some((check) => check.id === "wind-noise" && !check.passed),
      ).length,
      retakeEvents: retakeEvents.map((event) => ({
        tick: event.tick,
        message: event.message,
        flockId: event.data?.flockId,
        quality: event.data?.quality,
      })),
    },
    observation: {
      startTick: state.recoveryObservation.startTick,
      required: state.recoveryObservation.required,
      completed: state.recoveryObservation.completed,
      passed: state.recoveryObservation.passed,
      failures: state.recoveryObservation.failures,
      records: state.observations,
      residualErrorFlags: errorChecks(state),
    },
  };
}

export function runVerification() {
  const runA = runPlan({ scenarioId: "gust", seed: 20261112, plan: SUCCESS_PLAN });
  const runB = runPlan({ scenarioId: "gust", seed: 20261112, plan: SUCCESS_PLAN });
  const failureRun = runPlan({ scenarioId: "gust", seed: 20261112, plan: FAILURE_PLAN });
  const proofA = collectRunProof(runA);
  const proofB = collectRunProof(runB);
  const failureProof = collectRunProof(failureRun);

  const match = {
    digest: proofA.digest === proofB.digest,
    taskSequence:
      JSON.stringify(runA.events.map(({ tick, type, message }) => [tick, type, message])) ===
      JSON.stringify(runB.events.map(({ tick, type, message }) => [tick, type, message])),
    resources: JSON.stringify(proofA.summary.devices) === JSON.stringify(proofB.summary.devices),
    result:
      proofA.summary.outcome === proofB.summary.outcome &&
      proofA.summary.tracks.join(",") === proofB.summary.tracks.join(","),
  };

  const recoveryRecords = proofA.observation.records;
  const expectedRecoveryTicks = Array.from(
    { length: proofA.observation.required },
    (_, index) => (proofA.observation.startTick ?? 0) + index + 1,
  );
  const observationContiguous =
    recoveryRecords.length === proofA.observation.required &&
    recoveryRecords.every((record, index) => record.tick === expectedRecoveryTicks[index]);
  const recoveryClean =
    proofA.observation.passed &&
    proofA.observation.residualErrorFlags.length === 0 &&
    recoveryRecords.every(
      (record) =>
        record.passed &&
        record.pendingRetakes === 0 &&
        record.faultActive === false &&
        record.errorEvents === 0,
    ) &&
    observationContiguous;

  const checks = {
    deterministic: Object.values(match).every(Boolean),
    noiseRetake:
      proofA.noise.windRejectedCount > 0 &&
      proofA.noise.retakeEvents.length > 0 &&
      proofA.noise.retakeEvents.every((event) => event.tick > proofA.fault.triggeredAt),
    repeatableFailure:
      failureProof.summary.outcome === "failure" &&
      failureProof.fault.triggeredAt !== null &&
      failureProof.fault.before !== null &&
      failureProof.fault.after !== null,
    recoveryClean,
    successPath: proofA.summary.outcome === "success" && proofA.errorFlags.length === 0,
  };

  return {
    generatedAt: new Date().toISOString(),
    input: {
      scenarioId: "gust",
      seed: 20261112,
      successPlan: SUCCESS_PLAN,
      failurePlan: FAILURE_PLAN,
    },
    match,
    checks,
    allPassed: Object.values(checks).every(Boolean),
    runs: {
      successA: proofA,
      successB: proofB,
      failure: failureProof,
    },
  };
}
