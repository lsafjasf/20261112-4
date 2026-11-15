import {
  CLEAR_THRESHOLD,
  DEVICE_SPECS,
  FLOCKS,
  SCENARIOS,
  ZONE_NAMES,
  configureDevice,
  createGame,
  deviceConsumption,
  executeStep,
  getWind,
  queueMove,
  restoreGame,
  serializeGame,
  setLights,
} from "./core.js";
import { CoastRenderer } from "./renderer.js";
import { CoastAudio } from "./audio.js";
import { runVerification } from "./verification.js";

const RUN_STORAGE_KEY = "coastwatch.run.v1";
const VERIFY_STORAGE_KEY = "coastwatch.verification.v1";
const AUTO_STEP_MS = 1550;

const byId = (id) => document.getElementById(id);
const elements = {
  deviceList: byId("deviceList"),
  scenarioSelect: byId("scenarioSelect"),
  scenarioTitle: byId("scenarioTitle"),
  scenarioCode: byId("scenarioCode"),
  scenarioDescription: byId("scenarioDescription"),
  seedValue: byId("seedValue"),
  tickNow: byId("tickNow"),
  tickTotal: byId("tickTotal"),
  missionStatus: byId("missionStatus"),
  missionLiveDot: byId("missionLiveDot"),
  windNow: byId("windNow"),
  disturbNow: byId("disturbNow"),
  goalNow: byId("goalNow"),
  windMap: byId("windMap"),
  nextWind: byId("nextWind"),
  focusLabel: byId("focusLabel"),
  mapHint: byId("mapHint"),
  recGoal: byId("recGoal"),
  trackGoal: byId("trackGoal"),
  disturbGoal: byId("disturbGoal"),
  recoveryGoal: byId("recoveryGoal"),
  recoveryGoalBlock: byId("recoveryGoalBlock"),
  recBar: byId("recBar"),
  trackBar: byId("trackBar"),
  disturbBar: byId("disturbBar"),
  recoveryBar: byId("recoveryBar"),
  timelineText: byId("timelineText"),
  timelineTrack: byId("timelineTrack"),
  qualityPill: byId("qualityPill"),
  qualityScore: byId("qualityScore"),
  qualityTitle: byId("qualityTitle"),
  qualitySubtitle: byId("qualitySubtitle"),
  checkList: byId("checkList"),
  recordingGrid: byId("recordingGrid"),
  trackCard: byId("trackCard"),
  retakeCard: byId("retakeCard"),
  eventCount: byId("eventCount"),
  eventLog: byId("eventLog"),
  clearEventFilter: byId("clearEventFilter"),
  verifyResults: byId("verifyResults"),
  evidenceJson: byId("evidenceJson"),
  runVerificationBtn: byId("runVerificationBtn"),
  pauseBtn: byId("pauseBtn"),
  runBtn: byId("runBtn"),
  stepBtn: byId("stepBtn"),
  resetBtn: byId("resetBtn"),
  loadScenarioBtn: byId("loadScenarioBtn"),
  lightsBtn: byId("lightsBtn"),
  lightsBtnText: byId("lightsBtnText"),
  lightsTitle: byId("lightsTitle"),
  lightState: byId("lightState"),
  audioBtn: byId("audioBtn"),
  saveState: byId("saveState"),
  toast: byId("toast"),
  screenReaderStatus: byId("screenReaderStatus"),
};

function loadRun() {
  try {
    const saved = localStorage.getItem(RUN_STORAGE_KEY);
    if (!saved) return null;
    const restored = restoreGame(saved);
    return restored;
  } catch (error) {
    console.warn("无法恢复监测状态", error);
    return null;
  }
}

let state = loadRun() ?? createGame({ scenarioId: "calm", seed: 20261112 });
state.paused = true;
let selectedDevice = "R1";
let autoTimer = null;
let toastTimer = null;
let showAllEvents = false;
let verificationRunning = false;

const audio = new CoastAudio();
const renderer = new CoastRenderer(byId("coastCanvas"), {
  getState: () => state,
  getSelected: () => selectedDevice,
  onDeviceClick: (deviceId) => selectDevice(deviceId),
  onZoneClick: (zone) => moveSelectedDevice(zone),
});

