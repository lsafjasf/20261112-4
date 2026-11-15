import {
  DEFAULT_INPUT,
  FILTERS,
  MISSION_END,
  ObservatorySimulation,
  SCENARIOS,
  TARGETS,
  altitudeAt,
  clone,
  compareRuns,
  formatClock,
  runSchedule,
  temperatureAt,
  windAt,
} from "./simulation.js";
import { ObservatoryAudio } from "./audio.js";
import { SceneRenderer } from "./scene.js";

const $ = (id) => document.getElementById(id);
const speed = 4;
const tick = 0.1;

let plan = clone(DEFAULT_INPUT);
let revision = 1;
let simulation = new ObservatorySimulation(plan);
let scene = new SceneRenderer($("sceneCanvas"));
const audio = new ObservatoryAudio();
let audioUserMuted = false;
let accumulator = 0;
let lastFrame = performance.now();
let lastLogId = -1;
let lastTaskId = null;
let lastPhase = simulation.phase;
let latestFault = null;
let timelineBlocks = [];

function safe(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[char];
  });
}

function pct(value) {
  return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
}

function preciseClock(seconds) {
  const safeSeconds = Math.max(0, seconds);
  const mins = Math.floor(safeSeconds / 60);
  const secs = Math.floor(safeSeconds % 60);
  const tenths = Math.floor((safeSeconds % 1) * 10);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
}

function syncPlanForm() {
  document.querySelectorAll(".scenario-option").forEach((button) => {
    button.classList.toggle("active", button.dataset.scenario === plan.scenario);
  });
  for (const groupId of ["A", "B"]) {
    const group = plan.groups[groupId];
    $(`target${groupId}`).value = group.targetId;
    $(`exposure${groupId}`).value = group.exposure;
    $(`exposure${groupId}Value`).value = `${group.exposure}s`;
    $(`focus${groupId}`).checked = group.autoFocus;
    document.querySelectorAll(`#filter${groupId} button`).forEach((button) => {
      button.classList.toggle("active", button.dataset.filter === group.filter);
    });
    const target = TARGETS[group.targetId];
    $(`target${groupId}Name`).textContent = target.name;
    $(`window${groupId}`).textContent = `可拍 ${target.minAltitude}°–${target.maxAltitude}°`;
  }
  $("domeToggle").setAttribute("aria-pressed", String(plan.domeOpen));
  $("domeState").textContent = plan.domeOpen ? "预设开启" : "预设闭合";
}

function readPlanFromForm() {
  const next = clone(plan);
  next.groups.A.targetId = $("targetA").value;
  next.groups.B.targetId = $("targetB").value;
  next.groups.A.exposure = Number($("exposureA").value);
  next.groups.B.exposure = Number($("exposureB").value);
  next.groups.A.autoFocus = $("focusA").checked;
  next.groups.B.autoFocus = $("focusB").checked;
  return next;
}

function canEditPlan() {
  return simulation.phase === "ready";
}

function applyPlanChange(update, message = "排程已更新") {
  if (!canEditPlan()) return;
  update(plan);
  revision += 1;
  $("planRevision").textContent = `REV. ${String(revision).padStart(2, "0")}`;
  syncPlanForm();
  resetSimulation(message, false);
}

function resetSimulation(message = "排程已重置", clearVerification = false) {
  audio.stopAll();
  plan = readPlanFromForm();
  simulation = new ObservatorySimulation(plan);
  lastLogId = -1;
  lastTaskId = null;
  lastPhase = simulation.phase;
  accumulator = 0;
  buildTimeline(simulation.exportState());
  setPauseLabel(false);
  if (clearVerification) clearVerificationPanel();
  $("stateSubtitle").textContent = message;
  render(performance.now(), true);
}

function setPauseLabel(paused) {
  const command = $("pauseButton");
  command.querySelector("span:last-child").innerHTML = `${paused ? "继续" : "暂停"}<small>${paused ? "RESUME" : "PAUSE"}</small>`;
}

