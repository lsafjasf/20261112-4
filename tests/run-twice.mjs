import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import {
  DT,
  HEALTH_TARGET,
  OBSERVATION_HOURS,
  POLLUTION_LIMIT,
  replayPlan,
  runReport
} from "../src/simulation.js";
import { AUDIT_PLANS } from "../src/plans.js";

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const summary = (state) => ({
  digest: state.digest,
  success: state.final.success,
  clock: state.final.clock,
  taskEvents: state.taskSequence.length,
  inputs: state.inputs.length,
  resourceCheckpoints: state.resourceTrace.length,
  finalResources: state.final.resources,
  cages: state.final.cages.map((cage) => ({
    id: cage.id,
    health: cage.health,
    pollution: cage.pollution,
    netIntegrity: cage.netIntegrity
  }))
});

function assertCompleteRun(state, expectedClock) {
  assert.equal(state.final.finished, true, "模拟应完成 12 小时");
  assert.equal(state.final.clock, expectedClock, "应结束于 12 小时窗口末端");
  assert.equal(state.final.success, true, "完整调控应达标");
  state.final.cages.forEach((cage) => {
    assert.ok(cage.health >= HEALTH_TARGET, `${cage.id} 号箱健康度应达标`);
    assert.ok(cage.pollution <= POLLUTION_LIMIT, `${cage.id} 号箱污染应达标`);
  });
}

function assertDeterministic(first, second, label) {
  assert.equal(first.digest, second.digest, `${label}完整指纹应一致`);
  assert.ok(same(first.inputs, second.inputs), `${label}输入序列应一致`);
  assert.ok(same(first.taskSequence, second.taskSequence), `${label}任务序列应一致`);
  assert.ok(same(first.resourceTrace, second.resourceTrace), `${label}资源变化轨迹应一致`);
  assert.ok(same(first.final, second.final), `${label}最终结果应一致`);
}

console.log("== 潮汐守望 · 确定性双跑验证 ==");

const standardPlan = AUDIT_PLANS.standard;
const standardState = replayPlan("standard", standardPlan);
const standardFirst = runReport(standardState);
const standardSecond = runReport(replayPlan("standard", standardPlan));
assertCompleteRun(standardFirst, "18:00");
assertDeterministic(standardFirst, standardSecond, "常规场景");
assert.notDeepEqual(standardFirst.resourceTrace.at(0), standardFirst.resourceTrace.at(-1), "资源应实际发生变化");
console.log(`常规场景：达标；指纹 ${standardFirst.digest}；输入 ${standardFirst.inputs.length} 条；资源检查点 ${standardFirst.resourceTrace.length}`);

const noRepairPlan = AUDIT_PLANS.storm.filter((entry) => entry.type !== "repairNet");
const unrepaired = replayPlan("storm", noRepairPlan);
const unrepairedReport = runReport(unrepaired);
assert.equal(unrepaired.fault?.cageId, 3, "强流场景应触发三号箱破网");
assert.equal(unrepaired.fault.triggerTick, 32, "破网应在 03.2 小时固定触发");
assert.equal(unrepaired.fault.before.cages[2].tear, false, "触发前网衣应完整");
assert.equal(unrepaired.fault.after.cages[2].tear, true, "触发后网衣应破损");
assert.ok(unrepaired.fault.after.cages[2].netIntegrity < unrepaired.fault.before.cages[2].netIntegrity, "破损后网衣完整度应下降");
assert.equal(unrepairedReport.final.success, false, "未修补的故障场景必须失败");
assert.equal(unrepairedReport.final.activeErrorCount, 1, "未修补时应保留未解决告警状态");
assert.equal(unrepaired.observation, null, "未修补时不应开始恢复观察");
console.log(`失败分支：${unrepaired.fault.triggerClock} 三号箱破网，网衣 ${unrepaired.fault.before.cages[2].netIntegrity}% → ${unrepaired.fault.after.cages[2].netIntegrity}%，最终未达标`);

