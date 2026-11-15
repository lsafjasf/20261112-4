export const HOURS = 12;
export const DT = 0.1;
export const TOTAL_TICKS = Math.round(HOURS / DT);
export const HEALTH_TARGET = 72;
export const POLLUTION_LIMIT = 42;
export const OBSERVATION_HOURS = 2;

export const ACTION_META = {
  toggleAerator: { label: "增氧机启停", delay: 0.4 },
  cleanNet: { label: "网具清洗", delay: 0.9 },
  feed: { label: "投喂船出航", delay: 0.6 },
  repairNet: { label: "网具应急修补", delay: 0.5 }
};

export const SCENARIOS = {
  standard: {
    id: "standard",
    code: "S-01",
    name: "常规午前调控",
    subtitle: "缓流 · 三箱协同",
    description: "从 06:00 开始，在 12 小时内完成增氧、洗网与定量投喂。",
    seed: 2601112,
    startClock: 6,
    currentBase: 0.72,
    currentBoost: 1,
    tidePhase: 1.8,
    faultAt: null,
    cages: [
      { health: 64, oxygen: 4.25, pollution: 43.5, fouling: 59, feedReserve: 2.2, netIntegrity: 84 },
      { health: 61, oxygen: 4.05, pollution: 46.8, fouling: 48, feedReserve: 1.3, netIntegrity: 79 },
      { health: 67, oxygen: 4.55, pollution: 41.2, fouling: 65, feedReserve: 2.6, netIntegrity: 68 }
    ]
  },
  storm: {
    id: "storm",
    code: "F-07",
    name: "强流破网演练",
    subtitle: "大潮 · 老旧三号箱",
    description: "03.2 小时必定发生三号箱破网。发现告警后修补，并完成 2 小时恢复观察。",
    seed: 2601112,
    startClock: 7,
    currentBase: 0.76,
    currentBoost: 1.78,
    tidePhase: 1.15,
    faultAt: 3.2,
    cages: [
      { health: 66, oxygen: 4.35, pollution: 43.5, fouling: 56, feedReserve: 2.5, netIntegrity: 83 },
      { health: 63, oxygen: 4.15, pollution: 46.3, fouling: 51, feedReserve: 1.8, netIntegrity: 76 },
      { health: 64, oxygen: 4.3, pollution: 44.8, fouling: 73, feedReserve: 2.1, netIntegrity: 37 }
    ]
  }
};

