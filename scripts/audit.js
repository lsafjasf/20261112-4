import {
  runFailureScenario,
  runRecoveryScenario,
  runDoubleAudit,
} from "../src/scenarios.js";

const seed = process.argv[2] || "7319";
const failure = runFailureScenario(seed);
const recovery = runRecoveryScenario(seed);
const dual = runDoubleAudit(seed);

const summary = {
  seed,
  layoutHash: failure.layoutHash,
  reachability: `${failure.reachability.passed}/${failure.reachability.total}`,
  failureRun: {
    durationSeconds: failure.duration,
    scans: failure.scanned,
    samples: failure.sampledCount,
    routeNodes: failure.final.routeNodes,
    finalStatus: failure.final.status,
    failureReason: failure.failure?.reason,
    failurePhase: failure.failure?.phase,
    faultSnapshots: failure.faults.map((fault) => ({
      code: fault.code,
      at: fault.at,
      before: fault.before.resources,
      after: fault.after.resources,
      delta: fault.delta,
    })),
  },
  recoveryRun: {
    faultAt: recovery.fault?.at,
    recoveredAt: recovery.recovery?.at,
    observationSeconds: recovery.observation?.observedSeconds,
    activeFault: recovery.residualAudit?.activeFault,
    activeLeaks: recovery.residualAudit?.activeLeaks,
    activePings: recovery.residualAudit?.activePings,
    activeSampling: recovery.residualAudit?.activeSampling,
    pendingTimers: recovery.residualAudit?.pendingTimers,
    pass: recovery.residualAudit?.stable && recovery.residualAudit?.noActiveFault,
  },
  dualRun: {
    checks: dual.checks,
    pass: dual.pass,
    missionEvents: dual.first.missionSequence.length,
    resourceSamples: dual.first.timeline.length,
    final: dual.first.final,
  },
};

console.log(JSON.stringify(summary, null, 2));
if (!dual.pass || failure.sampledCount !== 3 || failure.final.status !== "failed" || !summary.recoveryRun.pass) {
  process.exitCode = 1;
}
