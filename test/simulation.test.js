import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_INPUT,
  ObservatorySimulation,
  TARGETS,
  compareRuns,
  runSchedule,
} from "../simulation.js";

test("标准排程完成两组数据并保持设备健康", () => {
  const result = runSchedule(DEFAULT_INPUT);
  assert.equal(result.phase, "complete");
  assert.equal(result.summary.outcome, "SUCCESS");
  assert.equal(result.summary.success, true);
  assert.equal(result.records.A.exposure, 20);
  assert.equal(result.records.B.exposure, 20);
  assert.ok(result.records.A.meanClarity >= TARGETS.carina.minClarity);
  assert.ok(result.records.B.meanClarity >= TARGETS.trifid.minClarity);
  assert.ok(result.wear < 100);
  assert.equal(result.domeOpen, false);
  assert.equal(result.activeJobs, 0);
});

test("提前沙尘中止 B 组曝光并保留两份记录", () => {
  const earlyInput = { ...DEFAULT_INPUT, scenario: "early" };
  const result = runSchedule(earlyInput);
  assert.equal(result.phase, "aborted");
  assert.equal(result.errorCode, "E_DUST_INGRESS");
  assert.equal(result.abortedTaskId, "expose-B");
  assert.equal(result.domeOpen, false);
  assert.equal(result.activeJobs, 0);
  assert.equal(result.records.A.status, "已完成");
  assert.ok(result.records.A.exposure >= TARGETS.carina.minExposure);
  assert.match(result.records.B.status, /记录保留/);
  assert.ok(result.records.B.exposure > 0);
  assert.ok(result.records.B.exposure < TARGETS.trifid.minExposure);
  assert.ok(result.fault.after);
  assert.equal(result.fault.after.activeJobs, 0);
  assert.equal(result.fault.after.records.B.status, "已中止 · 记录保留");
});

test("故障前后快照包含关键状态", () => {
  const result = runSchedule({ ...DEFAULT_INPUT, scenario: "early" });
  const before = result.fault.before;
  const after = result.fault.after;
  assert.equal(before.task, "focus-B");
  assert.equal(before.records.A.status, "已完成");
  assert.equal(before.records.B, null);
  assert.equal(after.task, "expose-B");
  assert.equal(after.dome, "SAFE_CLOSED");
  assert.ok(after.dust > before.dust);
  assert.ok(after.wear > before.wear);
  assert.equal(after.activeJobs, 0);
  assert.ok(after.records.B.exposure > 0);
});

test("同一输入连续运行两次，任务、资源和结果完全一致", () => {
  const input = { ...DEFAULT_INPUT, scenario: "early" };
  const comparison = compareRuns(input);
  assert.equal(comparison.match, true);
  assert.equal(comparison.taskMatch, true);
  assert.equal(comparison.resourceMatch, true);
  assert.equal(comparison.finalMatch, true);
  assert.deepEqual(comparison.runA.trace, comparison.runB.trace);
  assert.deepEqual(comparison.runA.tasks, comparison.runB.tasks);
  assert.deepEqual(comparison.runA.summary, comparison.runB.summary);
  assert.equal(comparison.runA.summary.outcome, "ABORTED");
  assert.equal(comparison.runB.summary.outcome, "ABORTED");
});

test("恢复自检后的 12 秒观察窗无任务、错误或资源漂移", () => {
  const earlyInput = { ...DEFAULT_INPUT, scenario: "early" };
  const result = runSchedule(earlyInput, { recover: true });
  const report = result.recovery.report;
  assert.equal(result.phase, "recovered");
  assert.equal(report.observedSeconds, 12);
  assert.equal(report.passed, true);
  assert.equal(report.activeJobs, 0);
  assert.equal(report.errorCode, null);
  assert.equal(result.activeJobs, 0);
  assert.equal(result.errorCode, null);
  assert.equal(result.domeOpen, false);
  assert.deepEqual(report.drift, {
    wear: 0,
    power: 0,
    dataMB: 0,
    AExposure: 0,
    BExposure: 0,
  });
  assert.match(result.records.A.status, /已完成/);
  assert.match(result.records.B.status, /记录保留/);
});

test("暂停冻结时钟，单步只推进固定时间", () => {
  const simulation = new ObservatorySimulation(DEFAULT_INPUT);
  simulation.start();
  for (let index = 0; index < 100; index += 1) simulation.step(0.1);
  assert.equal(simulation.phase, "running");
  assert.equal(simulation.pause(), true);
  const frozenTime = simulation.time;
  simulation.step(1);
  assert.equal(simulation.time, frozenTime);
  assert.equal(simulation.stepOnce(0.5), true);
  assert.ok(Math.abs(simulation.time - frozenTime - 0.5) < 0.0001);
  assert.equal(simulation.phase, "paused");
});