function buildTimeline(state) {
  const tracks = $("timelineTracks");
  tracks.querySelectorAll(".timeline-block").forEach((node) => node.remove());
  timelineBlocks = [];
  let cursor = 0;
  state.tasks.forEach((task, index) => {
    const node = document.createElement("div");
    const start = cursor;
    const width = Math.max(0.45, (task.duration / MISSION_END) * 100);
    node.className = `timeline-block kind-${task.kind}`;
    node.style.left = `${(start / MISSION_END) * 100}%`;
    node.style.width = `${Math.max(0.22, width)}%`;
    node.dataset.taskId = task.id;
    node.title = `${task.label} · ${task.duration}s`;
    const labels = {
      dome: "OPEN",
      slew: `${task.group}↗`,
      filter: "FILTER",
      focus: "FOCUS",
      expose: task.group ? `${task.group} ${state.input.groups[task.group].exposure}s` : "EXPOSE",
    };
    node.innerHTML = `<span>${safe(labels[task.kind] || index + 1)}</span>`;
    tracks.appendChild(node);
    timelineBlocks.push(node);
    cursor += task.duration;
  });
  $("stormMarker").style.left = `${(state.scenario.stormOnset / MISSION_END) * 100}%`;
  $("stormMarker").querySelector("span").textContent =
    state.scenario.id === "early" ? "EARLY DUST" : "DUST";
}

function render(now = performance.now(), force = false) {
  const state = simulation.exportState();
  scene.draw(state, now);
  handleTransitions(state);
  updateStatus(state);
  updateEnvironmentReadouts(state);
  updateTimeline(state);
  updateDeliverables(state);
  updateResources(state);
  updateEventLog(state, force);
  updateControls(state);
}

function handleTransitions(state) {
  if (state.phase !== lastPhase) {
    if (state.phase === "paused") {
      audio.stopAll();
    } else if (["aborted", "complete", "recovered"].includes(state.phase)) {
      audio.stopAll();
      if (state.phase === "aborted") {
        latestFault = state.fault ? clone(state.fault) : latestFault;
        $("snapshotButton").hidden = false;
      }
      if (state.phase === "complete" && state.summary?.success) {
        audio.successTone();
      }
    }
    lastPhase = state.phase;
  }

  const taskId = state.currentTask?.id || null;
  if (taskId !== lastTaskId) {
    if (state.currentTask?.kind === "expose" && taskId) audio.shutter();
    lastTaskId = taskId;
  }
  if (state.phase === "running" && audio.enabled) {
    audio.update(state);
  } else if (audio.activeVoices && state.phase !== "recovering") {
    audio.stopAll();
  }
  if (state.fault) latestFault = clone(state.fault);
}

