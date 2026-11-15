import {
  FIXED_DT,
  LIMITS,
  NO_GO,
  SHIP,
  Simulation,
  bandDistance,
  clamp,
  distance,
} from "./sim.js";
import {
  buildAuditReport,
  buildFailureTrial,
  buildMissionTrial,
  observeRecovery,
} from "./scenarios.js";
import { SalvageAudio } from "./audio.js";
import { Renderer } from "./render.js";

const $ = (selector) => document.querySelector(selector);
const canvas = $("#game");
const renderer = new Renderer(canvas);
const audio = new SalvageAudio();
const seed = 550;

let sim = new Simulation({ seed });
let paused = false;
let sessionInputs = [];
let accumulator = 0;
let lastFrame = performance.now();
let eventCursor = 0;
let outcomeShown = false;
let pendingCapture = false;
let pendingRelease = false;
let audioEnabled = true;
let audioPrimed = false;
let toastTimer = 0;
let auditReport = null;
let auditRunning = false;

const keys = new Set();
const mode = { current: "live", replay: null };
const dom = {
  time: $("#time-readout"),
  tick: $("#tick-readout"),
  state: $("#mission-state"),
  cargo: $("#cargo-list"),
  deliveryDots: $("#delivery-dots"),
  deliveryCount: $("#delivery-count"),
  fuel: $("#fuel-readout"),
  fuelMeter: $("#fuel-meter"),
  fuelTrack: $("#fuel-meter")?.parentElement,
  mass: $("#mass-readout"),
  inertia: $("#inertia-readout"),
  accel: $("#accel-readout"),
  angular: $("#angular-readout"),
  speed: $("#speed-readout"),
  collision: $("#collision-readout"),
  lock: $("#lock-state"),
  wind: $("#wind-readout"),
  windRow: $(".wind-row"),
  windArrow: $("#wind-arrow"),
  pause: $("#pause-button"),
  step: $("#step-button"),
  toast: $("#toast"),
  outcome: $("#outcome-modal"),
  outcomeCard: $("#outcome-card"),
  auditDrawer: $("#audit-drawer"),
  auditContent: $("#audit-content"),
  auditBadge: $("#audit-badge"),
  auditSubtitle: $("#audit-subtitle"),
  summaryText: $("#audit-summary-text"),
  summaryLight: $(".summary-light"),
  replayBar: $("#replay-bar"),
  replaySlider: $("#replay-slider"),
  replayTime: $("#replay-time"),
  replayPlay: $("#replay-play"),
  replayTitle: $("#replay-title"),
  audioIcon: $("#audio-icon"),
};

