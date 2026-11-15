import {
  ACTION_META,
  DT,
  HEALTH_TARGET,
  POLLUTION_LIMIT,
  SCENARIOS,
  TOTAL_TICKS,
  cageFeedAdvice,
  createSimulation,
  dispatch,
  replayPlan,
  runReport,
  snapshot,
  step
} from "./simulation.js";
import { SceneRenderer } from "./renderer.js";
import { HarborAudio } from "./audio.js";
import { AUDIT_PLANS } from "./plans.js";

const TICK_MS = 310;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

let scenarioId = "standard";
let state = createSimulation(scenarioId);
let running = false;
let speed = 1;
let accumulator = 0;
let lastFrame = performance.now();
let lastRenderUpdate = 0;
let lastLogCount = -1;
let lastQueueSignature = "";
let resultShown = false;
let seenFault = null;
let seenObservationEnd = null;
let selectedFeedAmount = 4;
let auditEvidence = null;

const renderer = new SceneRenderer($("#sceneCanvas"));
const audio = new HarborAudio($("#audioButton"));
const DIALOG_IDS = ["faultDialog", "auditDialog", "resultDialog", "faultRecordDialog"];

function getCage(cageId) {
  return state.cages.find((cage) => cage.id === Number(cageId));
}

function pendingFor(type, cageId) {
  return state.pending.find((job) => job.type === type && job.cageId === cageId);
}

function openDialog(id) {
  const dialog = document.getElementById(id);
  if (!dialog.open) dialog.showModal();
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog.open) dialog.close();
}

function closeAllDialogs() {
  DIALOG_IDS.forEach(closeDialog);
}

function showToast(message, type = "success", duration = 2800) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  $("#toastStack").append(toast);
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 220);
  }, duration);
}

function buildActionControls() {
  $("#aeratorActions").innerHTML = state.cages
    .map(
      (cage) => `
        <button class="cage-action" data-action="toggleAerator" data-cage="${cage.id}">
          <span>${cage.name}</span><strong>启动</strong>
        </button>`
    )
    .join("");
  $("#cleanActions").innerHTML = state.cages
    .map(
      (cage) => `
        <button class="cage-action" data-action="cleanNet" data-cage="${cage.id}">
          <span>${cage.name}</span><strong>清洗</strong>
        </button>`
    )
    .join("");
}

function updateActionControls() {
  $$('#aeratorActions [data-action="toggleAerator"]').forEach((button) => {
    const cage = getCage(button.dataset.cage);
    const pending = pendingFor("toggleAerator", cage.id);
    const strong = $("strong", button);
    button.classList.toggle("is-on", cage.aerator);
    button.classList.toggle("is-pending", Boolean(pending));
    button.disabled = state.finished || Boolean(pending) || cage.tear;
    strong.textContent = pending ? "启动中" : cage.tear ? "隔离" : cage.aerator ? "运行中" : "启动";
  });

  $$('#cleanActions [data-action="cleanNet"]').forEach((button) => {
    const cage = getCage(button.dataset.cage);
    const pending = pendingFor("cleanNet", cage.id);
    const strong = $("strong", button);
    button.classList.toggle("is-pending", Boolean(pending));
    button.disabled = state.finished || Boolean(pending);
    strong.textContent = pending ? "作业中" : "清洗";
  });

  const tearCage = state.cages.find((cage) => cage.tear);
  const repairJob = state.pending.find((job) => job.type === "repairNet");
  const repairButton = $("#repairButton");
  repairButton.disabled = state.finished || !tearCage || Boolean(repairJob);
  repairButton.classList.toggle("is-pending", Boolean(repairJob));
  $("#repairButtonText").textContent = repairJob
    ? "应急队抵达中"
    : tearCage
      ? `修补 ${tearCage.name} · 剩余 ${state.resources.repairKits} 套`
      : "等待破损告警";

  const cage = getCage($("#feedCage").value);
  const advice = cageFeedAdvice(cage);
  const pending = pendingFor("feed", cage.id);
  $("#feedButton").disabled = state.finished || Boolean(pending);
  $("#feedButton").textContent = pending ? "航行中" : "派出投喂船";
  $("#feedAdvice").textContent =
    selectedFeedAmount > advice
      ? `建议 ${advice} kg · 当前余料 ${cage.feedReserve.toFixed(1)} kg · ${selectedFeedAmount} kg 可能过量`
      : `建议 ${advice} kg · 当前箱内余料 ${cage.feedReserve.toFixed(1)} kg`;
  $("#feedAdvice").style.color =
    selectedFeedAmount > advice ? "rgba(255, 183, 101, 0.75)" : "var(--dim)";
}