const stormState = replayPlan("storm", AUDIT_PLANS.storm);
const stormFirst = runReport(stormState);
const stormSecond = runReport(replayPlan("storm", AUDIT_PLANS.storm));
assertCompleteRun(stormFirst, "19:00");
assertDeterministic(stormFirst, stormSecond, "故障恢复场景");
assert.equal(stormFirst.fault.triggerTick, 32);
assert.ok(stormFirst.fault.recovery, "应记录修补动作");
assert.ok(stormFirst.fault.observation?.passed, "2 小时恢复观察应通过");
assert.equal(stormState.observation.endTick - stormState.observation.startTick, Math.round(OBSERVATION_HOURS / DT));
assert.equal(stormFirst.fault.observation.issues.length, 0);
assert.equal(stormState.cages[2].tear, false, "观察结束时不应残留破口");
assert.ok(stormState.cages[2].netIntegrity >= 70, "修补后网衣完整度应恢复");
assert.equal(stormState.pending.filter((job) => job.type === "repairNet").length, 0, "不应残留修补任务");
assert.equal(stormState.pending.length, 0, "观察结束时任务队列应清空");
assert.ok(Object.values(stormState.resources).every((value) => value >= 0), "观察后资源不得为负");
assert.equal(stormState.errors.length, stormState.observation.startErrorCount, "观察期不得新增错误");
assert.equal(stormState.errors.length, 1, "仅保留触发时的历史故障记录");
assert.equal(stormState.errors.filter((error) => !error.resolved).length, 0, "故障历史应标记为已解决");
assert.equal(stormFirst.fault.observation.activeErrorCount, 0, "观察结果应记录零未解决错误");
assert.equal(stormFirst.fault.observation.pendingCount, 0, "观察结果应记录零残留任务");
console.log(`故障恢复：修补 ${stormFirst.fault.recovery.clock}，观察 ${stormState.observation.start.clock} → ${stormState.observation.end.clock}，通过且无新增错误`);

const evidence = {
  generatedAt: new Date().toISOString(),
  assertions: {
    standardDoubleRunEqual: true,
    stormDoubleRunEqual: true,
    unrepairedFailureObserved: true,
    recoveryObservationFixed: `${OBSERVATION_HOURS} h`,
    recoveryObservationPassed: true,
    noResidualRepairJob: true,
    noResidualTasks: true,
    noActiveErrors: true,
    noNegativeResources: true,
    noObservationPeriodErrors: true
  },
  standard: {
    first: summary(standardFirst),
    second: summary(standardSecond)
  },
  unrepairedFailure: {
    trigger: {
      tick: unrepaired.fault.triggerTick,
      clock: unrepaired.fault.triggerClock,
      current: unrepaired.fault.current,
      escaped: unrepaired.fault.escaped
    },
    before: unrepaired.fault.before,
    after: unrepaired.fault.after,
    final: summary(unrepairedReport)
  },
  stormRecovery: {
    first: summary(stormFirst),
    second: summary(stormSecond),
    trigger: {
      tick: stormFirst.fault.triggerTick,
      clock: stormFirst.fault.triggerClock,
      before: stormFirst.fault.before.cages[2],
      after: stormFirst.fault.after.cages[2]
    },
    repair: stormFirst.fault.recovery.snapshot.clock,
    observation: {
      startTick: stormState.observation.startTick,
      endTick: stormState.observation.endTick,
      startClock: stormState.observation.start.clock,
      endClock: stormState.observation.end.clock,
      passed: stormState.observation.passed,
      issues: stormState.observation.issues,
      resourceDelta: stormState.observation.resourceDelta
    },
    finalErrors: stormState.errors
  }
};

await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/verification-report.json", `${JSON.stringify(evidence, null, 2)}\n`);
console.log("全部断言通过；证据已写入 artifacts/verification-report.json");