function updateStatus(state) {
  const status = missionStatus(state);
  $("stateTitle").textContent = status.title;
  $("stateSubtitle").textContent = status.subtitle;
  $("stateLight").className = `state-light ${status.light}`;
  $("sceneMode").textContent = state.phase.toUpperCase();
  $("timelineMode").textContent = status.timeline;

  const total = state.tasks.length;
  const current = Math.min(total, Math.max(0, state.currentTaskIndex + (state.phase === "ready" ? 0 : 1)));
  $("taskCounter").textContent = `${String(current).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  const qualified = [state.records.A, state.records.B].filter((record) => record?.qualified).length;
  $("recordState").textContent = `${qualified} / 2`;
  $("equipmentState").textContent =
    state.errorCode === "E_MOTOR_WEAR" ? "DAMAGED" : state.errorCode ? "SAFE STOP" : state.wear > 12 ? "MONITOR" : "NOMINAL";

  const task = ["aborted", "recovering", "recovered"].includes(state.phase) ? null : state.currentTask;
  const taskText = task
    ? `${task.label}${state.phase === "paused" ? " · 已暂停" : ""}`
    : state.phase === "complete"
      ? state.summary?.success
        ? "两组数据验收通过"
        : "排程结束 · 验收未通过"
      : state.phase === "aborted"
        ? "保护停机 · 记录已冻结"
        : state.phase === "recovered"
          ? "恢复完成 · 系统静默"
          : state.phase === "recovering"
            ? recoveryStageLabel(state.recovery?.stage)
            : "待命 / 光路关闭";
  $("activeTaskLabel").textContent = taskText;
  $("taskTime").textContent =
    state.phase === "recovering"
      ? `${Math.round((state.recovery?.stageElapsed / Math.max(0.1, state.recovery?.stageDuration)) * 100)}%`
      : task
        ? `${String(state.currentTaskIndex + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`
        : "--";
  const recoveryProgress =
    state.phase === "recovering"
      ? (state.recovery?.stageElapsed / Math.max(0.1, state.recovery?.stageDuration)) * 100
      : 0;
  const progress = task
    ? Math.min(100, (state.taskProgress / Math.max(0.1, task.duration)) * 100)
    : state.phase === "recovering"
      ? recoveryProgress
      : state.phase === "complete"
        ? 100
        : 0;
  $("taskProgressBar").style.width = `${progress}%`;
  $("opticalPathState").textContent = state.domeOpen ? (task?.kind === "expose" ? "INTEGRATING" : "OPEN") : "SEALED";
  $("stormAlert").hidden = !state.stormActive;
}

function missionStatus(state) {
  if (state.phase === "running") {
    return {
      title: state.stormActive ? "沙尘抵达" : "观测执行",
      subtitle: state.currentTask ? `${state.currentTask.label} · ${state.currentTask.detail}` : "主时钟运行中。",
      light: "running",
      timeline: "RUNNING",
    };
  }
  if (state.phase === "paused") {
    return { title: "时间轴暂停", subtitle: "积分时钟与电机指令已冻结，可单步推进。", light: "running", timeline: "PAUSED" };
  }
  if (state.phase === "aborted") {
    return { title: "保护停机", subtitle: `${state.errorCode} · ${state.abortReason}。观测记录已保留。`, light: "error", timeline: "ABORTED" };
  }
  if (state.phase === "recovering") {
    return { title: "恢复验证", subtitle: recoveryStageLabel(state.recovery?.stage), light: "running", timeline: "RECOVERY" };
  }
  if (state.phase === "recovered") {
    return {
      title: "恢复完成",
      subtitle: state.recovery?.report?.passed ? "12.0s 观察窗通过，无活动任务与资源漂移。" : "恢复观察发现残留状态，请检查记录。",
      light: state.recovery?.report?.passed ? "success" : "error",
      timeline: "RECOVERED",
    };
  }
  if (state.phase === "complete") {
    return state.summary?.success
      ? { title: "排程成功", subtitle: "A / B 两组曝光与清晰度达标，设备保持健康。", light: "success", timeline: "SUCCESS" }
      : { title: "验收未通过", subtitle: "排程结束，但至少一组数据或设备状态未达到要求。", light: "error", timeline: "FAILED" };
  }
  return { title: "待命", subtitle: "穹顶闭合，排程等待执行。", light: "", timeline: "READY" };
}

function recoveryStageLabel(stage) {
  if (stage === "seal") return "恢复 1/3 · 机械隔离与穹顶闭合";
  if (stage === "selftest") return "恢复 2/3 · 电机、传感器与光路自检";
  if (stage === "observe") return "恢复 3/3 · 12.0s 固定观察窗";
  return "恢复序列准备中";
}

function updateEnvironmentReadouts(state) {
  const group = state.currentTask?.group || (state.records.B ? "B" : "A");
  const target = TARGETS[state.input.groups[group].targetId];
  const altitude = altitudeAt(target.id, state.time);
  $("telescopeCoords").textContent = `AZ ${target.az.toFixed(1)}° · ALT ${altitude.toFixed(1)}°`;
  $("tempReadout").textContent = `${state.temperature >= 0 ? "+" : ""}${state.temperature.toFixed(1)}°`;
  $("windReadout").textContent = `${state.wind.toFixed(1)} m/s`;
  $("dustReadout").textContent = pct(state.dust * 100);
  $("focusReadout").textContent = `${state.focusError.toFixed(2)} µm`;

  const remaining = Math.max(0, state.scenario.stormOnset - state.time);
  $("stormEta").textContent = state.stormActive ? "已抵达" : `T– ${formatClock(remaining)}`;
  const stormProgress = Math.max(2, Math.min(100, (state.time / state.scenario.stormOnset) * 100));
  $("stormFill").style.width = `${stormProgress}%`;
  document.querySelector(".storm-front").style.left = `${stormProgress}%`;
  $("stormState").textContent = state.stormActive ? "封锁" : state.warningActive ? "预警" : "稳定";
  $("stormState").style.color = state.stormActive ? "var(--red)" : state.warningActive ? "var(--sand)" : "var(--muted)";
}

function updateTimeline(state) {
  $("missionClock").textContent = preciseClock(state.time);
  $("playhead").style.left = `${Math.min(100, (state.time / MISSION_END) * 100)}%`;
  timelineBlocks.forEach((block, index) => {
    block.classList.toggle("complete", index < state.currentTaskIndex || state.phase === "complete");
    block.classList.toggle("active", index === state.currentTaskIndex && ["running", "paused"].includes(state.phase));
    block.classList.toggle("aborted", block.dataset.taskId === state.abortedTaskId);
  });
}

function updateDeliverables(state) {
  for (const groupId of ["A", "B"]) {
    const target = TARGETS[state.input.groups[groupId].targetId];
    const record = state.records[groupId];
    const card = document.querySelector(`.program-card[data-group="${groupId}"]`);
    const isActive = state.currentTask?.group === groupId && ["running", "paused"].includes(state.phase);
    const wasAborted = record?.status?.includes("中止");
    let programLabel = "PLANNED";
    card.classList.remove("running", "complete", "aborted");
    if (isActive) {
      programLabel = state.phase === "paused" ? "PAUSED" : "RUNNING";
      card.classList.add("running");
    } else if (wasAborted) {
      programLabel = "ABORTED";
      card.classList.add("aborted");
    } else if (record?.qualified) {
      programLabel = "VERIFIED";
      card.classList.add("complete");
    } else if (record) {
      programLabel = "REVIEW";
      card.classList.add(record.qualified ? "complete" : "aborted");
    }
    $(`program${groupId}Status`).textContent = programLabel;
    $(`record${groupId}Title`).textContent = target.name;

    const exposure = record?.exposure || 0;
    const clarity = record?.meanClarity || 0;
    $(`exposureFill${groupId}`).style.width = `${Math.min(100, (exposure / target.minExposure) * 100)}%`;
    $(`clarityFill${groupId}`).style.width = `${Math.min(100, clarity)}%`;
    $(`exposureMetric${groupId}`).textContent = `${exposure.toFixed(1)} / ${target.minExposure}s`;
    $(`clarityMetric${groupId}`).textContent = record ? `${clarity.toFixed(1)} / ${target.minClarity}%` : `— / ${target.minClarity}%`;
    const stateLabel = $(`record${groupId}State`);
    stateLabel.className = "";
    if (wasAborted) {
      stateLabel.textContent = "记录保留";
      stateLabel.classList.add("fail");
    } else if (record?.qualified) {
      stateLabel.textContent = "达标";
      stateLabel.classList.add("pass");
    } else if (isActive && state.currentTask?.kind === "expose") {
      stateLabel.textContent = "积分中";
    } else if (record) {
      stateLabel.textContent = record.status;
      if (!record.qualified) stateLabel.classList.add("fail");
    } else {
      stateLabel.textContent = isActive ? "准备中" : "待采集";
    }
  }
}

function updateResources(state) {
  $("wearValue").textContent = `${state.wear.toFixed(1)}%`;
  $("wearFill").style.width = `${Math.min(100, state.wear)}%`;
  $("powerValue").textContent = `${state.power.toFixed(1)}%`;
  $("powerFill").style.width = `${Math.min(100, state.power)}%`;
  $("dataValue").textContent = `${state.dataMB.toFixed(1)} MB`;
  $("dataFill").style.width = `${Math.min(100, (state.dataMB / 10) * 100)}%`;
  $("telemetryTemp").textContent = `${state.temperature >= 0 ? "+" : ""}${state.temperature.toFixed(1)}°C`;
  $("telemetryWind").textContent = `${state.wind.toFixed(1)} m/s`;
  $("telemetryDust").textContent = pct(state.dust * 100);
  $("telemetryFocus").textContent = `${state.focusError.toFixed(2)} µm`;
  $("resourceSample").textContent = state.phase === "running" ? "LIVE" : state.phase === "paused" ? "FROZEN" : "SNAPSHOT";
}

function updateEventLog(state, force) {
  const signature = state.events[0]?.id ?? -1;
  if (!force && signature === lastLogId) return;
  lastLogId = signature;
  $("logCount").textContent = String(state.events.length).padStart(2, "0");
  $("eventLog").innerHTML = state.events
    .slice(0, 36)
    .map(
      (event) => `
        <div class="log-entry ${safe(event.level)}">
          <time>${formatClock(event.time)}</time>
          <p>${safe(event.message)}</p>
        </div>`,
    )
    .join("");
}

function updateControls(state) {
  const editable = canEditPlan();
  document.querySelectorAll(".scenario-option").forEach((button) => {
    button.disabled = !editable;
  });
  ["targetA", "targetB", "exposureA", "exposureB", "focusA", "focusB"].forEach((id) => {
    $(id).disabled = !editable;
  });
  document.querySelectorAll(".filter-options button").forEach((button) => {
    button.disabled = !editable;
  });
  $("domeToggle").disabled = !editable;
  $("startButton").disabled = !["ready", "aborted"].includes(state.phase);
  $("startButton").querySelector("span:last-child").innerHTML =
    state.phase === "aborted" ? "恢复自检<small>RECOVER 12s</small>" : "执行排程<small>RUN SEQUENCE</small>";
  $("pauseButton").disabled = !["running", "paused"].includes(state.phase);
  $("stepButton").disabled = state.phase !== "paused";
  setPauseLabel(state.phase === "paused");
  $("domeState").textContent = editable
    ? state.input.domeOpen
      ? "预设开启"
      : "预设闭合"
    : state.domeOpen
      ? "已开启"
      : "安全闭合";
}

function updateAudioUi() {
  $("audioButton").setAttribute("aria-pressed", String(audio.enabled));
  $("audioLabel").textContent = audio.enabled ? "声场开启" : "启用声场";
}

async function startMission() {
  if (simulation.phase === "aborted") {
    audio.stopAll();
    simulation.recover();
    accumulator = 0;
    lastFrame = performance.now();
    render(performance.now(), true);
    return;
  }
  if (simulation.phase !== "ready") return;
  if (!audio.enabled && !audioUserMuted) {
    await audio.enable();
    updateAudioUi();
  }
  simulation.start();
  accumulator = 0;
  lastFrame = performance.now();
  render();
}

function togglePause() {
  if (simulation.phase === "running") {
    simulation.pause();
    accumulator = 0;
  } else if (simulation.phase === "paused") {
    simulation.resume();
    lastFrame = performance.now();
    if (audio.enabled) audio.ensure();
  }
  render();
}

function stepOnce() {
  if (simulation.phase !== "paused") return;
  simulation.stepOnce(0.5);
  render(performance.now(), true);
}

function bindControls() {
  document.querySelectorAll(".scenario-option").forEach((button) => {
    button.addEventListener("click", () => {
      applyPlanChange((next) => {
        next.scenario = button.dataset.scenario;
        next.domeOpen = false;
      }, `已载入${SCENARIOS[button.dataset.scenario].name}排程`);
    });
  });

  for (const groupId of ["A", "B"]) {
    $(`target${groupId}`).addEventListener("change", () => {
      applyPlanChange((next) => {
        const target = TARGETS[$(`target${groupId}`).value];
        next.groups[groupId].targetId = target.id;
        next.groups[groupId].filter = target.filter;
      });
    });
    $(`exposure${groupId}`).addEventListener("input", (event) => {
      $(`exposure${groupId}Value`).value = `${event.target.value}s`;
      plan.groups[groupId].exposure = Number(event.target.value);
      if (canEditPlan()) resetSimulation("积分时长已更新");
    });
    $(`focus${groupId}`).addEventListener("change", (event) => {
      applyPlanChange((next) => {
        next.groups[groupId].autoFocus = event.target.checked;
      });
    });
    document.querySelectorAll(`#filter${groupId} button`).forEach((button) => {
      button.addEventListener("click", () => {
        applyPlanChange((next) => {
          next.groups[groupId].filter = button.dataset.filter;
        });
      });
    });
  }

  $("domeToggle").addEventListener("click", () => {
    applyPlanChange((next) => {
      next.domeOpen = !next.domeOpen;
    });
  });
  $("startButton").addEventListener("click", startMission);
  $("pauseButton").addEventListener("click", togglePause);
  $("stepButton").addEventListener("click", stepOnce);
  $("resetButton").addEventListener("click", () => {
    accumulator = 0;
    revision += 1;
    $("planRevision").textContent = `REV. ${String(revision).padStart(2, "0")}`;
    resetSimulation("排程已重置，等待再次执行");
  });

  $("audioButton").addEventListener("click", async () => {
    if (audio.enabled) {
      audioUserMuted = true;
      audio.setMuted(true);
    } else {
      audioUserMuted = false;
      await audio.enable();
      if (simulation.phase === "running") audio.update(simulation.exportState());
    }
    updateAudioUi();
  });

  $("repeatButton").addEventListener("click", runRepeatVerification);
  $("faultButton").addEventListener("click", runFaultVerification);
  $("snapshotButton").addEventListener("click", showFaultSnapshot);
  $("closeSnapshot").addEventListener("click", () => $("snapshotDialog").close());
  $("snapshotDialog").addEventListener("click", (event) => {
    if (event.target === $("snapshotDialog")) $("snapshotDialog").close();
  });
}