function healthDialMarkup(cage) {
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - cage.health / 100);
  const healthClass = cage.health < HEALTH_TARGET ? cage.health < 62 ? "critical" : "low" : "";
  return `
    <div class="health-dial">
      <svg viewBox="0 0 62 62" aria-hidden="true">
        <circle class="track" cx="31" cy="31" r="${radius}"></circle>
        <circle class="value ${healthClass}" cx="31" cy="31" r="${radius}"
          stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"></circle>
      </svg>
      <strong>${cage.health.toFixed(1)}</strong>
      <span>健康度</span>
    </div>`;
}

function cageCardMarkup(cage) {
  const pendingPump = pendingFor("toggleAerator", cage.id);
  const pendingClean = pendingFor("cleanNet", cage.id);
  const stateLabel = cage.tear
    ? "网具破损"
    : pendingPump
      ? "启动中"
      : pendingClean
        ? "清洗中"
        : cage.aerator
          ? "增氧中"
          : "待机";
  return `
    <article class="cage-card ${cage.tear ? "is-alarm" : ""}" data-cage-card="${cage.id}">
      <div class="cage-card-head">
        <div class="cage-title"><strong>${cage.name}</strong><span>${cage.age} 年网龄</span></div>
        <span class="cage-state ${cage.tear ? "alarm" : ""}">${stateLabel}</span>
      </div>
      <div class="cage-metrics">
        ${healthDialMarkup(cage)}
        <div class="cage-bars">
          <div class="mini-bar-row">
            <span>溶氧</span>
            <div class="mini-bar"><i class="${cage.oxygen < 4.2 ? "over" : ""}" style="width:${clamp((cage.oxygen / 7.4) * 100, 0, 100)}%"></i></div>
            <strong>${cage.oxygen.toFixed(2)}</strong>
          </div>
          <div class="mini-bar-row">
            <span>污染</span>
            <div class="mini-bar pollution"><i class="${cage.pollution > POLLUTION_LIMIT ? "over" : ""}" style="width:${clamp((cage.pollution / 60) * 100, 0, 100)}%"></i></div>
            <strong>${cage.pollution.toFixed(1)}</strong>
          </div>
          <div class="mini-bar-row">
            <span>附着</span>
            <div class="mini-bar fouling"><i style="width:${clamp(cage.fouling, 0, 100)}%"></i></div>
            <strong>${cage.fouling.toFixed(0)}</strong>
          </div>
          <div class="mini-bar-row">
            <span>网衣</span>
            <div class="mini-bar net"><i style="width:${clamp(cage.netIntegrity, 0, 100)}%"></i></div>
            <strong>${cage.netIntegrity.toFixed(0)}</strong>
          </div>
        </div>
      </div>
    </article>`;
}

function updateCages() {
  $("#cageStack").innerHTML = state.cages.map(cageCardMarkup).join("");
  const healthy = state.cages.filter((cage) => cage.health >= HEALTH_TARGET).length;
  const clean = state.cages.filter((cage) => cage.pollution <= POLLUTION_LIMIT).length;
  $("#missionCount").textContent = `${healthy + clean} / 6`;
  $("#missionHint").textContent = state.cages.some((cage) => cage.tear)
    ? "有网箱破损，先完成应急修补并保持观察窗无新增告警。"
    : state.cages.some((cage) => cage.pollution > POLLUTION_LIMIT)
      ? "污染仍高于验收线，洗网可降低附着并改善水交换。"
      : "指标处于验收线内，继续定量投喂并保持增氧。";
}

function updateResources() {
  const values = state.resources;
  $("#resourcePower").textContent = values.power.toFixed(1);
  $("#resourceFuel").textContent = values.fuel.toFixed(1);
  $("#resourceFeed").textContent = values.feed.toFixed(1);
  $("#resourceKits").textContent = String(values.repairKits);
  $("#powerBar").style.width = `${clamp((values.power / 86) * 100, 0, 100)}%`;
  $("#fuelBar").style.width = `${clamp((values.fuel / 48) * 100, 0, 100)}%`;
  $("#feedBar").style.width = `${clamp((values.feed / 34) * 100, 0, 100)}%`;
  $("#kitsBar").style.width = `${clamp((values.repairKits / 2) * 100, 0, 100)}%`;
}