const debrisShort = {
  panel: "PANEL",
  tank: "TANK",
  truss: "TRUSS",
  core: "CORE",
};

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(1).padStart(4, "0")}`;
}

function showToast(message, duration = 2300) {
  dom.toast.textContent = message;
  dom.toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => dom.toast.classList.remove("show"), duration);
}

async function primeAudio() {
  if (audioPrimed) return;
  audioPrimed = true;
  await audio.setEnabled(audioEnabled);
  audio.update({ status: sim.state.status });
}

function buildCargoList() {
  dom.cargo.innerHTML = "";
  sim.state.debris.forEach((debris, index) => {
    const item = document.createElement("div");
    item.className = "cargo-item";
    item.dataset.id = debris.id;
    item.innerHTML = `
      <span class="cargo-icon">${String(index + 1).padStart(2, "0")}</span>
      <span class="cargo-copy">
        <strong>${debris.label}</strong>
        <span>${debris.mass} kg · R${debris.radius}</span>
      </span>
      <span class="cargo-status">待回收</span>
    `;
    dom.cargo.appendChild(item);
  });
  dom.deliveryDots.innerHTML = "<i></i><i></i><i></i><i></i>";
}

function updateCargo(state) {
  state.debris.forEach((debris) => {
    const item = dom.cargo.querySelector(`[data-id="${debris.id}"]`);
    if (!item) return;
    const status = item.querySelector(".cargo-status");
    const icon = item.querySelector(".cargo-icon");
    item.classList.toggle("towing", state.attachedId === debris.id);
    item.classList.toggle("delivered", debris.state === "delivered");
    status.textContent = debris.state === "delivered"
      ? "已交付"
      : state.attachedId === debris.id
        ? "拖曳锁定"
        : "待回收";
    icon.textContent = debris.state === "delivered" ? "✓" : debrisShort[debris.id]?.slice(0, 2) ?? "··";
  });
  Array.from(dom.deliveryDots.children).forEach((dot, index) => {
    dot.classList.toggle("on", index < state.deliveredCount);
  });
  dom.deliveryCount.textContent = `${state.deliveredCount} / 4`;
}

function stateLabel(status) {
  if (status === "complete") return "任务完成";
  if (status === "failed") return "任务中止";
  if (paused) return "已暂停";
  return "作业中";
}

function updateHud(state, options = {}) {
  const profile = sim === state ? sim.getControlProfile() : {
    totalMass: SHIP.dryMass,
    inertia: SHIP.inertia,
    linearAccel: SHIP.thrust / SHIP.dryMass,
    angularAccel: SHIP.torque / SHIP.inertia,
  };
  const liveProfile = options.sim ? options.sim.getControlProfile() : profile;
  dom.time.textContent = formatTime(state.time);
  dom.tick.textContent = String(state.tick).padStart(6, "0");
  dom.state.textContent = stateLabel(state.status);
  dom.state.className = `state-pill ${state.status}`;
  dom.fuel.textContent = `${state.ship.fuel.toFixed(1)}%`;
  dom.fuelMeter.style.width = `${clamp(state.ship.fuel, 0, 100)}%`;
  dom.fuelTrack?.classList.toggle("low", state.ship.fuel < 24);
  dom.mass.textContent = `${Math.round(liveProfile.totalMass).toLocaleString("en-US")} kg`;
  dom.inertia.textContent = `${Math.round(liveProfile.inertia / 1000)}k`;
  dom.accel.textContent = liveProfile.linearAccel.toFixed(1);
  dom.angular.textContent = liveProfile.angularAccel.toFixed(2);
  dom.speed.textContent = `${Math.hypot(state.ship.vx, state.ship.vy).toFixed(1)} m/s`;
  dom.collision.textContent = `${state.collisionCount} / ${LIMITS.collisions}`;
  const nearest = renderer.nearestFreeDebris(state);
  const near = nearest && nearest.gap <= LIMITS.captureRange;
  if (state.attachedId) {
    const attached = state.debris.find((item) => item.id === state.attachedId);
    dom.lock.textContent = `拖曳 · ${attached?.label ?? "目标"}`;
    dom.lock.classList.add("locked");
  } else if (near) {
    dom.lock.textContent = "ARM 可捕获";
    dom.lock.classList.add("locked");
  } else {
    dom.lock.textContent = "ARM 待命";
    dom.lock.classList.remove("locked");
  }
  dom.wind.textContent = state.wind.active ? `阵风 ${Math.round(state.wind.strength * 100)}%` : "平静";
  dom.windRow.classList.toggle("gust", state.wind.active);
  dom.windArrow.style.transform = state.wind.direction > 0 ? "scaleX(1)" : "scaleX(-1)";
  dom.pause.textContent = paused ? "继续" : "暂停";
  dom.pause.classList.toggle("active", paused);
  updateCargo(state);
}

function resetEventCursor(nextSim) {
  eventCursor = nextSim.state.events.length;
}

function consumeEvents(nextSim) {
  const events = nextSim.state.events;
  for (; eventCursor < events.length; eventCursor += 1) {
    const event = events[eventCursor];
    renderer.pushEvent(event, nextSim.state);
    if (event.type === "capture") audio.ping("capture");
    if (event.type === "deliver") audio.ping("lock");
    if (event.type === "collision") audio.burst("collision");
    if (event.type === "failure") audio.ping("warning");
    if (event.type === "mission-complete") audio.ping("capture");
  }
}

function currentInput() {
  const thrust = (keys.has("KeyW") ? 1 : 0) + (keys.has("KeyS") ? -1 : 0);
  const turn = (keys.has("KeyA") ? -1 : 0) + (keys.has("KeyD") ? 1 : 0);
  const input = {
    thrust: clamp(thrust, -1, 1),
    turn: clamp(turn, -1, 1),
    capture: pendingCapture,
    release: pendingRelease,
  };
  pendingCapture = false;
  pendingRelease = false;
  return input;
}

function stepLive() {
  if (sim.state.status !== "active") return false;
  const input = currentInput();
  sessionInputs.push({ ...input });
  sim.step(input);
  consumeEvents(sim);
  updateHud(sim.state, { sim });
  if (sim.state.status !== "active") handleOutcome(sim.state);
  return true;
}

function togglePause() {
  if (mode.current === "replay") {
    mode.replay.playing = !mode.replay.playing;
    dom.replayPlay.textContent = mode.replay.playing ? "Ⅱ" : "▶";
    return;
  }
  paused = !paused;
  accumulator = 0;
  updateHud(sim.state, { sim });
}

function singleStep() {
  if (mode.current === "replay") {
    mode.replay.playing = false;
    advanceReplay(FIXED_DT, true);
    return;
  }
  paused = true;
  accumulator = 0;
  stepLive();
  updateHud(sim.state, { sim });
}

function resetGame({ silent = false } = {}) {
  sim = new Simulation({ seed });
  paused = false;
  accumulator = 0;
  sessionInputs = [];
  outcomeShown = false;
  pendingCapture = false;
  pendingRelease = false;
  renderer.effects = [];
  mode.current = "live";
  mode.replay = null;
  dom.replayBar.hidden = true;
  dom.outcome.hidden = true;
  resetEventCursor(sim);
  buildCargoList();
  updateHud(sim.state, { sim });
  if (!silent) showToast("状态已重置 · 固定种子 0550 · 资源恢复满额");
}

function handleOutcome(state) {
  if (outcomeShown) return;
  outcomeShown = true;
  const complete = state.status === "complete";
  dom.outcomeCard.classList.remove("failed", "complete");
  dom.outcomeCard.classList.add(complete ? "complete" : "failed");
  $("#outcome-kicker").textContent = complete ? "MISSION COMPLETE" : "FAILURE RECORDED";
  $("#outcome-title").textContent = complete ? "母站回收完成" : state.failure?.label ?? "任务中止";
  $("#outcome-copy").textContent = complete
    ? `四块碎片均已固定。任务用时 ${state.time.toFixed(1)} 秒，剩余推进剂 ${state.ship.fuel.toFixed(1)}%。`
    : `固定种子轨迹已在 T+${state.time.toFixed(3)}s 触发故障。触发前与触发时状态已写入审计记录；重置将恢复同一初始条件。`;
  $("#outcome-reason").textContent = complete
    ? `${state.deliveryOrder.length}/4 已回收`
    : `${state.failure?.label ?? "未知"} @ #${state.failure?.tick ?? state.tick}`;
  $("#outcome-fuel").textContent = `${state.ship.fuel.toFixed(2)}%`;
  $("#outcome-delivery").textContent = `${state.deliveredCount} / 4`;
  dom.outcome.hidden = false;
}