function setVerificationBadge(text, type) {
  $("verificationBadge").textContent = text;
  $("verificationBadge").className = `micro-badge ${type}`;
}

function setVerificationResults(cards) {
  $("verificationResults").innerHTML = cards
    .map(
      (card) => `
        <div class="verify-result ${card.type || "muted"}">
          <span>${safe(card.label)}</span>
          <strong>${safe(card.value)}</strong>
          <small>${safe(card.note)}</small>
        </div>`,
    )
    .join("");
}

function clearVerificationPanel() {
  setVerificationBadge("NOT RUN", "");
  setVerificationResults([
    { label: "任务序列", value: "—", note: "等待回放" },
    { label: "资源轨迹", value: "—", note: "等待回放" },
    { label: "最终结果", value: "—", note: "等待回放" },
    { label: "恢复观察", value: "—", note: "12.0s 固定窗口" },
  ]);
  $("verificationCopy").textContent = "使用当前排程执行两次独立回放，比较任务序列、资源采样与最终验收。";
  $("snapshotButton").hidden = !latestFault;
}

function runRepeatVerification() {
  const input = clone(plan);
  const result = compareRuns(input);
  const summary = result.runA.summary;
  const passed = result.match;
  latestFault = result.runA.fault || latestFault;
  $("snapshotButton").hidden = !latestFault?.after;
  setVerificationBadge(passed ? "MATCH" : "MISMATCH", passed ? "pass" : "fail");
  setVerificationResults([
    {
      label: "任务序列",
      value: result.taskMatch ? "IDENTICAL" : "DIFF",
      note: `#${result.taskDigest}`,
      type: result.taskMatch ? "pass" : "fail",
    },
    {
      label: "资源轨迹",
      value: result.resourceMatch ? `${result.runA.trace.length} SAMPLES` : "DIFF",
      note: `#${result.resourceDigest}`,
      type: result.resourceMatch ? "pass" : "fail",
    },
    {
      label: "最终结果",
      value: `${summary.outcome} ×2`,
      note: `#${result.finalDigest}`,
      type: result.finalMatch ? (summary.outcome === "SUCCESS" ? "pass" : "muted") : "fail",
    },
    {
      label: "恢复观察",
      value: "NOT TESTED",
      note: "运行故障验证",
      type: "muted",
    },
  ]);
  $("verificationCopy").textContent =
    `同输入双跑完成：任务、${result.runA.trace.length} 个资源采样与最终 ${summary.outcome} 均${passed ? "完全一致" : "存在差异"}。` +
    (summary.outcome === "SUCCESS"
      ? " 标准流程不是唯一路径，可继续执行沙尘中止验证。"
      : ` 本次输入本身包含非顺利结果：${summary.errorCode || summary.outcome}。`);
}

