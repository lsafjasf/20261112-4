import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { playScript } from "../src/player.js";
import {
  SUCCESS_SCRIPT,
  FAILURE_SCRIPT,
  FAILURE_SCENARIO,
} from "../src/scripts.js";

const here = dirname(fileURLToPath(import.meta.url));
const results = { seed: FAILURE_SCENARIO.seed, checks: [] };

function check(name, pass, detail = {}) {
  results.checks.push({ name, pass, detail });
  const tag = pass ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}`);
  return pass;
}

function digest(sim, log) {
  return {
    status: sim.s.status,
    tick: sim.s.tick,
    failure: sim.s.failure,
    actionLog: log,
    events: sim.s.events.map((e) => ({ ...e })),
    boxes: sim.s.boxes.map((b) => ({
      id: b.id,
      temp: b.temp,
      soc: b.soc,
      insulation: b.insulation,
      violations: b.violations,
      delivered: b.delivered,
    })),
    vehicle: { ...sim.s.vehicle, segment: sim.s.vehicle.segment },
    station: JSON.parse(JSON.stringify(sim.s.station)),
    routes: JSON.parse(JSON.stringify(sim.s.routes)),
    medicines: sim.s.medicines.map((m) => ({
      id: m.id,
      delivered: m.delivered,
    })),
    observe: JSON.parse(JSON.stringify(sim.s.observe)),
    faultSnapshots: JSON.parse(JSON.stringify(sim.s.faultSnapshots)),
  };
}

function runPair(script, scenario) {
  const a = playScript(script, scenario.seed, scenario);
  const b = playScript(script, scenario.seed, scenario);
  return {
    a: digest(a.sim, a.log),
    b: digest(b.sim, b.log),
    sim: a.sim,
    log: a.log,
  };
}

// ---- 失败场景：同输入两次 ----
const failPair = runPair(FAILURE_SCRIPT, FAILURE_SCENARIO);
check(
  "失败场景两次运行逐字段一致（任务序列/资源/结果）",
  JSON.stringify(failPair.a) === JSON.stringify(failPair.b),
  {
    runA_status: failPair.a.status,
    runB_status: failPair.b.status,
    actionCount: failPair.a.actionLog.length,
  },
);
check("失败场景确为温控超限失败", failPair.a.status === "failed" &&
  failPair.a.failure?.reason === "temp", failPair.a.failure);
check("失败场景存在超限前后关键状态快照",
  failPair.a.faultSnapshots.overTemp.before !== null &&
  failPair.a.faultSnapshots.overTemp.after !== null,
  {
    beforeTick: failPair.a.faultSnapshots.overTemp.before?.tick,
    afterTick: failPair.a.faultSnapshots.overTemp.after?.tick,
    box2_before: failPair.a.faultSnapshots.overTemp.before?.boxes?.find(
      (b) => b.id === "box2",
    ),
    box2_after: failPair.a.faultSnapshots.overTemp.after?.boxes?.find(
      (b) => b.id === "box2",
    ),
  },
);
check("失败场景可复现：失败 tick 与超限次数一致",
  failPair.a.tick === failPair.b.tick &&
  failPair.a.boxes.every((bx, i) =>
    bx.violations === failPair.b.boxes[i].violations),
  { tick: failPair.a.tick });

// ---- 成功场景：同输入两次 ----
const okScenario = { seed: FAILURE_SCENARIO.seed, outage: { start: 22, end: 30 } };
const okPair = runPair(SUCCESS_SCRIPT, okScenario);
check(
  "成功场景两次运行逐字段一致",
  JSON.stringify(okPair.a) === JSON.stringify(okPair.b),
  { status: okPair.a.status, tick: okPair.a.tick },
);
check("成功场景满足通关三条件（全部在温交付 + 完整备用路线记录）",
  okPair.a.status === "success" &&
  okPair.a.routes.records.some((r) => r.complete) &&
  okPair.a.medicines.every((m) => m.delivered),
  {
    backupRecord: okPair.a.routes.records,
    delivered: okPair.a.medicines,
    boxes: okPair.a.boxes,
  },
);

// ---- 暂停 / 单步 / 重置 ----
const { DeliverySim } = await import("../src/engine.js");
const sim = new DeliverySim(okScenario.seed, okScenario);
sim.drive("main");
sim.run(3);
const beforePause = sim.snapshot();
sim.pause();
const pausedTick = sim.s.tick;
sim.run(5); // 暂停态不应推进
check("暂停后仿真冻结", sim.s.tick === pausedTick, {
  pausedTick,
  afterAttempt: sim.s.tick,
});
sim.step(); // 单步恰好推进一个 tick 并回到暂停态
check("单步恰好推进一个 tick 并保持暂停",
  sim.s.tick === pausedTick + 1 && sim.s.status === "paused",
  { tick: sim.s.tick, status: sim.s.status },
);
sim.resume();
check("恢复后回到运行态", sim.s.status === "running", {
  status: sim.s.status,
});
sim.reset();
check("重置回到初始状态（tick=0、队列与电量复原、无故障）",
  sim.s.tick === 0 &&
  sim.s.queue.join(",") === "H1,H2,S1" &&
  sim.s.boxes.every((b) => b.soc === 100 && b.violations === 0) &&
  sim.s.failure === null &&
  sim.s.status === "running",
  { tick: sim.s.tick, queue: sim.s.queue, soc: sim.s.boxes.map((b) => b.soc) },
);

// ---- 恢复后固定观察：无残留资源/错误状态 ----
const obs = okPair.a.observe;
const expectObserve = okScenario.observeTicks ?? 20;
check("停电被经历且在恢复后完成固定观察期",
  okPair.a.station.outageExperienced &&
  obs.ticks >= expectObserve &&
  obs.clean === true,
  {
    outageRange: okPair.a.station.outage,
    recoveredTick: okPair.a.station.recoveredTick,
    observeTicks: obs.ticks,
    expectedObserve: expectObserve,
    clean: obs.clean,
    openBoxesLeft: okPair.a.boxes.some((b) => b.openTicksLeft > 0),
  },
);

const allPass = results.checks.every((c) => c.pass);
results.summary = {
  total: results.checks.length,
  passed: results.checks.filter((c) => c.pass).length,
  allPass,
  failureScenario: {
    status: failPair.a.status,
    failTick: failPair.a.tick,
    faultBeforeTick: failPair.a.faultSnapshots.overTemp.before?.tick ?? null,
    faultAfterTick: failPair.a.faultSnapshots.overTemp.after?.tick ?? null,
  },
  successScenario: {
    status: okPair.a.status,
    successTick: okPair.a.tick,
  },
};
mkdirSync(resolve(here, "../artifacts"), { recursive: true });
const outPath = resolve(here, "../artifacts/verification-report.json");
writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`\n${results.summary.passed}/${results.summary.total} checks passed`);
console.log(`report -> ${outPath}`);
process.exit(allPass ? 0 : 1);