function toggleAudio() {
  audioEnabled = !audioEnabled;
  dom.audioIcon.textContent = audioEnabled ? "◖" : "○";
  primeAudio().then(() => audio.setEnabled(audioEnabled));
  showToast(audioEnabled ? "音频已开启" : "音频已静音");
}

function beginReplay(inputs, label, source = "session") {
  if (!inputs.length) {
    showToast("当前没有可回放输入，已载入固定种子通关演示");
    const mission = buildMissionTrial({ seed });
    inputs = mission.inputs;
    label = "SEED 0550 / MISSION DEMO";
    source = "demo";
  }
  const replaySim = new Simulation({ seed });
  mode.current = "replay";
  mode.replay = {
    sim: replaySim,
    inputs: inputs.map((input) => ({ ...input })),
    index: 0,
    accumulator: 0,
    playing: true,
    speed: Number(dom.replaySlider.speed ?? $("#replay-speed").value) || 4,
    source,
    label,
    outcomePending: false,
  };
  renderer.effects = [];
  outcomeShown = false;
  dom.outcome.hidden = true;
  dom.replayBar.hidden = false;
  dom.replaySlider.max = String(inputs.length);
  dom.replaySlider.value = "0";
  dom.replayTitle.textContent = `${label} · ${inputs.length} ticks`;
  dom.replayPlay.textContent = "Ⅱ";
  $("#replay-speed").value = String(mode.replay.speed);
  eventCursor = 0;
  updateReplayHud();
  showToast(`轨迹回放 · ${label}`);
}