Object.defineProperty(window, "__coastwatchDebug", {
  value: {
    snapshot: () => ({
      tick: state.tick,
      scenarioId: state.scenarioId,
      status: state.status,
      outcome: state.outcome,
      faultActive: state.fault.active,
      faultStatus: state.fault.status,
      pendingRetakes: state.retakeQueue.length,
      autoTimerActive: autoTimer !== null,
      disturbanceCount: state.disturbanceCount,
      recoveryObservation: {
        completed: state.recoveryObservation.completed,
        required: state.recoveryObservation.required,
        passed: state.recoveryObservation.passed,
      },
      audio: audio.resourceCount(),
    }),
  },
  writable: false,
});

function persistState() {
  try {
    state.paused = autoTimer === null;
    localStorage.setItem(RUN_STORAGE_KEY, serializeGame(state));
    const time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    elements.saveState.innerHTML = `<i></i>设备状态已保存 ${time}`;
  } catch (error) {
    elements.saveState.innerHTML = "<i></i>保存失败";
    console.warn("设备状态保存失败", error);
  }
}

function toast(message, type = "info", duration = 2800) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast visible ${type}`;
  elements.screenReaderStatus.textContent = message;
  toastTimer = setTimeout(() => {
    elements.toast.className = "toast";
  }, duration);
}

function deviceStatusLabel(device) {
  if (device.status === "offline") return "电量耗尽";
  if (device.status === "low-power") return "低电量";
  if (device.settling) return "移动沉降";
  if (device.queuedZone !== null) return "待移动";
  return "在线";
}

function deviceStatusClass(device) {
  if (device.status === "offline" || device.status === "low-power") return "offline";
  if (device.settling) return "settling";
  if (device.queuedZone !== null) return "moving";
  return "ready";
}

function renderDeviceCard(device) {
  const selected = selectedDevice === device.id;
  const batteryClass = device.battery < 25 ? "low" : "";
  const zones = ZONE_NAMES.map((name, zone) => {
    const current = device.zone === zone;
    const queued = device.queuedZone === zone;
    return `<button type="button" data-zone="${zone}" class="${current ? "current" : ""} ${
      queued ? "queued" : ""
    }" ${current ? "aria-current=\"true\"" : ""}>${name}</button>`;
  }).join("");
  return `
    <article class="device-card ${selected ? "selected" : ""}" data-device="${device.id}" data-kind="${device.kind}">
      <div class="device-top">
        <span class="device-glyph">${device.kind === "drone" ? "UAV" : device.id}</span>
        <div class="device-name">
          <strong>${device.label}</strong>
          <small>${device.kind === "drone" ? "AERIAL TRACK" : "AUTO RECORDER"}</small>
        </div>
        <span class="battery">
          <span class="battery-bar"><i class="${batteryClass}" style="width:${device.battery}%"></i></span>
          <b>${device.battery.toFixed(0)}%</b>
        </span>
      </div>
      <div class="device-status-row">
        <span class="status-chip ${deviceStatusClass(device)}">${deviceStatusLabel(device)}</span>
        <span class="device-zone">${ZONE_NAMES[device.zone]} · ${deviceConsumption(device)}%/段</span>
      </div>
      <div class="device-settings">
        <div class="setting-line">
          <label for="${device.id}-power">功率</label>
          <input id="${device.id}-power" data-power="${device.id}" type="range" min="20" max="100" step="5" value="${device.power}" />
          <span class="setting-value" id="${device.id}-power-value">${device.power}%</span>
        </div>
        <div class="frequency-buttons" aria-label="${device.id} 采集频次">
          ${[1, 2, 3]
            .map(
              (frequency) =>
                `<button type="button" data-frequency="${frequency}" class="${
                  device.frequency === frequency ? "active" : ""
                }" aria-label="${device.id} 频次 ${frequency}">${frequency}×</button>`,
            )
            .join("")}
        </div>
        <div class="move-zones" aria-label="${device.id} 移动落点">${zones}</div>
      </div>
    </article>
  `;
}

function renderDevices() {
  const previousFocus = document.activeElement?.id;
  elements.deviceList.innerHTML = Object.values(state.devices).map(renderDeviceCard).join("");
  if (previousFocus?.startsWith("R") || previousFocus?.startsWith("D1")) {
    const focusTarget = byId(previousFocus);
    if (focusTarget) focusTarget.focus({ preventScroll: true });
  }
}

function isMissionComplete() {
  return state.status === "completed";
}

function renderHud() {
  const recordings = Object.values(state.flocks).filter((flock) => flock.clear).length;
  const trackCount = Object.keys(state.tracks.valid).length;
  const goalCount = recordings + trackCount;
  const autoRunning = autoTimer !== null && !isMissionComplete();
  elements.tickNow.textContent = state.tick;
  elements.tickTotal.textContent = state.totalTicks;
  elements.windNow.textContent = `${state.wind} 级`;
  elements.disturbNow.textContent = state.disturbanceCount;
  elements.goalNow.textContent = `${goalCount} / 5`;
  elements.windMap.innerHTML = `${state.wind}<small>级</small>`;
  elements.nextWind.textContent = isMissionComplete() ? "已结束" : `${getWind(state)} 级`;
  elements.focusLabel.textContent = `${selectedDevice} · ${ZONE_NAMES[state.devices[selectedDevice].zone]}`;
  elements.mapHint.textContent =
    state.devices[selectedDevice].queuedZone === null
      ? `点击海岸落点移动 ${selectedDevice}`
      : `${selectedDevice} 将于下一段移至 ${ZONE_NAMES[state.devices[selectedDevice].queuedZone]}`;

  if (isMissionComplete()) {
    elements.missionStatus.textContent =
      state.outcome === "success" ? "任务成功 · 已结束" : "任务失败 · 已结束";
  } else if (autoRunning) {
    elements.missionStatus.textContent = `连续监测 · ${state.scenarioCode}`;
  } else if (state.tick === 0) {
    elements.missionStatus.textContent = `待规划 · ${state.scenarioCode}`;
  } else {
    elements.missionStatus.textContent = `已暂停 · 第 ${state.tick} 段后`;
  }
  elements.missionLiveDot.className = `live-dot ${autoRunning ? "" : "paused"}`;

  elements.recGoal.textContent = recordings;
  elements.trackGoal.textContent = trackCount;
  elements.disturbGoal.textContent = state.disturbanceCount === 0 ? "保持" : `${state.disturbanceCount} 次`;
  elements.recBar.style.width = `${(recordings / 3) * 100}%`;
  elements.trackBar.style.width = `${(trackCount / 2) * 100}%`;
  elements.disturbBar.style.width = state.disturbanceCount === 0 ? "100%" : "100%";
  elements.disturbBar.style.background = state.disturbanceCount === 0 ? "var(--mint)" : "var(--coral)";
  elements.disturbGoal.closest(".goal-block").classList.toggle("failed", state.disturbanceCount > 0);
  elements.disturbGoal.closest(".goal-block").classList.toggle("complete", state.disturbanceCount === 0);
  elements.recGoal.closest(".goal-block").classList.toggle("complete", recordings >= 3);
  elements.trackGoal.closest(".goal-block").classList.toggle("complete", trackCount >= 2);

  const observation = state.recoveryObservation;
  elements.recoveryGoalBlock.classList.toggle("active", observation.active || observation.passed);
  if (observation.passed) {
    elements.recoveryGoal.textContent = `${observation.completed} / ${observation.required} 通过`;
    elements.recoveryBar.style.width = "100%";
  } else if (observation.active) {
    elements.recoveryGoal.textContent = `${observation.completed} / ${observation.required}`;
    elements.recoveryBar.style.width = `${(observation.completed / observation.required) * 100}%`;
  } else if (state.fault.triggeredAt !== null) {
    elements.recoveryGoal.textContent = "等待重采";
    elements.recoveryBar.style.width = "0%";
  } else {
    elements.recoveryGoal.textContent = "待触发";
    elements.recoveryBar.style.width = "0%";
  }

  elements.timelineText.textContent = isMissionComplete()
    ? `已完成 ${state.tick} 段`
    : state.tick === 0
      ? "规划第 1 段"
      : `已完成 ${state.tick} 段 · 规划第 ${state.tick + 1} 段`;
  elements.timelineTrack.innerHTML = Array.from({ length: state.totalTicks }, (_, index) => {
    const tick = index + 1;
    const classes = [];
    if (tick <= state.tick) classes.push("done");
    if (tick === state.tick + 1 && !isMissionComplete()) classes.push("current");
    if (state.fault.triggeredAt === tick) classes.push("fault");
    return `<i class="${classes.join(" ")}" title="第 ${tick} 段"></i>`;
  }).join("");

  const paused = autoTimer === null;
  elements.pauseBtn.setAttribute("aria-pressed", String(paused));
  elements.pauseBtn.innerHTML = isMissionComplete()
    ? '<span aria-hidden="true">■</span> 已结束'
    : paused
      ? '<span aria-hidden="true">▶</span> 继续'
      : '<span aria-hidden="true">Ⅱ</span> 暂停';
  elements.pauseBtn.disabled = isMissionComplete();
  elements.stepBtn.disabled = isMissionComplete();
  elements.runBtn.disabled = isMissionComplete();

  elements.lightsBtn.setAttribute("aria-pressed", String(state.lightsOn));
  elements.lightsBtnText.textContent = state.lightsOn ? "立即关闭" : "保持关闭";
  elements.lightsTitle.textContent = state.lightsOn ? "航标灯开启" : "航标灯关闭";
  elements.lightState.textContent = state.lightsOn ? "LIGHT ON" : "DARK";
  elements.lightState.className = `light-state ${state.lightsOn ? "on" : ""}`;
}

function latestQualityEvent() {
  const reversed = [...state.events].reverse();
  if (state.status === "completed" && state.outcome === "success") {
    return reversed.find(
      (event) =>
        ["RECORDING_CLEAR", "TRACK_VALID"].includes(event.type) && event.data?.checks,
    );
  }
  return reversed.find(
    (event) =>
      ["RECORDING_CLEAR", "QUALITY_REJECTED", "TRACK_VALID", "TRACK_REJECTED"].includes(event.type) &&
      event.data?.checks,
  );
}

function renderQuality() {
  const latest = latestQualityEvent();
  const checks = latest?.data?.checks ?? [];
  const quality = latest?.data?.quality ?? null;
  const clear = latest?.type === "RECORDING_CLEAR" || latest?.type === "TRACK_VALID";
  elements.qualityPill.textContent = latest
    ? clear
      ? "CLEAR / 通过"
      : "REJECTED / 重采"
    : "等待采样";
  elements.qualityPill.className = `quality-pill ${latest ? (clear ? "clear" : "rejected") : ""}`;
  elements.qualityScore.textContent = quality === null ? "--" : quality.toFixed(1);
  const progressDegrees = quality === null ? 0 : Math.max(0, Math.min(360, (quality / 100) * 360));
  elements.qualityScore.parentElement.style.background = `radial-gradient(circle, rgba(84, 231, 195, 0.08), transparent 65%), conic-gradient(${
    clear ? "var(--mint)" : "var(--coral)"
  } ${progressDegrees}deg, rgba(84, 231, 195, 0.08) ${progressDegrees}deg)`;
  if (state.status === "completed" && state.outcome === "success") {
    elements.qualityTitle.textContent = "三群录音与有效航迹均通过";
    elements.qualitySubtitle.textContent = "任务完成，最终质检无未决项或残留重采。";
  } else if (!latest) {
    elements.qualityTitle.textContent = "等待第一段录音";
    elements.qualitySubtitle.textContent = "每段自动检查风噪、信噪比与移动沉降。";
  } else if (clear) {
    elements.qualityTitle.textContent =
      latest.type === "TRACK_VALID" ? "航迹质检通过" : "录音清晰度达标";
    elements.qualitySubtitle.textContent = latest.message;
  } else {
    elements.qualityTitle.textContent = "样本被质检拒绝";
    elements.qualitySubtitle.textContent = latest.message;
  }

  if (checks.length === 0) {
    elements.checkList.innerHTML = `
      <div class="check-row"><span><i>·</i> 风噪</span><b>--</b></div>
      <div class="check-row"><span><i>·</i> 信噪比</span><b>≥ ${CLEAR_THRESHOLD} dB</b></div>
      <div class="check-row"><span><i>·</i> 移动沉降</span><b>--</b></div>`;
  } else {
    elements.checkList.innerHTML = checks
      .map(
        (check) => `
          <div class="check-row ${check.passed ? "" : "rejected"}">
            <span><i>${check.passed ? "✓" : "!"}</i> ${check.label}</span>
            <b>${check.value}</b>
          </div>`,
      )
      .join("");
  }

  elements.recordingGrid.innerHTML = FLOCKS.map((spec) => {
    const flock = state.flocks[spec.id];
    const status = flock.clear ? "clear" : flock.lastStatus === "rejected" ? "rejected" : "";
    const value = flock.clear
      ? `✓ ${flock.lastQuality?.toFixed(1) ?? "--"} dB`
      : flock.lastQuality !== null
        ? `${flock.lastQuality.toFixed(1)} dB`
        : "待覆盖";
    const progress = flock.clear ? 100 : Math.max(0, Math.min(100, flock.lastQuality ?? 0));
    return `
      <div class="recording-row ${status}">
        <div><span class="flock-dot" style="background:${spec.color}"></span><strong>${flock.name}</strong><small>${
          flock.clear ? `第 ${flock.clearAt} 段收录` : `${flock.attempts} 次尝试`
        }</small></div>
        <span class="sample-value">${value}</span>
        <span class="recording-progress"><i style="width:${progress}%;background:${
          flock.lastStatus === "rejected" && !flock.clear ? "var(--coral)" : "var(--mint)"
        }"></i></span>
      </div>`;
  }).join("");

  const trackCount = Object.keys(state.tracks.valid).length;
  elements.trackCard.innerHTML = `
    <div class="card-top">
      <strong>航拍轨迹 · ${trackCount}/2</strong>
      <span class="sample-value">${
        state.tracks.lastQuality === null ? "--" : `${state.tracks.lastQuality.toFixed(1)} dB`
      }</span>
    </div>
    <div class="track-pips">
      <i class="${trackCount >= 1 ? "valid" : ""}"></i>
      <i class="${trackCount >= 2 ? "valid" : ""}"></i>
    </div>`;

  const pending = state.retakeQueue.length;
  elements.retakeCard.className = `retake-card ${pending > 0 ? "has-work" : "empty"}`;
  if (pending > 0) {
    const names = state.retakeQueue
      .map((item) => state.flocks[item.flockId]?.name ?? item.flockId)
      .join("、");
    elements.retakeCard.innerHTML = `
      <div class="card-top"><strong>重采队列 · ${pending}</strong><span class="sample-value">ACTIVE</span></div>
      <p>${names} 因 ${state.retakeQueue[0]?.issues?.join("、") || "质量不足"} 等待下一段重采。</p>`;
  } else if (state.fault.triggeredAt !== null) {
    elements.retakeCard.innerHTML = `
      <div class="card-top"><strong>重采队列 · 0</strong><span class="sample-value">CLEARED</span></div>
      <p>污染样本已全部重采，故障于第 ${state.fault.recoveredAt} 段解除。</p>`;
  } else {
    elements.retakeCard.innerHTML = `
      <div class="card-top"><strong>重采队列 · 0</strong><span class="sample-value">IDLE</span></div>
      <p>尚无被污染样本。</p>`;
  }
}

const EVENT_META = {
  FAULT_ARMED: ["warn", "FAULT ARMED"],
  FAULT_TRIGGERED: ["error", "FAULT"],
  FAULT_RECOVERED: ["good", "RECOVERED"],
  QUALITY_REJECTED: ["error", "QC REJECT"],
  RECORDING_CLEAR: ["good", "RECORDING"],
  TRACK_VALID: ["good", "TRACK"],
  TRACK_REJECTED: ["warn", "TRACK REJECT"],
  DEVICE_MOVED: ["warn", "MOVE"],
  DEVICE_OFFLINE: ["error", "POWER"],
  MOVE_REJECTED: ["error", "MOVE FAIL"],
  DISTURBANCE: ["error", "DISTURB"],
  OBSERVATION_TICK: ["good", "OBSERVE"],
  OBSERVATION_PASSED: ["good", "OBSERVE PASS"],
  OBSERVATION_FAILED: ["error", "OBSERVE FAIL"],
  MISSION_SUCCESS: ["good", "SUCCESS"],
  MISSION_FAILURE: ["error", "FAILURE"],
};

const KEY_EVENT_TYPES = new Set(Object.keys(EVENT_META));

function renderEvents() {
  elements.eventCount.textContent = state.events.length;
  const events = showAllEvents
    ? state.events
    : state.events.filter((event) => KEY_EVENT_TYPES.has(event.type));
  elements.eventLog.innerHTML = events
    .slice(-80)
    .map((event) => {
      const [tone, label] = EVENT_META[event.type] ?? ["", event.type];
      return `
        <li class="event-item ${tone}">
          <div class="event-meta"><span>T+${String(event.tick).padStart(2, "0")}</span><span class="event-type">${label}</span><span>#${event.seq}</span></div>
          <p class="event-message">${event.message}</p>
        </li>`;
    })
    .join("");
  const activeTab = document.querySelector(".tab-btn.active")?.dataset.tab;
  if (activeTab === "events") elements.eventLog.parentElement.scrollTop = elements.eventLog.parentElement.scrollHeight;
  elements.clearEventFilter.textContent = showAllEvents ? "仅关键" : "全部";
}

function proofSection(title, passed, detail, badge) {
  return `
    <section class="proof-section ${passed ? "pass" : "fail"}">
      <div class="proof-title"><strong>${title}</strong><span class="proof-badge ${passed ? "" : "fail"}">${
        badge ?? (passed ? "PASS" : "FAIL")
      }</span></div>
      <p class="proof-detail">${detail}</p>
    </section>`;
}

function renderVerification(evidence) {
  if (!evidence) {
    elements.verifyResults.innerHTML =
      '<div class="empty-proof">尚未运行。验收不会改变当前手动监测状态。</div>';
    elements.evidenceJson.textContent = "等待生成";
    return;
  }
  const runA = evidence.runs.successA;
  const runB = evidence.runs.successB;
  const failure = evidence.runs.failure;
  const matchDetail = Object.entries(evidence.match)
    .map(([key, value]) => `${key}: <b>${value ? "一致" : "不一致"}</b>`)
    .join(" · ");
  const retakes = runA.noise.retakeEvents
    .map((event) => `T+${String(event.tick).padStart(2, "0")} ${event.message}`)
    .join("<br>");
  const beforeBattery = failure.fault.before?.devices
    ? Object.values(failure.fault.before.devices)
        .map((device) => `${device.battery.toFixed(1)}%`)
        .join(" / ")
    : "--";
  const afterBattery = failure.fault.after?.devices
    ? Object.values(failure.fault.after.devices)
        .map((device) => `${device.battery.toFixed(1)}%`)
        .join(" / ")
    : "--";
  const observations = runA.observation.records
    .map(
      (record) =>
        `T+${record.tick}: 重采 ${record.pendingRetakes} · 故障 ${
          record.faultActive ? "活动" : "0"
        } · 错误 ${record.errorEvents}`,
    )
    .join("<br>");

  elements.verifyResults.innerHTML = [
    proofSection(
      "同输入连续运行 ×2",
      evidence.checks.deterministic,
      `两次均 ${runA.summary.ticks} 段、结果 <b>${runA.summary.outcome}</b>。${matchDetail}`,
    ),
    proofSection(
      "噪声 → 质检拒绝 → 重采",
      evidence.checks.noiseRetake,
      `风噪拒绝 <b>${runA.noise.windRejectedCount}</b> 次；故障 T+${runA.fault.triggeredAt} 触发，重采完成：<br>${retakes}`,
    ),
    proofSection(
      "可重复失败场景",
      evidence.checks.repeatableFailure,
      `GUST-01 无干预最终 <b>${failure.summary.outcome}</b>，共 ${failure.summary.ticks} 段。故障前电池 ${beforeBattery} → 故障后 ${afterBattery}；快照与事件已留存。`,
    ),
    proofSection(
      "恢复后固定观察",
      evidence.checks.recoveryClean,
      `T+${runA.observation.startTick} 故障解除，随后连续观察 <b>${runA.observation.completed}/${runA.observation.required}</b> 段：<br>${observations}<br>残留标记 <b>${
        runA.observation.residualErrorFlags.length
      }</b>。`,
    ),
    proofSection(
      "成功路径",
      evidence.checks.successPath,
      `第 ${runA.summary.ticks} 段完成 3 群录音、${runA.summary.tracks.length} 条航迹，惊扰 ${runA.summary.disturbanceCount} 次。`,
    ),
  ].join("");
  elements.evidenceJson.textContent = JSON.stringify(
    {
      generatedAt: evidence.generatedAt,
      input: evidence.input,
      checks: evidence.checks,
      match: evidence.match,
      successRun: {
        summary: runA.summary,
        fault: runA.fault,
        noise: runA.noise,
        observation: {
          ...runA.observation,
          records: runA.observation.records,
        },
        digest: runA.digest,
      },
      repeatRunSummary: runB.summary,
      failureRun: {
        summary: failure.summary,
        fault: failure.fault,
        noise: failure.noise,
        digest: failure.digest,
      },
    },
    null,
    2,
  );
}

function renderScenario() {
  const scenario = SCENARIOS[state.scenarioId];
  elements.scenarioTitle.textContent = scenario.name;
  elements.scenarioCode.textContent = scenario.code;
  elements.scenarioDescription.textContent = scenario.description;
  elements.seedValue.textContent = state.seed;
  elements.scenarioSelect.value = state.scenarioId;
}

function renderAll() {
  renderScenario();
  renderHud();
  renderDevices();
  renderQuality();
  renderEvents();
  audio.update({
    wind: state.wind,
    lightsOn: state.lightsOn,
    paused: autoTimer === null || isMissionComplete(),
  });
}

function playEventAudio(events) {
  for (const event of events) {
    if (event.type === "QUALITY_REJECTED") {
      audio.playRejected();
    }
    if (event.type === "RECORDING_CLEAR" || event.type === "TRACK_VALID") {
      const spec = FLOCKS.find((flock) => flock.id === event.data?.flockId);
      audio.playBirdCall(spec?.call ?? "oystercatcher", {
        quality: event.data?.quality,
      });
    }
  }
}

function applyState(nextState, { play = true } = {}) {
  const previousSeq = state.eventSeq;
  state = nextState;
  if (state.status === "completed") {
    clearInterval(autoTimer);
    autoTimer = null;
    state.paused = true;
    audio.stopVoiceActivity();
    if (state.outcome === "success") {
      setTimeout(() => toast("监测成功：三群清晰录音、两条有效航迹、零惊扰。", "info", 4200), 120);
    } else {
      setTimeout(() => toast("监测失败：查看质检与事件流中的未达标项。", "error", 4200), 120);
    }
  }
  if (play) {
    playEventAudio(state.events.filter((event) => event.seq > previousSeq));
  }
  renderAll();
  persistState();
}

function clearAutoTimer() {
  clearInterval(autoTimer);
  autoTimer = null;
}

function advanceOneStep() {
  if (isMissionComplete()) return;
  const next = executeStep(state);
  applyState(next);
}

function startAuto() {
  if (isMissionComplete()) return;
  clearAutoTimer();
  state.paused = false;
  autoTimer = setInterval(() => {
    if (isMissionComplete()) {
      clearAutoTimer();
      renderAll();
      return;
    }
    advanceOneStep();
    if (isMissionComplete()) {
      clearAutoTimer();
      renderAll();
      persistState();
    }
  }, AUTO_STEP_MS);
  advanceOneStep();
  if (!isMissionComplete()) {
    renderAll();
    persistState();
  }
}

function pauseAuto() {
  clearAutoTimer();
  state.paused = true;
  renderAll();
  persistState();
}

function stepOnce() {
  pauseAuto();
  advanceOneStep();
}

function resetGame(scenarioId = state.scenarioId) {
  clearAutoTimer();
  audio.stopVoiceActivity();
  state = createGame({ scenarioId, seed: 20261112 });
  state.paused = true;
  selectedDevice = "R1";
  renderAll();
  persistState();
  toast(
    scenarioId === "gust"
      ? "已载入 GUST-01 侧风故障场景；相同操作可重复触发第 2 段污染。"
      : "监测已重置为平稳夜航。",
    "info",
    3400,
  );
}

function selectDevice(deviceId) {
  if (!state.devices[deviceId]) return;
  selectedDevice = deviceId;
  renderHud();
  renderDevices();
}

function moveSelectedDevice(zone) {
  if (isMissionComplete()) {
    toast("任务已结束，请重置后再调度设备。", "error");
    return;
  }
  const device = state.devices[selectedDevice];
  state = queueMove(state, selectedDevice, zone);
  renderAll();
  persistState();
  const next = state.devices[selectedDevice];
  if (next.queuedZone === null) {
    toast(`${selectedDevice} 保持原位，不产生移动沉降。`);
  } else {
    toast(
      `${selectedDevice} 已排队移至${ZONE_NAMES[next.queuedZone]}；下一段将处于移动沉降。`,
      "info",
      3200,
    );
  }
}

function setScenarioDisplay(scenarioId) {
  const scenario = SCENARIOS[scenarioId];
  elements.scenarioTitle.textContent = scenario.name;
  elements.scenarioCode.textContent = scenario.code;
  elements.scenarioDescription.textContent = scenario.description;
  elements.loadScenarioBtn.textContent = "载入并重置";
  elements.loadScenarioBtn.dataset.scenario = scenarioId;
}

elements.deviceList.addEventListener("click", (event) => {
  const card = event.target.closest(".device-card");
  if (!card) return;
  const deviceId = card.dataset.device;
  const frequencyButton = event.target.closest("[data-frequency]");
  const zoneButton = event.target.closest("[data-zone]");
  if (frequencyButton) {
    state = configureDevice(state, deviceId, {
      frequency: Number(frequencyButton.dataset.frequency),
    });
    selectedDevice = deviceId;
    renderAll();
    persistState();
    return;
  }
  if (zoneButton) {
    selectedDevice = deviceId;
    moveSelectedDevice(Number(zoneButton.dataset.zone));
    return;
  }
  selectDevice(deviceId);
});

elements.deviceList.addEventListener("input", (event) => {
  const powerInput = event.target.closest("[data-power]");
  if (!powerInput) return;
  const deviceId = powerInput.dataset.power;
  state = configureDevice(state, deviceId, { power: Number(powerInput.value) });
  byId(`${deviceId}-power-value`).textContent = `${state.devices[deviceId].power}%`;
});

elements.deviceList.addEventListener("change", (event) => {
  const powerInput = event.target.closest("[data-power]");
  if (!powerInput) return;
  renderAll();
  persistState();
});

elements.scenarioSelect.addEventListener("change", () => {
  setScenarioDisplay(elements.scenarioSelect.value);
});

elements.loadScenarioBtn.addEventListener("click", () => {
  resetGame(elements.scenarioSelect.value);
});

elements.lightsBtn.addEventListener("click", () => {
  if (isMissionComplete()) {
    toast("任务已结束，请重置后再操作岸站照明。", "error");
    return;
  }
  state = setLights(state, !state.lightsOn);
  renderAll();
  persistState();
  toast(
    state.lightsOn
      ? "航标灯已开启：鸟群将改变航线，并在下一段计入惊扰。"
      : "航标灯已关闭：鸟群将回到自然迁徙航线。",
    state.lightsOn ? "error" : "info",
    3600,
  );
});

elements.pauseBtn.addEventListener("click", () => {
  if (isMissionComplete()) return;
  if (autoTimer !== null) {
    pauseAuto();
    toast("已暂停：自动步骤与声场进入暂停状态。");
  } else {
    startAuto();
  }
});

elements.runBtn.addEventListener("click", () => {
  startAuto();
});

elements.stepBtn.addEventListener("click", () => {
  stepOnce();
});

elements.resetBtn.addEventListener("click", () => {
  resetGame(state.scenarioId);
});

elements.audioBtn.addEventListener("click", async () => {
  try {
    if (audio.enabled) {
      await audio.disable();
      elements.audioBtn.setAttribute("aria-pressed", "false");
      elements.audioBtn.innerHTML = '<span class="wave-icon" aria-hidden="true">≋</span> 开启声场';
      toast("声场已关闭，环境音频资源暂停。");
    } else {
      await audio.enable();
      audio.update({
        wind: state.wind,
        lightsOn: state.lightsOn,
        paused: autoTimer === null || isMissionComplete(),
      });
      elements.audioBtn.setAttribute("aria-pressed", "true");
      elements.audioBtn.innerHTML = '<span class="wave-icon" aria-hidden="true">≋</span> 声场开启';
      toast("声场已开启：海风、岸灯与三种鸟鸣均由 Web Audio 实时合成。");
    }
  } catch (error) {
    console.error(error);
    toast("浏览器未能启动 Web Audio，请检查自动播放权限。", "error");
  }
});

document.querySelectorAll(".tab-btn").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    byId(`${button.dataset.tab}Tab`)?.classList.add("active");
    if (button.dataset.tab === "events") {
      elements.eventLog.parentElement.scrollTop = elements.eventLog.parentElement.scrollHeight;
    }
  });
});

elements.clearEventFilter.addEventListener("click", () => {
  showAllEvents = !showAllEvents;
  renderEvents();
});

function loadStoredVerification() {
  try {
    const saved = localStorage.getItem(VERIFY_STORAGE_KEY);
    if (!saved) return null;
    return JSON.parse(saved);
  } catch {
    return null;
  }
}

elements.runVerificationBtn.addEventListener("click", () => {
  if (verificationRunning) return;
  verificationRunning = true;
  elements.runVerificationBtn.disabled = true;
  elements.runVerificationBtn.textContent = "运行中…";
  elements.verifyResults.innerHTML =
    '<div class="empty-proof">正在重复运行固定输入并核对故障、重采与恢复观察…</div>';
  setTimeout(() => {
    try {
      const evidence = runVerification();
      renderVerification(evidence);
      localStorage.setItem(VERIFY_STORAGE_KEY, JSON.stringify(evidence));
      toast(
        evidence.allPassed
          ? "验收通过：双跑一致、噪声重采、失败场景与恢复观察均有证据。"
          : "验收存在未通过项，请查看详细证据。",
        evidence.allPassed ? "info" : "error",
        4200,
      );
    } catch (error) {
      console.error(error);
      elements.verifyResults.innerHTML = `<div class="empty-proof">验收执行失败：${error.message}</div>`;
      toast("验收执行失败。", "error");
    } finally {
      verificationRunning = false;
      elements.runVerificationBtn.disabled = false;
      elements.runVerificationBtn.textContent = "重新运行验收";
    }
  }, 60);
});

window.addEventListener("beforeunload", () => {
  persistState();
  audio.dispose();
});

renderAll();
renderVerification(loadStoredVerification());
persistState();
if (state.tick > 0) {
  toast(`已从本地恢复 ${state.scenarioCode} 第 ${state.tick} 段设备状态。`, "info", 3600);
}