function elapsedLabel(hours) {
  const minutes = Math.round(hours * 60);
  return `T+${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function updateMissionClock() {
  const progress = state.tick / TOTAL_TICKS;
  $("#clockValue").textContent = state.clock;
  $("#canvasClock").textContent = state.clock;
  $("#clockDelta").textContent = elapsedLabel(state.hour);
  $("#timelineFill").style.width = `${progress * 100}%`;
  $("#timelineNow").style.left = `${progress * 100}%`;
  $("#currentValue").textContent = state.tide.current.toFixed(2);
  $("#exchangeValue").textContent = state.tide.exchange.toFixed(2);
  $("#tideLabel").textContent = state.tide.label;
  $("#flowState").textContent =
    state.tide.current > 1.18 ? "强流" : state.tide.current > 0.78 ? "中流" : "缓流";
  $("#flowState").style.color = state.tide.current > 1.18 ? "var(--danger)" : "var(--text)";
  $("#currentArrow").textContent = "→";
  $("#runDot").classList.toggle("running", running && !state.finished);
  $("#runStatus").textContent = state.finished ? "已完成" : running ? "运行中" : "已暂停";
}

function jobIcon(type) {
  return { toggleAerator: "A", cleanNet: "C", feed: "F", repairNet: "R" }[type] || "·";
}

function updateQueue() {
  const queue = $("#queueList");
  $("#queueCount").textContent = String(state.pending.length);
  $("#queueEmpty").hidden = state.pending.length > 0;
  const signature = state.pending
    .map((job) => `${job.id}:${Math.round(((state.tick - job.issuedAt) / job.delay) * 20)}`)
    .join("|");
  if (signature === lastQueueSignature) return;
  lastQueueSignature = signature;
  queue.innerHTML = state.pending
    .map((job) => {
      const percent = clamp(((state.tick - job.issuedAt) / job.delay) * 100, 0, 100);
      const eta = Math.max(0, (job.dueAt - state.tick) * DT);
      return `
        <div class="queue-item">
          <span class="queue-icon">${jobIcon(job.type)}</span>
          <div class="queue-info">
            <strong>${escapeHtml(job.label)}</strong>
            <div class="queue-progress"><i style="width:${percent}%"></i></div>
          </div>
          <span class="queue-eta"><span>ETA</span><strong>${eta.toFixed(1)}h</strong></span>
        </div>`;
    })
    .join("");
}

function updateLog() {
  $("#logCount").textContent = String(state.log.length);
  if (lastLogCount === state.log.length) return;
  lastLogCount = state.log.length;
  const entries = [...state.log].slice(-48).reverse();
  $("#logList").innerHTML = entries
    .map(
      (entry) => `
        <div class="log-entry ${entry.type}">
          <span class="log-time">${entry.clock}</span>
          <span class="log-bullet"></span>
          <div class="log-content">
            <strong>${escapeHtml(entry.title)}</strong>
            <p>${escapeHtml(entry.message)}</p>
          </div>
        </div>`
    )
    .join("");
}

function updateObservation() {
  const observation = state.observation;
  const banner = $("#observationBanner");
  banner.hidden = !observation;
  if (!observation) return;
  const total = Math.max(1, observation.endTick - observation.startTick);
  const elapsed = clamp(observation.endTick - state.tick, 0, total);
  $("#observationTime").textContent = observation.active
    ? `${(elapsed * DT).toFixed(1)}h 剩余`
    : observation.passed
      ? "通过"
      : "未通过";
  $("#observationFill").style.width = `${clamp((1 - elapsed / total) * 100, 0, 100)}%`;
  banner.style.borderColor = observation.passed === false ? "rgba(255,116,124,.45)" : "";
}

function updateFaultBanner() {
  const fault = state.fault;
  const banner = $("#alarmBanner");
  banner.hidden = !fault || state.observation?.passed === true;
  $("#faultRecordButton").hidden = !fault;
}

function updateUI() {
  $("#scenarioName").textContent = state.scenario.name;
  $("#scenarioNote").textContent = state.scenario.subtitle;
  $$(".scenario-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.scenario === state.scenarioId);
  });
  updateMissionClock();
  updateCages();
  updateResources();
  updateActionControls();
  updateQueue();
  updateLog();
  updateObservation();
  updateFaultBanner();
  audio.update(state);
}

function updatePlayState() {
  const button = $("#playButton");
  button.classList.toggle("is-playing", running);
  $("#playLabel").textContent = running ? "暂停" : state.tick ? "继续" : "开始";
  $("#runDot").classList.toggle("running", running && !state.finished);
  $("#runStatus").textContent = state.finished ? "已完成" : running ? "运行中" : "已暂停";
}

function setRunning(next) {
  if (state.finished && next) {
    showResultDialog();
    return;
  }
  running = next;
  accumulator = 0;
  lastFrame = performance.now();
  updatePlayState();
}

function toggleRunning() {
  setRunning(!running);
}

function faultStateMarkup(faultSnapshot, cageId, title, className) {
  const cage = faultSnapshot.cages.find((item) => item.id === cageId);
  return `
    <div class="fault-state ${className}">
      <span>${title}</span>
      <h3>${faultSnapshot.clock} · ${escapeHtml(cage.name)}</h3>
      <div class="fault-kv"><span>健康度</span><strong>${cage.health.toFixed(1)}</strong></div>
      <div class="fault-kv"><span>溶氧</span><strong>${cage.oxygen.toFixed(2)} mg/L</strong></div>
      <div class="fault-kv"><span>污染</span><strong>${cage.pollution.toFixed(1)}</strong></div>
      <div class="fault-kv"><span>网衣完整度</span><strong class="${cage.tear ? "bad" : ""}">${cage.netIntegrity.toFixed(0)}%</strong></div>
      <div class="fault-kv"><span>网衣状态</span><strong class="${cage.tear ? "bad" : ""}">${cage.tear ? "破口" : "完整"}</strong></div>
      <div class="fault-kv"><span>电力 / 燃油</span><strong>${faultSnapshot.resources.power.toFixed(1)} / ${faultSnapshot.resources.fuel.toFixed(1)}</strong></div>
    </div>`;
}

function showFaultDialog() {
  const fault = state.fault;
  if (!fault) return;
  $("#faultSummary").innerHTML = `
    <div class="fault-state-grid">
      ${faultStateMarkup(fault.before, fault.cageId, "触发前 / BEFORE", "before")}
      ${faultStateMarkup(fault.after, fault.cageId, "触发后 / AFTER", "after")}
    </div>
    <div class="audit-digest">
      触发：${fault.triggerClock} · 流速 ${fault.current.toFixed(2)} m/s · 逃逸约 ${fault.escaped} 尾
      <br>快照已写入运行记录，等待应急修补包抵达。
    </div>`;
  openDialog("faultDialog");
}

function showFaultRecord() {
  const fault = state.fault;
  if (!fault) return;
  const observation = state.observation;
  const recovery = observation
    ? {
        startClock: observation.start.clock,
        endClock: observation.end?.clock || "观察中",
        passed: observation.passed ?? null,
        issues: observation.issues || [],
        resourceDelta: observation.resourceDelta || null
      }
    : null;
  $("#faultRecordBody").innerHTML = `
    <div class="record-section">
      <h3>故障触发前 / KEY STATE BEFORE</h3>
      <pre>${escapeHtml(JSON.stringify(fault.before, null, 2))}</pre>
    </div>
    <div class="record-section">
      <h3>故障触发后 / KEY STATE AFTER</h3>
      <pre>${escapeHtml(JSON.stringify(fault.after, null, 2))}</pre>
    </div>
    <div class="record-section">
      <h3>修补与固定观察窗</h3>
      <pre>${escapeHtml(JSON.stringify({ recovery, observation }, null, 2))}</pre>
    </div>`;
  openDialog("faultRecordDialog");
}

function showResultDialog() {
  const failed = !state.success;
  $("#resultHead").classList.toggle("danger-head", failed);
  $("#resultTitle").textContent = state.success ? "12 小时任务达标" : "12 小时任务未达标";
  $("#resultSubtitle").textContent = state.success
    ? "三箱鱼群健康度均达到验收线，有机污染未超限。"
    : (state.finalFailures || []).join("；");
  const rows = state.cages
    .map((cage) => {
      const healthOk = cage.health >= HEALTH_TARGET;
      const pollutionOk = cage.pollution <= POLLUTION_LIMIT;
      return `
        <tr>
          <td>${cage.name}</td>
          <td class="${healthOk ? "ok" : "bad"}">${cage.health.toFixed(1)} ${healthOk ? "达标" : "未达标"}</td>
          <td class="${pollutionOk ? "ok" : "bad"}">${cage.pollution.toFixed(1)} ${pollutionOk ? "达标" : "超限"}</td>
          <td>${cage.netIntegrity.toFixed(0)}%</td>
          <td>${cage.feedWaste.toFixed(1)} kg</td>
        </tr>`;
    })
    .join("");
  const observationLine = state.observation
    ? state.observation.active
      ? "恢复观察仍在进行"
      : state.observation.passed
        ? "2 小时恢复观察通过，无残留破损或新增错误"
        : `恢复观察未通过：${(state.observation.issues || []).join("；")}`
    : "本轮未触发网具破损";
  $("#resultBody").innerHTML = `
    <div class="result-hero ${failed ? "failed" : ""}">
      <span class="result-grade">${state.success ? "A" : "!"}</span>
      <div>
        <h3>${state.success ? "验收通过" : "需要重新调控"}</h3>
        <p>${observationLine}</p>
      </div>
    </div>
    <table class="result-table">
      <thead><tr><th>网箱</th><th>健康度 / ≥72</th><th>污染 / ≤42</th><th>网衣</th><th>饲料浪费</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="audit-digest" style="margin-top:12px">
      剩余资源：电力 ${state.resources.power.toFixed(1)} kWh · 燃油 ${state.resources.fuel.toFixed(1)} L ·
      饲料 ${state.resources.feed.toFixed(1)} kg · 修补包 ${state.resources.repairKits} 套
    </div>`;
  resultShown = true;
  setRunning(false);
  openDialog("resultDialog");
}

function detectNewEvents(previousObservationActive) {
  if (state.fault && state.fault !== seenFault) {
    seenFault = state.fault;
    setRunning(false);
    updateUI();
    audio.alarm();
    showFaultDialog();
    showToast("三号箱网具撕裂，模拟已自动暂停", "error", 4200);
  }
  if (previousObservationActive && state.observation && !state.observation.active) {
    updateUI();
    showToast(
      state.observation.passed ? "2 小时恢复观察通过，无残留错误" : "恢复观察未通过，请检查故障快照",
      state.observation.passed ? "success" : "error",
      4200
    );
  }
  if (state.finished && !resultShown) {
    updateUI();
    showResultDialog();
  }
}

function advanceOneTick() {
  if (state.finished) return;
  const previousObservationActive = Boolean(state.observation?.active);
  step(state);
  updateUI();
  detectNewEvents(previousObservationActive);
}

function performAction(type, payload = {}) {
  const result = dispatch(state, type, payload);
  if (!result.ok) {
    showToast(result.message, "warning");
    return false;
  }
  audio.confirm();
  showToast(result.message);
  updateUI();
  return true;
}

function resetSimulation(nextScenario = scenarioId) {
  scenarioId = nextScenario;
  state = createSimulation(scenarioId);
  running = false;
  speed = 1;
  accumulator = 0;
  resultShown = false;
  seenFault = null;
  seenObservationEnd = null;
  lastLogCount = -1;
  lastQueueSignature = "";
  selectedFeedAmount = 4;
  $$(".speed-button").forEach((button) => button.classList.toggle("is-active", button.dataset.speed === "1"));
  $$("#amountSwitch button").forEach((button) => button.classList.toggle("is-active", button.dataset.amount === "4"));
  closeAllDialogs();
  buildActionControls();
  updatePlayState();
  updateUI();
  showToast(`已重置 · ${state.scenario.name}`, "success", 1900);
}

function switchScenario(nextScenario) {
  if (scenarioId === nextScenario && state.tick === 0) return;
  resetSimulation(nextScenario);
}

function compactRun(run) {
  const cageLines = run.final.cages
    .map(
      (cage) =>
        `${cage.id}号箱  健康 ${cage.health.toFixed(2)}  污染 ${cage.pollution.toFixed(2)}  网衣 ${cage.netIntegrity.toFixed(0)}%`
    )
    .join("\n");
  const faultLine = run.fault
    ? `故障 ${run.fault.triggerClock} · 修补 ${run.fault.recovery?.clock || "--"} · 观察 ${run.fault.observation?.passed ? "通过" : "未完成/未通过"}`
    : "未触发故障";
  return [
    `完成 ${run.final.clock} · ${run.final.success ? "达标" : "未达标"}`,
    cageLines,
    `资源 电${run.final.resources.power.toFixed(1)} 油${run.final.resources.fuel.toFixed(1)} 料${run.final.resources.feed.toFixed(1)} 包${run.final.resources.repairKits}`,
    faultLine
  ].join("\n");
}

function runAuditPair() {
  const plan = AUDIT_PLANS[scenarioId].map((entry) => ({ ...entry }));
  const runA = runReport(replayPlan(scenarioId, plan));
  const runB = runReport(replayPlan(scenarioId, plan));
  const checks = [
    {
      name: "任务序列",
      equal: JSON.stringify(runA.taskSequence) === JSON.stringify(runB.taskSequence),
      detail: `${runA.taskSequence.length} 条事件`
    },
    {
      name: "输入序列",
      equal: JSON.stringify(runA.inputs) === JSON.stringify(runB.inputs),
      detail: `${runA.inputs.length} 条指令`
    },
    {
      name: "资源轨迹",
      equal: JSON.stringify(runA.resourceTrace) === JSON.stringify(runB.resourceTrace),
      detail: `${runA.resourceTrace.length} 个检查点`
    },
    {
      name: "最终结果",
      equal: JSON.stringify(runA.final) === JSON.stringify(runB.final),
      detail: runA.final.success ? "两次均达标" : "两次均未达标"
    },
    {
      name: "完整状态指纹",
      equal: runA.digest === runB.digest,
      detail: runA.digest
    }
  ];
  if (runA.fault || runB.fault) {
    checks.push({
      name: "故障恢复",
      equal: JSON.stringify(runA.fault) === JSON.stringify(runB.fault),
      detail: runA.fault?.observation?.passed ? "观察窗均通过" : "观察窗未通过"
    });
  }
  const allEqual = checks.every((check) => check.equal);
  auditEvidence = {
    scenarioId,
    scenarioName: state.scenario.name,
    plan,
    checks,
    allEqual,
    runA,
    runB
  };
  $("#auditSubtitle").textContent = `${state.scenario.name} · 同一输入从头连续执行两次`;
  $("#auditBody").innerHTML = `
    <div class="audit-banner">
      <strong>${allEqual ? "双跑结果完全一致" : "检测到不一致"}</strong>
      <span>${checks.filter((check) => check.equal).length} / ${checks.length} 项通过</span>
    </div>
    <div class="audit-checks">
      ${checks
        .map(
          (check) => `
            <div class="audit-check">
              <span>${check.name} · ${escapeHtml(check.detail)}</span>
              <b>${check.equal ? "一致" : "差异"}</b>
            </div>`
        )
        .join("")}
    </div>
    <div class="audit-digest">
      RUN A <strong>${runA.digest}</strong><br>
      RUN B <strong>${runB.digest}</strong>
    </div>
    <div class="audit-runs">
      <article class="audit-run"><span>RUN A / FIRST</span><h3>第一次运行</h3><pre>${escapeHtml(compactRun(runA))}</pre></article>
      <article class="audit-run"><span>RUN B / SECOND</span><h3>第二次运行</h3><pre>${escapeHtml(compactRun(runB))}</pre></article>
    </div>
    <p class="mission-hint">审计从初始状态重新开始，不读取当前现场状态。资源轨迹包含每个 0.1 小时检查点。</p>`;
  openDialog("auditDialog");
  if (!allEqual) showToast("双跑审计发现差异，请导出 JSON 检查", "error", 4500);
  return auditEvidence;
}

function exportAudit() {
  if (!auditEvidence) return;
  const blob = new Blob([JSON.stringify(auditEvidence, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `tidewatch-audit-${scenarioId}-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("审计证据已导出");
}

