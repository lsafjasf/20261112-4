import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { digest, stableStringify, verificationPayload } from '../src/digest.js';
import { runSimulation } from '../src/engine.js';
import { buildAuditReport, stationsToCsv } from '../src/export.js';
import { getScenario } from '../src/scenarios.js';

const outputDir = resolve(import.meta.dirname, '..', 'artifacts');
await mkdir(outputDir, { recursive: true });

function summarizeRun(state) {
  const result = state.result;
  return {
    status: result.status,
    passed: result.passed,
    reason: result.reason,
    finishedAtSec: result.finishedAtSec,
    finishedClock: result.finishedClock,
    floodedFacilities: result.floodedFacilities,
    taskCount: result.taskSequence.length,
    appliedTasks: result.taskSequence.filter((task) => task.status === 'applied').length,
    totals: result.totals,
    stations: result.stationSummaries,
    reservoirs: result.reservoirSummaries,
    faults: result.faultRecords.map((fault) => ({
      id: fault.id,
      segment: fault.segment,
      detectedAt: fault.detectedAt,
      detectedClock: fault.detectedClock,
      isolatedAt: fault.resolution?.isolated?.atSec ?? null,
      repairedAt: fault.resolution?.repaired?.atSec ?? null,
    })),
    recoveryWatch: result.checks.recoveryWatch,
  };
}

function compareTwoRuns(scenarioId) {
  const scenarioA = getScenario(scenarioId);
  const scenarioB = getScenario(scenarioId);
  const first = runSimulation(scenarioA);
  const second = runSimulation(scenarioB);
  assert.ok(first.result && second.result);
  const payloadA = verificationPayload(first.result);
  const payloadB = verificationPayload(second.result);
  const taskA = digest(payloadA.taskSequence);
  const taskB = digest(payloadB.taskSequence);
  const resourcesA = digest(payloadA.resources);
  const resourcesB = digest(payloadB.resources);
  const finalA = digest(payloadA.final);
  const finalB = digest(payloadB.final);
  const identical = stableStringify(payloadA) === stableStringify(payloadB);
  assert.equal(identical, true);
  assert.equal(taskA, taskB);
  assert.equal(resourcesA, resourcesB);
  assert.equal(finalA, finalB);
  return {
    scenarioId,
    inputHash: digest(scenarioA),
    identical,
    taskSequenceDigest: { first: taskA, second: taskB },
    resourceDigest: { first: resourcesA, second: resourcesB },
    resultDigest: { first: finalA, second: finalB },
    first: summarizeRun(first),
    second: summarizeRun(second),
    state: first,
  };
}

const burst = compareTwoRuns('burst-replan');
const failure = compareTwoRuns('burst-failure');
assert.equal(burst.first.status, 'passed');
assert.equal(failure.first.status, 'failed');
assert.equal(burst.first.faults.length, 1);
assert.equal(burst.first.faults[0].segment, 'S2');
assert.ok(burst.first.recoveryWatch.completed);
assert.equal(burst.first.recoveryWatch.clean, true);
assert.equal(burst.first.recoveryWatch.samples, 60);
assert.equal(burst.state.pendingCommands.length, 0);

const verification = {
  generatedAt: new Date().toISOString(),
  contract: {
    fixedStepSec: 30,
    simulatedDurationSec: 21_600,
    recoveryObservationSec: 1_800,
    identicalRuns: true,
    failureScenarioRepeatable: true,
  },
  burstReplanning: {
    inputHash: burst.inputHash,
    identical: burst.identical,
    taskSequenceDigest: burst.taskSequenceDigest,
    resourceDigest: burst.resourceDigest,
    resultDigest: burst.resultDigest,
    first: burst.first,
    second: burst.second,
  },
  unrecoveredFailure: {
    inputHash: failure.inputHash,
    identical: failure.identical,
    taskSequenceDigest: failure.taskSequenceDigest,
    resourceDigest: failure.resourceDigest,
    resultDigest: failure.resultDigest,
    first: failure.first,
    second: failure.second,
  },
  recoveryAudit: {
    observationSeconds: 1_800,
    startedAt: burst.first.recoveryWatch.startedAt,
    endsAt: burst.first.recoveryWatch.endsAt,
    samples: burst.first.recoveryWatch.samples,
    clean: burst.first.recoveryWatch.clean,
    issues: burst.first.recoveryWatch.issues,
    pendingCommandsAtEnd: burst.state.pendingCommands.length,
    activeBurstAtEnd: burst.state.burst.status,
    facilitiesFloodedAtEnd: Object.values(burst.state.facilities)
      .filter((facility) => facility.flooded)
      .map((facility) => facility.id),
  },
};

const audit = buildAuditReport(burst.state, {
  inputHash: burst.inputHash,
  determinism: {
    identical: burst.identical,
    taskSequenceDigest: burst.taskSequenceDigest,
    resourceDigest: burst.resourceDigest,
    resultDigest: burst.resultDigest,
  },
});

await writeFile(resolve(outputDir, 'verification-report.json'), JSON.stringify(verification, null, 2));
await writeFile(resolve(outputDir, 'station-summary.csv'), stationsToCsv(burst.state));
await writeFile(resolve(outputDir, 'audit-burst-replan.json'), JSON.stringify(audit, null, 2));

console.log(`Burst re-planning: ${burst.first.status} at ${burst.first.finishedClock}`);
console.log(`Double run identical: ${burst.identical && failure.identical} (tasks/resources/result hashes match)`);
console.log(`Recovery watch: ${burst.first.recoveryWatch.samples}/60 samples, clean=${burst.first.recoveryWatch.clean}`);
console.log(`Failure scenario: ${failure.first.status} at ${failure.first.finishedClock} (${failure.first.reason})`);
console.log('Artifacts: verification-report.json, station-summary.csv, audit-burst-replan.json');
