import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import {
  DEFAULT_INPUT,
  compareRuns,
  runSchedule,
} from "../simulation.js";

const standard = runSchedule(DEFAULT_INPUT);
assert.equal(standard.summary.outcome, "SUCCESS");
assert.equal(standard.records.A.qualified, true);
assert.equal(standard.records.B.qualified, true);
assert.ok(standard.wear < 100);

const earlyInput = { ...DEFAULT_INPUT, scenario: "early" };
const comparison = compareRuns(earlyInput);
assert.equal(comparison.match, true);
assert.equal(comparison.runA.summary.outcome, "ABORTED");
assert.equal(comparison.runB.summary.outcome, "ABORTED");
assert.equal(comparison.runA.errorCode, "E_DUST_INGRESS");
assert.match(comparison.runA.records.B.status, /记录保留/);
assert.ok(comparison.runA.records.B.exposure > 0);

const recovered = runSchedule(earlyInput, { recover: true });
const recovery = recovered.recovery.report;
assert.equal(recovery.passed, true);
assert.equal(recovery.observedSeconds, 12);
assert.equal(recovery.activeJobs, 0);
assert.equal(recovery.errorCode, null);
assert.deepEqual(recovery.drift, {
  wear: 0,
  power: 0,
  dataMB: 0,
  AExposure: 0,
  BExposure: 0,
});

const report = {
  input: earlyInput,
  standard: {
    outcome: standard.summary.outcome,
    time: standard.summary.duration,
    records: standard.summary.records,
    wear: standard.summary.wear,
    power: standard.summary.power,
    dataMB: standard.summary.dataMB,
  },
  repeatedRun: {
    match: comparison.match,
    taskMatch: comparison.taskMatch,
    resourceMatch: comparison.resourceMatch,
    finalMatch: comparison.finalMatch,
    taskDigest: comparison.taskDigest,
    resourceDigest: comparison.resourceDigest,
    finalDigest: comparison.finalDigest,
    runA: comparison.runA.summary,
    runB: comparison.runB.summary,
    traceSamples: comparison.runA.trace.length,
  },
  fault: {
    errorCode: comparison.runA.errorCode,
    abortedTask: comparison.runA.abortedTaskId,
    before: comparison.runA.fault.before,
    after: comparison.runA.fault.after,
    preservedRecords: comparison.runA.records,
  },
  recovery: {
    passed: recovery.passed,
    observedSeconds: recovery.observedSeconds,
    activeJobs: recovery.activeJobs,
    errorCode: recovery.errorCode,
    domeOpen: recovery.domeOpen,
    drift: recovery.drift,
    records: recovered.records,
  },
};

await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../artifacts/verification-report.json", import.meta.url),
  `${JSON.stringify(report, null, 2)}\n`,
);

console.log("PASS standard schedule:", standard.summary.outcome, `${standard.summary.duration}s`);
console.log(
  "PASS repeated failure:",
  comparison.taskDigest,
  comparison.resourceDigest,
  comparison.finalDigest,
);
console.log(
  "PASS preserved records:",
  `A=${comparison.runA.records.A.exposure}s`,
  `B=${comparison.runA.records.B.exposure}s`,
);
console.log(
  "PASS recovery:",
  recovery.observedSeconds,
  "observed seconds, drift",
  JSON.stringify(recovery.drift),
);