function updateReplayHud() {
  if (!mode.replay) return;
  const replay = mode.replay;
  dom.replaySlider.value = String(replay.index);
  dom.replayTime.textContent = formatTime(replay.sim.state.time);
  updateHud(replay.sim.state, { sim: replay.sim });
}

function finishReplayIfNeeded() {
  const replay = mode.replay;
  if (!replay || replay.outcomePending) return;
  if (replay.sim.state.status === "active" && replay.index < replay.inputs.length) return;
  replay.outcomePending = true;
  replay.playing = false;
  dom.replayPlay.textContent = "▶";
  const state = replay.sim.state;
  if (state.status === "failed") {
    showToast(`回放结束 · ${state.failure?.label} @ T+${state.time.toFixed(2)}s`, 3200);
  } else if (state.status === "complete") {
    showToast(`回放完成 · 四块碎片全部回收`, 3200);
  }
  updateReplayHud();
}

function advanceReplay(deltaSeconds, forceOne = false) {
  const replay = mode.replay;
  if (!replay || (!replay.playing && !forceOne)) return;
  replay.accumulator += deltaSeconds * replay.speed;
  const maxSteps = Math.max(1, Math.ceil(replay.speed * 2.2));
  const steps = forceOne ? 1 : Math.min(maxSteps, Math.floor(replay.accumulator / FIXED_DT));
  if (!forceOne) replay.accumulator = 0;
  for (let count = 0; count < steps; count += 1) {
    if (replay.sim.state.status !== "active" || replay.index >= replay.inputs.length) break;
    const input = replay.inputs[replay.index];
    replay.sim.step(input);
    replay.index += 1;
    consumeEvents(replay.sim);
  }
  finishReplayIfNeeded();
  updateReplayHud();
}

function seekReplay(targetTick) {
  const replay = mode.replay;
  if (!replay) return;
  replay.playing = false;
  replay.sim.reset(seed);
  replay.accumulator = 0;
  renderer.effects = [];
  const target = clamp(Number(targetTick) || 0, 0, replay.inputs.length);
  for (let index = 0; index < target; index += 1) {
    if (replay.sim.state.status !== "active") break;
    replay.sim.step(replay.inputs[index]);
  }
  replay.index = replay.sim.state.tick;
  replay.outcomePending = false;
  eventCursor = replay.sim.state.events.length;
  dom.replayPlay.textContent = "▶";
  finishReplayIfNeeded();
  updateReplayHud();
}

function closeReplay() {
  mode.current = "live";
  mode.replay = null;
  dom.replayBar.hidden = true;
  renderer.effects = [];
  resetEventCursor(sim);
  buildCargoList();
  updateHud(sim.state, { sim });
}

function replayCurrentSession() {
  beginReplay(sessionInputs, `SEED ${String(seed).padStart(4, "0")} / LIVE`, "session");
}