function runFaultVerification() {
  const input = clone(plan);
  input.scenario = "early";
  const comparison = compareRuns(input);
  const aborted = comparison.runA;
  const recovered = runSchedule(input, { recover: true });
  const recovery = recovered.recovery?.report;
  const fault = aborted.fault;
  latestFault = fault ? clone(fault) : latestFault;
  const aRecord = aborted.records.A;
  const bRecord = aborted.records.B;
  const recordsPreserved = Boolean(aRecord || bRecord);
  const passed = comparison.match && aborted.phase === "aborted" && Boolean(recovery?.passed) && recordsPreserved;
  $("snapshotButton").hidden = !latestFault?.after;
  setVerificationBadge(passed ? "PASS" : "FAIL", passed ? "pass" : "fail");
  setVerificationResults([
    {
      label: "任务序列",
      value: comparison.taskMatch ? "MATCH ×2" : "DIFF",
      note: `#${comparison.taskDigest}`,
      type: comparison.taskMatch ? "pass" : "fail",
    },
    {
      label: "记录保留",
      value: `A ${aRecord?.exposure.toFixed(1) || "0"}s / B ${bRecord?.exposure.toFixed(1) || "0"}s`,
      note: `中止于 ${aborted.abortedTaskId || "—"}`,
      type: recordsPreserved ? "pass" : "fail",
    },
    {
      label: "最终结果",
      value: comparison.finalMatch ? "ABORT ×2" : "DIFF",
      note: aborted.errorCode || "NO FAULT",
      type: comparison.finalMatch && aborted.phase === "aborted" ? "fail" : "muted",
    },
    {
      label: "恢复观察",
      value: recovery?.passed ? "PASS 12.0s" : "FAIL",
      note: recovery?.passed ? "ΔW 0 · ΔP 0 · 任务 0" : "发现残留状态",
      type: recovery?.passed ? "pass" : "fail",
    },
  ]);
  const abortAt = fault?.triggeredAt ? formatClock(fault.triggeredAt) : formatClock(aborted.time);
  $("verificationCopy").textContent = passed
    ? `提前沙尘在 ${abortAt} 触发保护停机，A/B 记录均保留；双跑一致。恢复自检后固定观察 12.0s 通过，错误码为空且磨损、电量、数据零漂移。`
    : `故障验证未通过：${aborted.errorCode || "未进入中止状态"}，请扩大记录面板检查快照。`;
}