function bindEvents() {
  $("#playButton").addEventListener("click", toggleRunning);
  $("#stepButton").addEventListener("click", () => {
    setRunning(false);
    advanceOneTick();
  });
  $("#resetButton").addEventListener("click", () => resetSimulation());
  $("#resultResetButton").addEventListener("click", () => resetSimulation());

  $$(".scenario-button").forEach((button) => {
    button.addEventListener("click", () => switchScenario(button.dataset.scenario));
  });
  $$(".speed-button").forEach((button) => {
    button.addEventListener("click", () => {
      speed = Number(button.dataset.speed);
      $$(".speed-button").forEach((item) => item.classList.toggle("is-active", item === button));
      showToast(`模拟速度 ${speed}×`, "success", 1200);
    });
  });

  $("#audioButton").addEventListener("click", async () => {
    try {
      await audio.toggle();
      if (audio.enabled) showToast("环境声已开启：海况与增氧泵驱动声场");
    } catch (error) {
      showToast(error.message, "warning");
    }
  });
  $("#auditButton").addEventListener("click", runAuditPair);
  $("#exportAuditButton").addEventListener("click", exportAudit);

  $("#aeratorActions").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    performAction(button.dataset.action, { cageId: Number(button.dataset.cage) });
  });
  $("#cleanActions").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    performAction(button.dataset.action, { cageId: Number(button.dataset.cage) });
  });

  $("#feedCage").addEventListener("change", updateActionControls);
  $("#amountSwitch").addEventListener("click", (event) => {
    const button = event.target.closest("[data-amount]");
    if (!button) return;
    selectedFeedAmount = Number(button.dataset.amount);
    $$("#amountSwitch button").forEach((item) => item.classList.toggle("is-active", item === button));
    updateActionControls();
  });
  $("#feedButton").addEventListener("click", () => {
    performAction("feed", { cageId: Number($("#feedCage").value), amount: selectedFeedAmount });
  });

  ["#repairButton", "#faultRepairAction", "#alarmRepairButton"].forEach((selector) => {
    $(selector).addEventListener("click", () => {
      const target = state.cages.find((cage) => cage.tear);
      if (!target) {
        showToast("当前没有可修补的破损网箱", "warning");
        return;
      }
      if (performAction("repairNet", { cageId: target.id })) closeDialog("faultDialog");
    });
  });

  $$(".activity-tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".activity-tabs button").forEach((item) => item.classList.toggle("is-active", item === button));
      $("#queueView").hidden = button.dataset.tab !== "queue";
      $("#logView").hidden = button.dataset.tab !== "log";
    });
  });
  $$("[data-close]").forEach((button) => {
    button.addEventListener("click", () => closeDialog(button.dataset.close));
  });
  $("#faultRecordButton").addEventListener("click", showFaultRecord);

  document.addEventListener("keydown", (event) => {
    if (DIALOG_IDS.some((id) => document.getElementById(id).open)) return;
    const tag = event.target.tagName;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
    if (event.code === "Space") {
      event.preventDefault();
      toggleRunning();
    }
    if (event.code === "ArrowLeft") {
      event.preventDefault();
      setRunning(false);
      advanceOneTick();
    }
    if (event.key.toLowerCase() === "r" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      resetSimulation();
    }
  });
}