function startFailureDrill() {
  const failure = buildFailureTrial({ seed });
  beginReplay(failure.inputs, `FAILURE DRILL / ${failure.failure?.label ?? "NO-GO"}`, "failure");
}

function startMissionDemo() {
  const mission = buildMissionTrial({ seed });
  beginReplay(mission.inputs, "MISSION DEMO / 4 DEBRIS", "demo");
  showToast("通关演示已载入 · 可调节回放速度或拖动时间轴");
}

function auditRow(label, before, at) {
  return `<tr><td>${label}</td><td>${before}</td><td>${at}</td></tr>`;
}

function renderAudit(report) {
  const pass = report.mission.pass && report.failure.pass && report.recovery.pass && report.mission.controlChanged;
  dom.auditBadge.textContent = pass ? "4 / 4 PASS" : "AUDIT FAIL";
  dom.auditBadge.classList.toggle("fail", !pass);
  dom.auditSubtitle.textContent = `种子 ${report.seed} · ${report.mission.inputCount.toLocaleString("en-US")} 个输入 · 同一输入序列独立运行两次 · ${new Date(report.generatedAt).toLocaleTimeString("zh-CN", { hour12: false })}`;
  dom.summaryLight.className = `summary-light ${pass ? "pass" : "fail"}`;
  dom.summaryText.textContent = pass
    ? `4/4 PASS · ${report.mission.traceHash}`
    : "存在不一致项";

  const initial = report.mission.initialProfile;
  const loaded = report.mission.loadedProfile;
  const failureBefore = report.failure.before;
  const failureAt = report.failure.at;
  const recoveryAfter = report.recovery.after;
  const sequence = report.mission.sequence.length
    ? report.mission.sequence
    : ["无任务事件"];
  const deliveryLabels = report.mission.deliveryOrder.join(" → ");

  dom.auditContent.innerHTML = `
    <div class="audit-cards">
      <article class="audit-card ${report.mission.pass ? "pass" : "fail"}">
        <div class="audit-card-top"><h3>双次重放一致</h3><b>${report.mission.pass ? "PASS" : "FAIL"}</b></div>
        <dl>
          <dt>运行次数</dt><dd>同一组 ${report.mission.inputCount} 输入 × 2</dd>
          <dt>哈希 A</dt><dd>${report.mission.traceHash}</dd>
          <dt>哈希 B</dt><dd>${report.mission.replayHash}</dd>
          <dt>最终结果</dt><dd>${report.mission.status} / ${report.mission.deliveryOrder.length} 交付</dd>
          <dt>任务序列</dt><dd>${deliveryLabels}</dd>
          <dt>燃料变化</dt><dd>100.00% → ${report.mission.final.fuel.toFixed(2)}%</dd>
          <dt>碰撞累计</dt><dd>0 → ${report.mission.final.collisionCount}</dd>
          <dt>任务终态</dt><dd>T+${report.mission.duration}s · 燃料 ${report.mission.final.fuel.toFixed(2)}%</dd>
        </dl>
      </article>
      <article class="audit-card ${report.mission.controlChanged ? "pass" : "fail"}">
        <div class="audit-card-top"><h3>拖带参数变化</h3><b>${report.mission.controlChanged ? "PASS" : "FAIL"}</b></div>
        <dl>
          <dt>空载质量</dt><dd>${initial.totalMass} kg</dd>
          <dt>拖带质量</dt><dd>${loaded.totalMass} kg (+${loaded.totalMass - initial.totalMass})</dd>
          <dt>惯量</dt><dd>${initial.inertia.toLocaleString("en-US")} → ${loaded.inertia.toLocaleString("en-US")}</dd>
          <dt>线加速度</dt><dd>${initial.linearAccel.toFixed(3)} → ${loaded.linearAccel.toFixed(3)}</dd>
          <dt>角加速度</dt><dd>${initial.angularAccel.toFixed(3)} → ${loaded.angularAccel.toFixed(3)}</dd>
          <dt>判定</dt><dd>质量、惯量↑ / 控制响应↓</dd>
        </dl>
      </article>
      <article class="audit-card ${report.failure.pass ? "pass" : "fail"}">
        <div class="audit-card-top"><h3>可重复失败场景</h3><b>${report.failure.pass ? "PASS" : "FAIL"}</b></div>
        <dl>
          <dt>触发原因</dt><dd>${report.failure.label ?? "—"} / ${report.failure.reason ?? "—"}</dd>
          <dt>失败时刻</dt><dd>#${failureAt?.tick ?? "—"} · T+${failureAt?.time ?? "—"}s</dd>
          <dt>触发前 tick</dt><dd>#${failureBefore?.tick ?? "—"} · active</dd>
          <dt>触发时 tick</dt><dd>#${failureAt?.tick ?? "—"} · failed</dd>
          <dt>双跑哈希</dt><dd>${report.failure.traceHash} / ${report.failure.replayHash}</dd>
          <dt>边界记录</dt><dd>前后状态均已冻结</dd>
        </dl>
      </article>
    </div>
    <div class="sequence-list">
      ${sequence.map((item) => `<span>${item}</span>`).join("")}
    </div>
    <table class="audit-table" aria-label="故障触发前后关键状态">
      <thead><tr><th>关键状态</th><th>触发前 (#${failureBefore?.tick ?? "—"})</th><th>触发时 (#${failureAt?.tick ?? "—"})</th></tr></thead>
      <tbody>
        ${auditRow("状态", failureBefore?.status ?? "—", failureAt?.status ?? "—")}
        ${auditRow("位置", failureBefore ? `${failureBefore.ship.x.toFixed(1)}, ${failureBefore.ship.y.toFixed(1)}` : "—", failureAt ? `${failureAt.ship.x.toFixed(1)}, ${failureAt.ship.y.toFixed(1)}` : "—")}
        ${auditRow("速度", failureBefore ? `${Math.hypot(failureBefore.ship.vx, failureBefore.ship.vy).toFixed(2)} m/s` : "—", failureAt ? `${Math.hypot(failureAt.ship.vx, failureAt.ship.vy).toFixed(2)} m/s` : "—")}
        ${auditRow("燃料", failureBefore ? `${failureBefore.fuel.toFixed(3)}%` : "—", failureAt ? `${failureAt.fuel.toFixed(3)}%` : "—")}
        ${auditRow("碰撞 / 交付", failureBefore ? `${failureBefore.collisionCount} / ${failureBefore.deliveredCount}` : "—", failureAt ? `${failureAt.collisionCount} / ${failureAt.deliveredCount}` : "—")}
        ${auditRow("拖带目标", failureBefore?.attachedId ?? "无", failureAt?.attachedId ?? "无")}
      </tbody>
    </table>
    <div class="audit-cards" style="grid-template-columns: 1fr 1fr;">
      <article class="audit-card ${report.recovery.pass ? "pass" : "fail"}">
        <div class="audit-card-top"><h3>恢复后固定观察 ${report.recovery.observationSeconds.toFixed(1)}s</h3><b>${report.recovery.pass ? "NO RESIDUE" : "FAIL"}</b></div>
        <dl>
          <dt>重置后 tick</dt><dd>#${report.recovery.reset.tick} / ${report.recovery.reset.status}</dd>
          <dt>观察终点</dt><dd>#${recoveryAfter.tick} / ${recoveryAfter.status}</dd>
          <dt>故障对象</dt><dd>${recoveryAfter.failureReason ?? "null"}</dd>
          <dt>资源</dt><dd>燃料 ${recoveryAfter.fuel.toFixed(2)}% · 质量 ${recoveryAfter.totalMass} kg</dd>
          <dt>残留计数</dt><dd>碰撞 ${recoveryAfter.collisionCount} · 拖曳 ${recoveryAfter.attachedId ?? "null"} · 交付 ${recoveryAfter.deliveredCount}</dd>
          <dt>碎片</dt><dd>${recoveryAfter.debris.filter((item) => item.state === "free").length}/4 free</dd>
        </dl>
      </article>
      <article class="audit-card pass">
        <div class="audit-card-top"><h3>审计约束</h3><b>VERIFIED</b></div>
        <dl>
          <dt>时间步</dt><dd>固定 1/60 s · ${report.mission.ticks.toLocaleString("en-US")} ticks</dd>
          <dt>随机源</dt><dd>xorshift32(seed=${report.seed})</dd>
          <dt>音频资源</dt><dd>审计模拟器不创建 WebAudio 节点</dd>
          <dt>渲染隔离</dt><dd>验证在无渲染模拟器中运行</dd>
          <dt>恢复观察</dt><dd>结束状态无 failure / 无持有对象</dd>
        </dl>
      </article>
    </div>
    <div class="audit-footer">
      说明：成功轨迹连续运行两次后逐 tick 比较状态与事件序列；失败轨迹先记录触发前后状态，再重置为同一种子并空控观察 600 tick（10 秒）。
      本报告不改写当前游戏状态。失败演练也可从底部按钮重复加载。
    </div>
  `;
}