function snapshotRows(snapshot) {
  if (!snapshot) return `<div class="snapshot-table"><span>状态</span><b>未生成</b></div>`;
  const records = snapshot.records || {};
  const formatRecord = (record) =>
    record ? `${record.status} / ${Number(record.exposure || 0).toFixed(1)}s` : "无记录";
  const rows = [
    ["运行时刻", preciseClock(snapshot.time)],
    ["阶段", snapshot.phase.toUpperCase()],
    ["当前任务", snapshot.task || "—"],
    ["活动任务", String(snapshot.activeJobs)],
    ["粉尘密度", pct(snapshot.dust * 100)],
    ["阵风", `${Number(snapshot.wind).toFixed(1)} m/s`],
    ["环境温度", `${Number(snapshot.temperature).toFixed(1)}°C`],
    ["穹顶", snapshot.dome],
    ["焦面偏差", `${Number(snapshot.focusError).toFixed(3)} µm`],
    ["电机磨损", `${Number(snapshot.wear).toFixed(2)}%`],
    ["电池", `${Number(snapshot.power).toFixed(2)}%`],
    ["A 组记录", formatRecord(records.A)],
    ["B 组记录", formatRecord(records.B)],
  ];
  return `<div class="snapshot-table">${rows
    .map(([label, value]) => `<span>${safe(label)}</span><b>${safe(value)}</b>`)
    .join("")}</div>`;
}