const CAGE_NAMES = ["一号箱", "二号箱", "三号箱"];
const CAGE_AGES = [3, 5, 9];
const round = (value, digits = 3) => Number(value.toFixed(digits));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clockLabel(hour) {
  const totalMinutes = Math.round((hour % 24) * 60);
  const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0");
  const mm = String(totalMinutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function fnv1a(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function makeCage(source, index) {
  return {
    id: index + 1,
    name: CAGE_NAMES[index],
    age: CAGE_AGES[index],
    health: source.health,
    oxygen: source.oxygen,
    pollution: source.pollution,
    fouling: source.fouling,
    feedReserve: source.feedReserve,
    feedConsumed: 0,
    feedWaste: 0,
    netIntegrity: source.netIntegrity,
    aerator: false,
    tear: false,
    patched: false,
    escapedFish: 0,
    fishCount: [520, 480, 445][index]
  };
}

export function createSimulation(scenarioId = "standard") {
  const scenario = SCENARIOS[scenarioId] || SCENARIOS.standard;
  const state = {
    scenarioId: scenario.id,
    scenario,
    seed: scenario.seed,
    tick: 0,
    hour: 0,
    clock: clockLabel(scenario.startClock),
    finished: false,
    success: false,
    cages: scenario.cages.map(makeCage),
    resources: { power: 86, fuel: 48, feed: 34, repairKits: 2 },
    tide: { current: 0, exchange: 0, level: 0, label: "平潮" },
    pending: [],
    inputs: [],
    log: [],
    errors: [],
    fault: null,
    observation: null,
    nextActionId: 1,
    faultPauseRequested: false,
    resourceTrace: []
  };
  updateTide(state);
  state.resourceTrace.push({ tick: 0, ...state.resources });
  addLog(state, "info", "任务开始", `${scenario.name}，当前 ${state.clock}。目标：三箱健康度 ≥ ${HEALTH_TARGET}，污染 ≤ ${POLLUTION_LIMIT}。`);
  return state;
}

function updateTide(state) {
  const scenario = state.scenario;
  const cycle = Math.sin((Math.PI * 2 * (state.hour + scenario.tidePhase)) / 12);
  const raw = Math.max(0, (scenario.currentBase * (0.72 + 0.28 * cycle)) * scenario.currentBoost);
  const foulingDrag = state.cages.reduce((sum, cage) => sum + Math.max(0, cage.fouling - 45) * 0.0012, 0);
  state.tide.current = round(raw);
  state.tide.level = round(0.5 + 0.5 * Math.sin((Math.PI * 2 * (state.hour + scenario.tidePhase - 2)) / 12));
  state.tide.exchange = round(clamp(0.13 + raw * 0.56 - foulingDrag, 0.08, 1.28));
  state.tide.label = state.tide.level > 0.68 ? "涨潮" : state.tide.level < 0.32 ? "落潮" : "平潮";
}

function addLog(state, type, title, message) {
  state.log.push({
    id: state.log.length + 1,
    tick: state.tick,
    clock: state.clock,
    type,
    title,
    message
  });
}

export function actionDelayTicks(type) {
  return Math.max(1, Math.round((ACTION_META[type]?.delay || 0.5) / DT));
}

export function cageFeedAdvice(cage) {
  const need = Math.max(0, 5.4 - cage.feedReserve);
  return clamp(Math.ceil(need / 2) * 2, 2, 6);
}

export function dispatch(state, type, payload = {}) {
  if (state.finished) return { ok: false, message: "本轮模拟已结束" };
  const cageId = Number(payload.cageId);
  const cage = state.cages.find((item) => item.id === cageId);
  if (!cage && type !== "feed") return { ok: false, message: "未找到目标网箱" };

  const meta = ACTION_META[type];
  if (!meta) return { ok: false, message: "未知操作" };
  const duplicate = state.pending.some((job) => job.type === type && job.cageId === cageId);
  if (duplicate) return { ok: false, message: `${cage?.name || "投喂船"}已有同类任务在途` };

  let amount = 0;
  if (type === "toggleAerator") {
    if (cage.tear) return { ok: false, message: "破网箱体隔离中，暂不能切换增氧机" };
  }
  if (type === "cleanNet") {
    if (state.resources.power < 3 || state.resources.fuel < 3.5) {
      return { ok: false, message: "电量或船用燃油不足，无法派出清洗作业" };
    }
    state.resources.power = round(state.resources.power - 3);
    state.resources.fuel = round(state.resources.fuel - 3.5);
  }
  if (type === "feed") {
    amount = [4, 8, 12].includes(Number(payload.amount)) ? Number(payload.amount) : 4;
    if (state.resources.feed < amount) return { ok: false, message: "饲料仓库存不足" };
    if (state.resources.fuel < 1) return { ok: false, message: "投喂船燃油不足" };
    state.resources.feed = round(state.resources.feed - amount);
    state.resources.fuel = round(state.resources.fuel - 1);
  }
  if (type === "repairNet") {
    if (!cage.tear) return { ok: false, message: "该网箱没有破损" };
    if (state.resources.repairKits < 1) return { ok: false, message: "应急修补包已用尽" };
    state.resources.repairKits -= 1;
    state.resources.power = round(state.resources.power - 2);
  }

  const delay = actionDelayTicks(type);
  const job = {
    id: state.nextActionId,
    type,
    cageId,
    amount,
    label: `${meta.label} · ${type === "feed" ? "投喂船" : cage.name}`,
    issuedAt: state.tick,
    dueAt: state.tick + delay,
    delay
  };
  state.nextActionId += 1;
  state.pending.push(job);
  state.inputs.push({ tick: state.tick, type, cageId, amount });
  addLog(state, "command", "指令已下达", `${job.label}，预计 ${meta.delay.toFixed(1)} 小时后生效。`);
  return { ok: true, message: `${job.label}已排队，等待现场反馈`, job };
}

function applyCompletion(state, job) {
  const cage = state.cages.find((item) => item.id === job.cageId);
  if (job.type === "toggleAerator") {
    cage.aerator = !cage.aerator;
    addLog(
      state,
      cage.aerator ? "success" : "info",
      cage.aerator ? "增氧机反馈" : "增氧机停机",
      `${cage.name}增氧机${cage.aerator ? "已启动，气泡开始上升" : "已停机，能耗回落"}。`
    );
  }
  if (job.type === "cleanNet") {
    cage.fouling = round(clamp(cage.fouling - 44, 0, 100));
    cage.pollution = round(clamp(cage.pollution - 6.4, 0, 100));
    cage.netIntegrity = round(clamp(cage.netIntegrity + 1, 0, 100));
    addLog(
      state,
      "success",
      "清洗完成",
      `${cage.name}附着物显著下降，水交换恢复；网箱有机负荷同步降低。`
    );
  }
  if (job.type === "feed") {
    const before = cage.feedReserve;
    cage.feedReserve = round(cage.feedReserve + job.amount);
    const overflow = Math.max(0, cage.feedReserve - 6.5);
    cage.feedReserve = round(cage.feedReserve - overflow);
    cage.feedWaste = round(cage.feedWaste + overflow);
    cage.pollution = round(clamp(cage.pollution + overflow * 1.15, 0, 100));
    addLog(
      state,
      overflow > 0 ? "warning" : "success",
      overflow > 0 ? "投喂过量反馈" : "投喂完成",
      overflow > 0
        ? `${cage.name}剩余饲料未吃完，${overflow.toFixed(1)} kg 沉入水体，有机污染上升。`
        : `${cage.name}收到 ${job.amount} kg 饲料，当前存量 ${before.toFixed(1)} → ${cage.feedReserve.toFixed(1)} kg。`
    );
  }
  if (job.type === "repairNet") {
    cage.tear = false;
    cage.patched = true;
    cage.netIntegrity = 74;
    const faultError = state.errors.find((error) => error.code === "NET-03-TEAR" && !error.resolved);
    if (faultError) {
      faultError.resolved = true;
      faultError.resolvedAt = state.tick;
      faultError.resolvedClock = state.clock;
    }
    addLog(state, "success", "网具修补完成", `${cage.name}破口已封闭并加装补片，开始 2 小时恢复观察。`);
    startObservation(state);
  }
}

function triggerFault(state) {
  if (state.scenario.faultAt === null || state.fault || state.hour < state.scenario.faultAt) return;
  const cage = state.cages[2];
  const before = snapshot(state);
  cage.netIntegrity = Math.max(12, cage.netIntegrity - 28);
  cage.tear = true;
  cage.health = round(clamp(cage.health - 2.1, 0, 100));
  cage.pollution = round(clamp(cage.pollution + 0.9, 0, 100));
  const escaped = Math.max(4, Math.round(cage.fishCount * 0.018));
  cage.fishCount -= escaped;
  cage.escapedFish += escaped;
  state.fault = {
    id: "NET-03-TEAR",
    cageId: cage.id,
    triggerTick: state.tick,
    triggerClock: state.clock,
    current: state.tide.current,
    escaped,
    before,
    after: snapshot(state),
    recovery: null,
    observation: null
  };
  state.faultPauseRequested = true;
  state.errors.push({
    tick: state.tick,
    clock: state.clock,
    code: "NET-03-TEAR",
    message: "三号箱老旧网衣在强流中撕裂，鱼群逃逸风险",
    resolved: false
  });
  addLog(
    state,
    "danger",
    "红色告警 · 网具破损",
    `${cage.name}在 ${state.tide.current.toFixed(2)} m/s 强流中撕裂，约 ${escaped} 尾鱼逃逸。立即使用应急修补包。`
  );
}

function startObservation(state) {
  if (!state.fault) return;
  const ticks = Math.round(OBSERVATION_HOURS / DT);
  const start = snapshot(state);
  state.observation = {
    active: true,
    startTick: state.tick,
    endTick: state.tick + ticks,
    ticksRemaining: ticks,
    startErrorCount: state.errors.length,
    start
  };
  state.fault.recovery = {
    tick: state.tick,
    clock: state.clock,
    action: "repairNet",
    snapshot: start
  };
  state.fault.observation = state.observation;
  addLog(state, "info", "恢复观察开始", `保持固定 2 小时观察窗，检查破损、告警与资源状态是否残留。`);
}

function finishObservation(state) {
  const observation = state.observation;
  if (!observation?.active || state.tick < observation.endTick) return;
  const cage = state.cages[2];
  const newErrors = state.errors.slice(observation.startErrorCount);
  const activeErrors = state.errors.filter((error) => !error.resolved);
  const resourcesOk = Object.values(state.resources).every((value) => Number.isFinite(value) && value >= 0);
  const pendingRepairs = state.pending.filter((job) => job.type === "repairNet");
  const issues = [];
  if (cage.tear) issues.push("网衣仍有破口");
  if (cage.netIntegrity < 70) issues.push("网衣完整度低于 70");
  if (newErrors.length) issues.push(`观察期新增 ${newErrors.length} 条错误`);
  if (activeErrors.length) issues.push(`仍有 ${activeErrors.length} 条未解决错误`);
  if (!resourcesOk) issues.push("存在负资源");
  if (pendingRepairs.length) issues.push("仍有未完成修补任务");
  if (state.pending.length) issues.push(`仍有 ${state.pending.length} 个未完成任务`);
  observation.active = false;
  observation.passed = issues.length === 0;
  observation.issues = issues;
  observation.activeErrorCount = activeErrors.length;
  observation.pendingCount = state.pending.length;
  observation.end = snapshot(state);
  observation.resourceDelta = Object.fromEntries(
    Object.keys(state.resources).map((key) => [key, round(state.resources[key] - observation.start.resources[key], 2)])
  );
  state.fault.observation = observation;
  addLog(
    state,
    observation.passed ? "success" : "danger",
    observation.passed ? "恢复观察通过" : "恢复观察未通过",
    observation.passed
      ? "2 小时内无新增破损或告警，资源无负值，任务队列与未解决错误均为零。"
      : `仍存在问题：${issues.join("；")}。`
  );
}

function updateCage(state, cage) {
  const dt = DT;
  const exchange = state.tide.exchange;
  let pumpUsed = 0;

  if (cage.aerator) {
    const draw = 1.35 * dt;
    if (state.resources.power > draw) {
      state.resources.power = round(state.resources.power - draw);
      pumpUsed = 1;
    } else {
      cage.aerator = false;
      state.resources.power = 0;
      state.errors.push({ tick: state.tick, clock: state.clock, code: "POWER-LOW", message: `${cage.name}增氧机因电量耗尽停机` });
      addLog(state, "danger", "电力耗尽", `${cage.name}增氧机自动停机，请调度移动电源。`);
    }
  }

  const reaeration = exchange * 0.42 * (7.1 - cage.oxygen);
  const oxygenDelta =
    0.15 +
    reaeration +
    pumpUsed * 0.62 -
    0.08 -
    cage.pollution * 0.0018 -
    cage.fouling * 0.0014 -
    (cage.tear ? 0.04 : 0);
  cage.oxygen = round(clamp(cage.oxygen + oxygenDelta * dt, 2.7, 7.4));

  const appetite = 0.32 * (cage.oxygen < 4 ? 0.55 : 1);
  const eaten = Math.min(cage.feedReserve, appetite * dt);
  cage.feedReserve = round(Math.max(0, cage.feedReserve - eaten));
  cage.feedConsumed = round(cage.feedConsumed + eaten);

  const pollutionDelta =
    0.36 -
    exchange * 0.3 +
    Math.max(0, cage.fouling - 55) * 0.0035 +
    (cage.tear ? 0.1 : 0);
  cage.pollution = round(clamp(cage.pollution + pollutionDelta * dt, 0, 100));
  cage.fouling = round(clamp(cage.fouling + (cage.fouling < 88 ? 0.5 * dt : 0), 0, 100));

  let healthDelta = 0.02;
  healthDelta += cage.oxygen >= 5 ? 0.35 : cage.oxygen < 4.2 ? -0.56 : -0.08;
  healthDelta += cage.pollution <= POLLUTION_LIMIT ? 0.35 : -0.54;
  healthDelta += cage.feedReserve > 0.03 ? 0.18 : -0.44;
  healthDelta += cage.fouling < 52 ? 0.22 : cage.fouling > 74 ? -0.24 : 0;
  healthDelta += cage.tear ? -1.6 : 0;
  cage.health = round(clamp(cage.health + healthDelta * dt, 0, 100));
}

function evaluateFinal(state) {
  if (state.tick < TOTAL_TICKS || state.finished) return;
  state.finished = true;
  const unhealthy = state.cages.filter((cage) => cage.health < HEALTH_TARGET);
  const polluted = state.cages.filter((cage) => cage.pollution > POLLUTION_LIMIT);
  const torn = state.cages.filter((cage) => cage.tear);
  state.success = unhealthy.length === 0 && polluted.length === 0 && torn.length === 0;
  const failures = [];
  if (unhealthy.length) failures.push(`${unhealthy.map((cage) => cage.name).join("、")}健康度未达标`);
  if (polluted.length) failures.push(`${polluted.map((cage) => cage.name).join("、")}污染超限`);
  if (torn.length) failures.push("仍有网箱破损");
  state.finalFailures = failures;
  addLog(
    state,
    state.success ? "success" : "danger",
    state.success ? "12 小时任务达标" : "12 小时任务未达标",
    state.success ? "三箱健康度与污染指标均在验收线内，任务完成。" : `${failures.join("；")}。`
  );
}

export function step(state) {
  if (state.finished) return state;
  state.tick += 1;
  state.hour = round(state.tick * DT, 2);
  state.clock = clockLabel(state.scenario.startClock + state.hour);
  updateTide(state);
  triggerFault(state);

  const completed = state.pending.filter((job) => job.dueAt <= state.tick);
  state.pending = state.pending.filter((job) => job.dueAt > state.tick);
  completed.forEach((job) => applyCompletion(state, job));
  state.cages.forEach((cage) => updateCage(state, cage));
  finishObservation(state);
  evaluateFinal(state);
  state.resourceTrace.push({ tick: state.tick, ...state.resources });
  return state;
}

export function snapshot(state) {
  return {
    tick: state.tick,
    clock: state.clock,
    finished: state.finished,
    success: state.success,
    resources: clone(state.resources),
    tide: clone(state.tide),
    cages: state.cages.map((cage) => ({
      id: cage.id,
      name: cage.name,
      health: cage.health,
      oxygen: cage.oxygen,
      pollution: cage.pollution,
      fouling: cage.fouling,
      feedReserve: cage.feedReserve,
      netIntegrity: cage.netIntegrity,
      aerator: cage.aerator,
      tear: cage.tear
    })),
    pending: state.pending.map((job) => ({
      id: job.id,
      type: job.type,
      cageId: job.cageId,
      dueAt: job.dueAt
    })),
    errorCount: state.errors.length,
    activeErrorCount: state.errors.filter((error) => !error.resolved).length,
    observation: state.observation
      ? {
          active: state.observation.active,
          startTick: state.observation.startTick,
          endTick: state.observation.endTick,
          passed: state.observation.passed ?? null
        }
      : null
  };
}

export function runReport(state) {
  const report = {
    scenarioId: state.scenarioId,
    inputs: clone(state.inputs),
    taskSequence: state.log.map((entry) => ({
      tick: entry.tick,
      clock: entry.clock,
      type: entry.type,
      title: entry.title,
      message: entry.message
    })),
    final: {
      tick: state.tick,
      clock: state.clock,
      finished: state.finished,
      success: state.success,
      failures: state.finalFailures || [],
      cages: state.cages.map((cage) => ({
        id: cage.id,
        health: cage.health,
        pollution: cage.pollution,
        oxygen: cage.oxygen,
        fouling: cage.fouling,
        netIntegrity: cage.netIntegrity,
        tear: cage.tear,
        feedWaste: cage.feedWaste,
        escapedFish: cage.escapedFish
      })),
      resources: clone(state.resources),
      activeErrorCount: state.errors.filter((error) => !error.resolved).length,
      pendingCount: state.pending.length
    },
    resourceTrace: clone(state.resourceTrace),
    errors: clone(state.errors),
    fault: state.fault
      ? {
          triggerTick: state.fault.triggerTick,
          triggerClock: state.fault.triggerClock,
          current: state.fault.current,
          escaped: state.fault.escaped,
          before: state.fault.before,
          after: state.fault.after,
          recovery: state.fault.recovery,
          observation: state.fault.observation
            ? {
                active: state.observation.active,
                startTick: state.observation.startTick,
                endTick: state.observation.endTick,
                passed: state.observation.passed ?? null,
                issues: state.observation.issues || [],
                resourceDelta: state.observation.resourceDelta || null,
                activeErrorCount: state.observation.activeErrorCount ?? null,
                pendingCount: state.observation.pendingCount ?? null
              }
            : null
        }
      : null
  };
  report.digest = fnv1a(JSON.stringify(report));
  return report;
}

export function replayPlan(scenarioId, plan) {
  const state = createSimulation(scenarioId);
  const ordered = [...plan].sort((a, b) => a.tick - b.tick);
  const immediate = ordered.filter((entry) => entry.tick === 0);
  immediate.forEach((entry) => dispatch(state, entry.type, entry));
  while (!state.finished) {
    step(state);
    ordered
      .filter((entry) => entry.tick === state.tick)
      .forEach((entry) => dispatch(state, entry.type, entry));
  }
  return state;
}