async function runAudit({ open = true } = {}) {
  if (auditRunning) return;
  auditRunning = true;
  dom.auditBadge.textContent = "RUNNING";
  dom.auditBadge.classList.remove("fail");
  dom.auditSubtitle.textContent = "正在独立运行成功轨迹两次、失败轨迹两次，并执行恢复后 600 tick 观察…";
  dom.auditContent.innerHTML = `<div class="audit-footer">固定种子 0550 · 无渲染模拟器 · 请稍候</div>`;
  if (open) dom.auditDrawer.hidden = false;
  await new Promise((resolve) => window.setTimeout(resolve, 40));
  try {
    auditReport = buildAuditReport({ seed });
    renderAudit(auditReport);
    if (!open) {
      const pass = auditReport.mission.pass && auditReport.failure.pass && auditReport.recovery.pass;
      showToast(pass ? "自动审计完成 · 双跑一致 · 失败与恢复均通过" : "自动审计发现不一致", 3300);
    }
  } catch (error) {
    console.error(error);
    dom.auditBadge.textContent = "ERROR";
    dom.auditBadge.classList.add("fail");
    dom.auditContent.innerHTML = `<div class="audit-footer">审计异常：${String(error.message)}</div>`;
    dom.summaryLight.className = "summary-light fail";
    dom.summaryText.textContent = "审计异常";
  } finally {
    auditRunning = false;
  }
}