function showFaultSnapshot() {
  const fault = latestFault || simulation.fault;
  if (!fault) return;
  $("snapshotGrid").innerHTML = `
    <article class="snapshot-panel">
      <h3>触发前 <span>${safe(preciseClock(fault.before?.time || fault.warningAt))}</span></h3>
      ${snapshotRows(fault.before)}
    </article>
    <article class="snapshot-panel after">
      <h3>保护停机后 <span>${safe(preciseClock(fault.after?.time || fault.triggeredAt || 0))}</span></h3>
      ${snapshotRows(fault.after)}
    </article>`;
  $("snapshotFooter").textContent =
    `${fault.type} · 预警 ${formatClock(fault.warningAt)} / 触发 ${formatClock(fault.triggeredAt)} · ` +
    "停机时冻结积分缓存，穹顶进入 SAFE_CLOSED，活动任务归零；记录在恢复过程中保持只读。";
  $("snapshotDialog").showModal();
}

function updateLocalClock() {
  const now = new Date();
  $("localClock").textContent = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
}

function frame(now) {
  const delta = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  const active = simulation.phase === "running" || simulation.phase === "recovering";
  if (active) {
    accumulator += delta * speed;
    let steps = 0;
    while (accumulator >= tick && steps < 60) {
      simulation.step(tick);
      accumulator -= tick;
      steps += 1;
      if (simulation.phase !== "running" && simulation.phase !== "recovering") break;
    }
  } else {
    accumulator = 0;
  }
  render(now);
  requestAnimationFrame(frame);
}

function boot() {
  bindControls();
  syncPlanForm();
  clearVerificationPanel();
  buildTimeline(simulation.exportState());
  updateAudioUi();
  updateLocalClock();
  window.setInterval(updateLocalClock, 1000);
  render(performance.now(), true);
  requestAnimationFrame(frame);
}

window.__QUEBRADA__ = {
  getState: () => simulation.exportState(true),
  getAudioVoices: () => audio.activeVoices,
  compareCurrentPlan: () => compareRuns(plan),
  runFaultProbe: () => {
    const input = clone(plan);
    input.scenario = "early";
    return {
      abort: compareRuns(input),
      recovered: runSchedule(input, { recover: true }),
    };
  },
};

boot();