function animationLoop(now) {
  const elapsed = Math.min(120, now - lastFrame);
  lastFrame = now;
  if (running && !state.finished) {
    accumulator += elapsed * speed;
    let guard = 0;
    while (accumulator >= TICK_MS && running && !state.finished && guard < 12) {
      accumulator -= TICK_MS;
      advanceOneTick();
      guard += 1;
    }
  }
  renderer.draw(state, now, { selectedCage: Number($("#feedCage").value) });
  requestAnimationFrame(animationLoop);
}

buildActionControls();
bindEvents();
updatePlayState();
updateUI();
requestAnimationFrame(animationLoop);

window.__tidewatch = {
  get state() {
    return state;
  },
  get running() {
    return running;
  },
  get snapshot() {
    return snapshot(state);
  },
  get report() {
    return runReport(state);
  },
  get auditEvidence() {
    return auditEvidence;
  },
  plans: AUDIT_PLANS,
  step: () => {
    setRunning(false);
    advanceOneTick();
    return snapshot(state);
  },
  runUntil: (tick) => {
    setRunning(false);
    while (!state.finished && state.tick < tick) advanceOneTick();
    return snapshot(state);
  },
  dispatch: (type, payload) => performAction(type, payload),
  reset: (id = scenarioId) => resetSimulation(id),
  audit: () => runAuditPair()
};