function bindControls() {
  window.addEventListener("keydown", (event) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
      event.preventDefault();
    }
    if (["KeyW", "KeyS", "KeyA", "KeyD", "KeyE", "KeyQ"].includes(event.code)
      || ["KeyP", "KeyR", "KeyV", "KeyM", "Period", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
      primeAudio();
    }
    keys.add(event.code);
    if (event.repeat) return;
    if (event.code === "KeyE") pendingCapture = true;
    if (event.code === "KeyQ") pendingRelease = true;
    if (event.code === "KeyP") togglePause();
    if (event.code === "KeyR") resetGame();
    if (event.code === "KeyV") replayCurrentSession();
    if (event.code === "KeyM") toggleAudio();
    if (event.code === "Period") singleStep();
    if (event.code === "Escape") {
      if (!dom.auditDrawer.hidden) dom.auditDrawer.hidden = true;
      else if (!dom.outcome.hidden) dom.outcome.hidden = true;
      else if (mode.current === "replay") closeReplay();
    }
  });

  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
  });

  window.addEventListener("blur", () => {
    keys.clear();
    pendingCapture = false;
    pendingRelease = false;
  });

  canvas.addEventListener("pointerdown", primeAudio);
  $("#audio-toggle").addEventListener("click", toggleAudio);
  dom.pause.addEventListener("click", togglePause);
  dom.step.addEventListener("click", singleStep);
  $("#reset-button").addEventListener("click", () => resetGame());
  $("#replay-button").addEventListener("click", replayCurrentSession);
  $("#mission-demo-button").addEventListener("click", startMissionDemo);
  $("#audit-button").addEventListener("click", () => runAudit({ open: true }));
  $("#failure-drill-button").addEventListener("click", () => {
    paused = false;
    startFailureDrill();
  });

  $("#outcome-reset").addEventListener("click", () => resetGame());
  $("#outcome-replay").addEventListener("click", () => {
    dom.outcome.hidden = true;
    replayCurrentSession();
  });
  $("#outcome-audit").addEventListener("click", () => {
    dom.outcome.hidden = true;
    runAudit({ open: true });
  });

  $("#audit-close").addEventListener("click", () => {
    dom.auditDrawer.hidden = true;
  });
  dom.auditDrawer.addEventListener("click", (event) => {
    if (event.target === dom.auditDrawer) dom.auditDrawer.hidden = true;
  });

  dom.replayPlay.addEventListener("click", togglePause);
  $("#replay-close").addEventListener("click", closeReplay);
  dom.replaySlider.addEventListener("input", (event) => {
    seekReplay(event.target.value);
  });
  $("#replay-speed").addEventListener("change", (event) => {
    if (mode.replay) mode.replay.speed = Number(event.target.value) || 4;
  });
  $("#outcome-modal").addEventListener("click", (event) => {
    if (event.target === dom.outcome) dom.outcome.hidden = true;
  });
}

