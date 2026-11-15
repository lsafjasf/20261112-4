import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runVerification } from "../src/verification.js";

const root = resolve(import.meta.dirname, "..");
const verification = runVerification();

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function resourceSnapshot(summary) {
  return Object.fromEntries(
    Object.entries(summary.devices).map(([id, device]) => [
      id,
      {
        zone: device.zone,
        battery: device.battery,
        power: device.power,
        frequency: device.frequency,
        status: device.status,
      },
    ]),
  );
}

function sequenceSummary(proof) {
  return {
    ticks: proof.summary.ticks,
    outcome: proof.summary.outcome,
    eventDigest: hash(proof.digest),
    resources: resourceSnapshot(proof.summary),
  };
}

const runA = verification.runs.successA;
const runB = verification.runs.successB;
const failure = verification.runs.failure;

const report = {
  generatedAt: verification.generatedAt,
  allPassed: verification.allPassed,
  input: verification.input,
  checks: verification.checks,
  comparison: verification.match,
  deterministicRuns: {
    runA: sequenceSummary(runA),
    runB: sequenceSummary(runB),
    sameTaskSequence: verification.match.taskSequence,
    sameResourceChanges: verification.match.resources,
    sameFinalResult: verification.match.result,
    fullDigestEqual: verification.match.digest,
  },
  noiseRetake: {
    faultArmedAt: runA.fault.armedAt,
    faultTriggeredAt: runA.fault.triggeredAt,
    faultRecoveredAt: runA.fault.recoveredAt,
    windRejectedSamples: runA.noise.windRejectedCount,
    rerecordedClips: runA.noise.retakeEvents,
    checks: verification.checks.noiseRetake,
  },
  repeatableFailure: {
    outcome: failure.summary.outcome,
    ticks: failure.summary.ticks,
    faultTriggeredAt: failure.fault.triggeredAt,
    before: failure.fault.before,
    after: failure.fault.after,
    pendingRetakes: failure.summary.pendingRetakes,
    rejectionCount: failure.noise.rejectedCount,
    checks: verification.checks.repeatableFailure,
  },
  recoveryObservation: {
    startTick: runA.observation.startTick,
    required: runA.observation.required,
    completed: runA.observation.completed,
    passed: runA.observation.passed,
    failures: runA.observation.failures,
    residualErrorFlags: runA.observation.residualErrorFlags,
    records: runA.observation.records,
    checks: verification.checks.recoveryClean,
  },
};

const markdown = `# 潮汐守夜 · 自动化验收证据

生成时间：${report.generatedAt}

## 结果

| 检查项 | 结果 |
| --- | --- |
| 同输入双跑一致 | ${verification.checks.deterministic ? "PASS" : "FAIL"} |
| 噪声污染触发重采 | ${verification.checks.noiseRetake ? "PASS" : "FAIL"} |
| 可重复失败场景 | ${verification.checks.repeatableFailure ? "PASS" : "FAIL"} |
| 恢复后固定观察无残留 | ${verification.checks.recoveryClean ? "PASS" : "FAIL"} |
| 成功路径 | ${verification.checks.successPath ? "PASS" : "FAIL"} |

## 双跑一致性

- 输入：\`GUST-01\`，种子 \`${verification.input.seed}\`，同一份成功操作计划。
- 两次任务序列摘要：\`${hash(runA.digest)}\` / \`${hash(runB.digest)}\`。
- 任务序列一致：${verification.match.taskSequence}；资源变化一致：${verification.match.resources}；最终结果一致：${verification.match.result}。
- 最终结果：${runA.summary.outcome}，${runA.summary.ticks} 段，录音 ${runA.summary.recordings.oystercatcher.clear && runA.summary.recordings.tern.clear && runA.summary.recordings.sandpiper.clear ? "3/3" : "未完成"}，航迹 ${runA.summary.tracks.length}/2，惊扰 ${runA.summary.disturbanceCount}。

## 噪声与重采

- 风噪拒绝样本：${runA.noise.windRejectedCount}。
- 故障 T+${runA.fault.triggeredAt} 触发，T+${runA.fault.recoveredAt} 重采队列清空。
- 重采清晰录音：${runA.noise.retakeEvents.map((event) => `T+${event.tick} ${event.message}`).join("；")}。

## 可重复失败场景

- 无干预输入运行至第 ${failure.summary.ticks} 段，最终结果：**${failure.summary.outcome}**。
- 故障前快照：第 ${failure.fault.before.tick} 段，风级 ${failure.fault.before.wind}，电池 ${Object.values(failure.fault.before.devices).map((device) => device.battery.toFixed(1)).join(" / ")}。
- 故障后快照：第 ${failure.fault.after.tick} 段，风级 ${failure.fault.after.wind}，待重采 ${failure.fault.after.pendingRetakes}，电池 ${Object.values(failure.fault.after.devices).map((device) => device.battery.toFixed(1)).join(" / ")}。

## 恢复后固定观察

- 自 T+${runA.observation.startTick} 故障解除后连续观察 ${runA.observation.completed}/${runA.observation.required} 段。
- 每段 \`pendingRetakes=0\`、\`faultActive=false\`、\`errorEvents=0\`，耗电与当前设备配置的理论消耗一致。
- 残留错误标记：${runA.observation.residualErrorFlags.length}。

${runA.observation.records
  .map(
    (record) =>
      `  - T+${record.tick}: pending=${record.pendingRetakes}, fault=${record.faultActive}, errors=${record.errorEvents}, pass=${record.passed}`,
  )
  .join("\n")}
`;

await mkdir(resolve(root, "artifacts"), { recursive: true });
await writeFile(resolve(root, "artifacts/verification.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(resolve(root, "artifacts/verification.md"), markdown);

console.log(
  JSON.stringify(
    {
      allPassed: report.allPassed,
      checks: report.checks,
      runs: {
        first: report.deterministicRuns.runA.eventDigest,
        second: report.deterministicRuns.runB.eventDigest,
      },
      noiseRetake: report.noiseRetake,
      failure: {
        outcome: report.repeatableFailure.outcome,
        beforeTick: report.repeatableFailure.before.tick,
        afterTick: report.repeatableFailure.after.tick,
      },
      recoveryObservation: {
        completed: report.recoveryObservation.completed,
        required: report.recoveryObservation.required,
        residualErrorFlags: report.recoveryObservation.residualErrorFlags,
      },
      artifacts: ["artifacts/verification.json", "artifacts/verification.md"],
    },
    null,
    2,
  ),
);

if (!report.allPassed) process.exitCode = 1;