function renderLoop(now) {
  const delta = Math.min(0.08, (now - lastFrame) / 1000);
  lastFrame = now;

  if (mode.current === "replay" && mode.replay) {
    advanceReplay(delta);
    const replaySim = mode.replay.sim;
    const state = replaySim.state;
    const bands = replaySim.getBands();
    const danger = renderer.isInTraffic(state, bands)
      || distance(state.ship, NO_GO) < NO_GO.radius + 74;
    renderer.render(replaySim, {
      status: state.status,
      paused: !mode.replay.playing && state.status === "active",
      replay: true,
      replayLabel: mode.replay.label,
      danger,
    });
    const nearest = renderer.nearestFreeDebris(state);
    audio.update({
      thrust: mode.replay.playing ? state.controls.thrust : 0,
      towing: Boolean(state.attachedId),
      danger,
      wind: state.wind.strength,
      targetNear: Boolean(nearest && nearest.gap < 92),
      status: state.status,
    });
    updateReplayHud();
  } else {
    const state = sim.state;
    if (!paused && state.status === "active") {
      accumulator += delta;
      let steps = 0;
      while (accumulator >= FIXED_DT && steps < 6 && sim.state.status === "active") {
        stepLive();
        accumulator -= FIXED_DT;
        steps += 1;
      }
      if (steps === 6) accumulator = 0;
    }
    const bands = sim.getBands();
    const danger = renderer.isInTraffic(state, bands)
      || distance(state.ship, NO_GO) < NO_GO.radius + 74;
    renderer.render(sim, { status: state.status, paused, danger });
    const nearest = renderer.nearestFreeDebris(state);
    audio.update({
      thrust: paused ? 0 : state.controls.thrust,
      towing: Boolean(state.attachedId),
      danger,
      wind: state.wind.strength,
      targetNear: Boolean(nearest && nearest.gap < 92),
      status: state.status,
    });
    updateHud(state, { sim });
  }

  requestAnimationFrame(renderLoop);
}

function initialize() {
  buildCargoList();
  resetEventCursor(sim);
  updateHud(sim.state, { sim });
  bindControls();
  requestAnimationFrame((now) => {
    lastFrame = now;
    renderLoop(now);
  });
  window.setTimeout(() => runAudit({ open: false }), 900);
}

initialize();
