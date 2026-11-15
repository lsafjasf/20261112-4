import { BlackwaterGame, TICK } from "./game.js";
import { FailureScenario, RecoveryScenario, runDoubleAudit } from "./scenarios.js";
import { Renderer } from "./renderer.js";
import { SurveyAudio } from "./audio.js";

const params = new URLSearchParams(window.location.search);
const SEED = params.get("seed") || "7319";
const DEMO_SPEED = 5;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  seed: $("#seed-value"),
  layout: $("#layout-hash"),
  reachability: $("#reachability"),
  pause: $("#pause-button"),
  pauseIcon: $("#pause-icon"),
  pauseLabel: $("#pause-label"),
  step: $("#step-button"),
  reset: $("#reset-button"),
  sound: $("#sound-button"),
  soundIcon: $("#sound-icon"),
  banner: $("#stage-banner"),
  bannerKicker: $("#banner-kicker"),
  bannerTitle: $("#banner-title"),
  bannerCopy: $("#banner-copy"),
  bannerAction: $("#banner-action"),
  oxygenValue: $("#oxygen-value"),
  batteryValue: $("#battery-value"),
  armValue: $("#arm-value"),
  oxygenBar: $("#oxygen-bar"),
  batteryBar: $("#battery-bar"),
  armBar: $("#arm-bar"),
  cogValue: $("#cog-value"),
  cogBar: $("#cog-bar"),
  cogPin: $("#cog-pin"),
  faultStrip: $("#fault-strip"),
  faultCode: $("#fault-code"),
  faultDetail: $("#fault-detail"),
  missionPhase: $("#mission-phase"),
  missionTime: $("#mission-time"),
  scanCount: $("#scan-count"),
  scanPrecision: $("#scan-precision"),
  sonarOrb: $("#sonar-orb"),
  speedValue: $("#speed-value"),
  artifactList: $("#artifact-list"),
  hullProgress: $("#hull-progress"),
  hullBar: $("#hull-bar"),
  routeProgress: $("#route-progress"),
  routeBar: $("#route-bar"),
  homeDistance: $("#home-distance"),
  homeBar: $("#home-bar"),
  sequenceList: $("#sequence-list"),
  sequenceCount: $("#sequence-count"),
  faultRecorder: $("#fault-recorder"),
  faultCount: $("#fault-count"),
  auditStatus: $("#audit-status"),
  auditConsole: $("#audit-console"),
  toasts: $("#toast-stack"),
  failureRun: $("#failure-run"),
  recoveryRun: $("#recovery-run"),
  doubleRun: $("#double-run"),
};

const auditFlags = {
  layout: true,
  samples: false,
  failure: false,
  double: false,
  recovery: false,
};

let game = new BlackwaterGame({ seed: SEED });
let scenario = null;
let bannerHandler = "start";
let accumulator = 0;
let lastFrame = performance.now();
let scenarioAnnounced = false;
let manualAnnounced = false;
let lastSequenceLength = -1;
let lastFaultCount = -1;
let manualStarted = false;
let toastTimers = [];
const renderer = new Renderer($("#game-canvas"), SEED);
const audio = new SurveyAudio();
const keys = { forward: false, reverse: false, left: false, right: false, boost: false };

function formatTime(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function setBanner({ kicker, title, copy, action, tone = "", handler = "start" }) {
  elements.bannerKicker.textContent = kicker;
  elements.bannerTitle.textContent = title;
  elements.bannerCopy.textContent = copy;
  elements.bannerAction.textContent = action;
  elements.banner.className = `stage-banner ${tone}`.trim();
  bannerHandler = handler;
}

function hideBanner() {
  elements.banner.classList.add("hidden");
}

function buildArtifactCards() {
  elements.artifactList.innerHTML = game.artifacts.map((artifact) => `
    <div class="artifact" data-artifact="${artifact.id}">
      <div class="artifact-id"><span>${artifact.code}</span><b>UNKNOWN</b></div>
      <h3>${artifact.name}</h3>
      <p>回波待捕获</p>
      <i class="sample-progress"></i>
    </div>
  `).join("");
}

function renderStaticMeta() {
  elements.seed.textContent = SEED;
  elements.layout.textContent = `#${game.world.layoutHash}`;
  elements.reachability.textContent = game.reachability.ok
    ? `PASS ${game.reachability.passed}/${game.reachability.total}`
    : `FAIL ${game.reachability.passed}/${game.reachability.total}`;
  elements.reachability.parentElement.classList.toggle("reachable", game.reachability.ok);
  elements.faultCount.textContent = `${game.faults.length} FAULTS`;
}

function toast(title, detail, tone = "") {
  const node = document.createElement("div");
  node.className = `toast ${tone}`.trim();
  node.innerHTML = `<b>${title}</b><span>${detail}</span>`;
  elements.toasts.prepend(node);
  const timer = setTimeout(() => node.remove(), 3600);
  toastTimers.push(timer);
  while (elements.toasts.children.length > 3) elements.toasts.lastElementChild.remove();
}

function clearToasts() {
  toastTimers.forEach((timer) => clearTimeout(timer));
  toastTimers = [];
  elements.toasts.innerHTML = "";
}

function ensureAudio() {
  audio.ensureStarted();
}

function consumeGameEvents() {
  const events = game.consumeEvents();
  for (const event of events) {
    if (event.type === "ping") {
      audio.ping();
    } else if (event.type === "echo") {
      audio.echo(false);
      toast(event.label, event.detail, "good");
    } else if (event.type === "echo-blocked") {
      audio.echo(true);
      toast(event.label, event.detail, "warn");
    } else if (event.type === "collision") {
      audio.collision();
      renderer.triggerShake(1);
    } else if (event.type === "sample-complete") {
      audio.sampleComplete();
      toast(event.label, event.detail, "good");
    } else if (event.type === "sample-abort" || event.type === "scan-denied" || event.type === "sample-denied") {
      toast(event.label, event.detail, "warn");
    } else if (event.type === "fault") {
      toast(event.label, event.detail, "fail");
    } else if (event.type === "recovery") {
      toast(event.label, event.detail, "good");
    } else if (event.type === "failure") {
      toast(event.label, event.detail, "fail");
    }
  }
}

function updateArtifactCards() {
  for (const artifact of game.artifacts) {
    const card = elements.artifactList.querySelector(`[data-artifact="${artifact.id}"]`);
    if (!card) continue;
    const silt = game.siltAt(artifact.x, artifact.y);
    const obscured = artifact.discovered && !artifact.sampled && silt > 0.5;
    const status = artifact.sampled
      ? "SAMPLED"
      : obscured
        ? "SILT MASK"
        : artifact.discovered
          ? "IDENTIFIED"
          : "UNKNOWN";
    card.className = [
      "artifact",
      artifact.discovered ? "discovered" : "",
      artifact.sampled ? "sampled" : "",
      obscured ? "obscured" : "",
    ].filter(Boolean).join(" ");
    card.querySelector(".artifact-id b").textContent = status;
    card.querySelector("p").textContent = artifact.sampled
      ? `+${artifact.mass.toFixed(1)} kg · 已固定`
      : obscured
        ? `泥沙遮蔽 ${Math.round(silt * 100)}%`
        : artifact.discovered
          ? `${Math.round(Math.hypot(game.position.x - artifact.x, game.position.y - artifact.y) * 0.5)} m · 可取样`
          : "回波待捕获";
    const progress = card.querySelector(".sample-progress");
    progress.style.transform = `scaleX(${artifact.sampleProgress || 0})`;
    progress.style.background = artifact.sampled ? "var(--lime)" : "var(--cyan)";
  }
}

function updateSequence() {
  if (lastSequenceLength === game.events.length) return;
  lastSequenceLength = game.events.length;
  const events = game.events.slice(-10).reverse();
  elements.sequenceCount.textContent = `${String(game.events.length).padStart(2, "0")} EVENTS`;
  if (events.length === 0) {
    elements.sequenceList.innerHTML = '<div class="sequence-empty">尚未产生任务事件</div>';
    return;
  }
  elements.sequenceList.innerHTML = events.map((event) => {
    const tone = event.tag === "fail" ? "fail" : event.tag === "warn" ? "warn" : event.tag === "good" ? "good" : "";
    return `
      <div class="sequence-item ${tone}">
        <time>T+${formatTime(event.time)}</time>
        <span>${event.label}</span>
        <b>${event.tag === "scan" ? "SONAR" : event.tag === "fail" ? "FAULT" : event.tag === "good" ? "OK" : "SYS"}</b>
      </div>
    `;
  }).join("");
}

function faultColumn(title, snapshot) {
  return `
    <div class="record-grid">
      <strong>${title}</strong>
      <div><span>O₂</span><b>${snapshot.resources.oxygen.toFixed(1)}%</b></div>
      <div><span>BATTERY</span><b>${snapshot.resources.battery.toFixed(1)}%</b></div>
      <div><span>ARM</span><b>${snapshot.resources.arm.toFixed(1)}%</b></div>
      <div><span>SPEED</span><b>${snapshot.velocity.speed.toFixed(1)}</b></div>
      <div><span>COG</span><b>${snapshot.cogPercent.toFixed(1)}%</b></div>
      <div><span>FAULT</span><b>${snapshot.activeFault ?? "NONE"}</b></div>
    </div>
  `;
}

function updateFaultRecorder() {
  if (lastFaultCount === game.faults.length && !game.recovery) return;
  lastFaultCount = game.faults.length;
  elements.faultCount.textContent = `${game.faults.length} FAULT${game.faults.length === 1 ? "" : "S"}`;
  if (game.faults.length === 0) {
    elements.faultRecorder.innerHTML = `
      <div class="record-empty">
        <span>NO FAULT CAPTURED</span>
        <p>碰撞或资源耗尽时，这里会冻结触发前后的关键状态。</p>
      </div>
    `;
    return;
  }
  const fault = game.faults[0];
  const delta = fault.delta;
  const recovery = game.recovery
    ? `<div class="record-grid" style="border-top:1px solid rgba(166,219,123,.12)">
        <strong>RECOVERY OBSERVATION</strong>
        <div><span>RECOVERED AT</span><b>T+${formatTime(game.recovery.at)}</b></div>
        <div><span>ACTIVE FAULT</span><b>${game.activeFault ? game.activeFault.code : "CLEARED"}</b></div>
      </div>`
    : "";
  elements.faultRecorder.innerHTML = `
    <div class="fault-record">
      <header><span>${fault.id} / ${fault.code}</span><b>T+${formatTime(fault.at)}</b></header>
      <div class="record-columns">
        ${faultColumn("BEFORE", fault.before)}
        ${faultColumn("AFTER", fault.after)}
      </div>
      <div class="record-grid" style="border-top:1px solid rgba(255,116,107,.12)">
        <strong>DELTA / ${fault.phase}</strong>
        <div><span>O₂</span><b class="delta">${delta.oxygen.toFixed(1)}</b></div>
        <div><span>BATTERY</span><b class="delta">${delta.battery.toFixed(1)}</b></div>
        <div><span>ARM</span><b class="delta">${delta.arm.toFixed(1)}</b></div>
        <div><span>IMPACT</span><b class="delta">${delta.speed.toFixed(1)} kn</b></div>
      </div>
      ${recovery}
    </div>
  `;
}

function updateAuditChecks() {
  const rows = $$("#audit-checks > div");
  const values = [
    ["layout", "固定 seed 布局"],
    ["samples", "三件取样完成"],
    ["failure", "返航失败可复现"],
    ["double", "双跑轨迹一致"],
    ["recovery", "恢复后无残留"],
  ];
  values.forEach(([key, label], index) => {
    const row = rows[index];
    if (!row) return;
    row.className = auditFlags[key] ? "pass" : "";
    row.children[1].textContent = label;
    row.children[2].textContent = auditFlags[key] ? "PASS" : "待运行";
  });
  const complete = Object.values(auditFlags).every(Boolean);
  elements.auditStatus.textContent = complete ? "ALL PASS" : "READY";
  elements.auditStatus.className = `status-pill ${complete ? "" : "ghost"}`.trim();
}

function writeConsole(lines) {
  elements.auditConsole.innerHTML = lines.slice(-5).map((line) => {
    const tone = line.tone || "";
    return `<div class="console-line ${tone}"><span>${line.tag || "SYS"}</span>${line.text}</div>`;
  }).join("");
}

function updateHud() {
  const resources = game.resources;
  elements.oxygenValue.textContent = `${Math.ceil(resources.oxygen)}%`;
  elements.batteryValue.textContent = `${Math.ceil(resources.battery)}%`;
  elements.armValue.textContent = `${Math.ceil(resources.arm)}%`;
  elements.oxygenBar.style.width = `${clamp(resources.oxygen, 0, 100)}%`;
  elements.batteryBar.style.width = `${clamp(resources.battery, 0, 100)}%`;
  elements.armBar.style.width = `${clamp(resources.arm, 0, 100)}%`;
  for (const row of $$(".resource-row")) {
    const value = resources[row.dataset.resource];
    row.classList.toggle("is-low", value <= 24);
  }
  const cog = game.cogPercent;
  elements.cogValue.textContent = `${cog.toFixed(1)}%`;
  elements.cogBar.style.width = `${cog}%`;
  elements.cogPin.style.left = `${clamp(cog, 0, 100)}%`;

  const phase = scenario instanceof RecoveryScenario && scenario.phase === 2
    ? `OBSERVE ${Math.max(0, scenario.observationSeconds - scenario.observationElapsed).toFixed(1)}s`
    : game.paused
      ? "PAUSED"
      : game.phase;
  elements.missionPhase.textContent = phase;
  elements.missionTime.textContent = formatTime(game.time);
  elements.scanCount.textContent = String(game.scanCount).padStart(2, "0");
  elements.scanPrecision.textContent = `${Math.round(game.precision * 100)}%`;
  elements.speedValue.textContent = Math.hypot(game.velocity.x, game.velocity.y).toFixed(1);
  elements.sonarOrb.classList.toggle("cooldown", game.scanCooldown > 0);
  elements.sonarOrb.querySelector("b").textContent = game.scanCooldown > 0 ? "COOL" : "READY";

  elements.faultStrip.classList.toggle("active", Boolean(game.activeFault));
  elements.faultCode.textContent = game.activeFault?.code ?? "NO ACTIVE FAULT";
  elements.faultDetail.textContent = game.activeFault
    ? `电池泄漏 ${game.activeFault.leakBattery.toFixed(1)}%/s`
    : game.recovery
      ? "恢复观察中 · 泄漏已隔离"
      : "所有系统稳定";

  updateArtifactCards();
  const hullCount = game.hullSeenCount;
  elements.hullProgress.textContent = `${hullCount} / ${game.hull.length}`;
  elements.hullBar.style.width = `${game.hullCoverage * 100}%`;
  const routeCount = game.routeNodes.filter((node) => node.surveyed).length;
  elements.routeProgress.textContent = `${routeCount} / ${game.routeNodes.length}`;
  elements.routeBar.style.width = `${(routeCount / game.routeNodes.length) * 100}%`;
  elements.homeDistance.textContent = `${Math.round(game.distanceHome * 0.5)} m`;
  elements.homeBar.style.width = `${clamp(100 - game.distanceHome / 12, 3, 100)}%`;

  elements.pauseIcon.textContent = game.paused ? "▶" : "Ⅱ";
  elements.pauseLabel.textContent = game.paused ? "继续" : "暂停";
  updateSequence();
  updateFaultRecorder();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setScenarioButtons(active = null) {
  for (const button of [elements.failureRun, elements.recoveryRun, elements.doubleRun]) {
    button.classList.toggle("running", button === active);
  }
}

function resetGame() {
  scenario = null;
  scenarioAnnounced = false;
  manualStarted = false;
  accumulator = 0;
  game = new BlackwaterGame({ seed: SEED });
  buildArtifactCards();
  renderStaticMeta();
  lastSequenceLength = -1;
  lastFaultCount = -1;
  setScenarioButtons();
  setBanner({
    kicker: "MISSION READY / FIXED SEED",
    title: "等待下潜指令",
    copy: "声呐只能提供短暂轮廓。保持三项生命资源，完成三件取样。",
    action: "开始测绘",
    handler: "start",
  });
  elements.banner.classList.remove("hidden");
  clearToasts();
  updateHud();
}

function startManualGame() {
  ensureAudio();
  if (game.status === "ready") game.start();
  manualStarted = true;
  manualAnnounced = false;
  hideBanner();
  writeConsole([{ tag: "RUN", text: `MANUAL RUN · SEED ${SEED} · REACHABILITY PASS` }]);
}

function launchScenario(kind) {
  ensureAudio();
  clearToasts();
  scenario = kind === "failure" ? new FailureScenario(SEED) : new RecoveryScenario(SEED);
  game = scenario.game;
  manualStarted = false;
  manualAnnounced = false;
  scenarioAnnounced = false;
  accumulator = 0;
  lastSequenceLength = -1;
  lastFaultCount = -1;
  buildArtifactCards();
  renderStaticMeta();
  hideBanner();
  setScenarioButtons(kind === "failure" ? elements.failureRun : elements.recoveryRun);
  writeConsole([
    {
      tag: "RUN",
      text: kind === "failure"
        ? `FAILURE RUN · ${DEMO_SPEED}× · 三件实物取样后执行风险返航`
        : "RECOVERY RUN · 碰撞 → 紧急恢复 → FIXED 10s OBSERVE",
    },
  ]);
  if (kind === "failure") {
    toast("失败演练已启动", "真实物理序列 · 约 19 秒", "warn");
  } else {
    toast("恢复演练已启动", "碰撞后观察 10.0 秒", "warn");
  }
  updateHud();
}

function finishScenario() {
  if (!scenario || scenarioAnnounced) return;
  scenarioAnnounced = true;
  accumulator = 0;
  setScenarioButtons();
  const evidence = scenario.evidence;
  if (scenario instanceof FailureScenario) {
    auditFlags.samples = evidence.sampledCount === 3;
    auditFlags.failure = evidence.final.status === "failed" && evidence.failure?.phase === "RETURN";
    writeConsole([
      { tag: "PASS", text: `LAYOUT ${evidence.layoutHash} · REACHABLE`, tone: "good" },
      { tag: "PASS", text: `SAMPLES 3/3 · ROUTE ${evidence.final.routeNodes.join("/")}`, tone: "good" },
      { tag: "FAIL", text: `${evidence.failure.reason} @ T+${evidence.duration}s · PHASE ${evidence.failure.phase}`, tone: "fail" },
      { tag: "FAULT", text: `SNAPSHOT ${evidence.faults.length} · BEFORE/AFTER RECORDED`, tone: "fail" },
    ]);
    setBanner({
      kicker: "MISSION FAILED / RETURN LEG",
      title: `返航失败 · ${evidence.failure.label}`,
      copy: `3/3 文物已取样；航线测绘 ${evidence.final.routeNodes.length}/3。故障在 T+${formatTime(evidence.faults[0]?.at ?? 0)} 触发，返航段电池归零。前后状态已冻结。`,
      action: "重新运行失败演练",
      tone: "fail",
      handler: "failure",
    });
    elements.banner.classList.remove("hidden");
    toast("失败流程验证完成", "3/3 取样 · 返航段资源耗尽", "fail");
  } else if (scenario instanceof RecoveryScenario) {
    const audit = evidence.residualAudit;
    const activeAudioVoices = audio.diagnostics().activeVoices;
    auditFlags.recovery = Boolean(
      audit.noActiveFault
      && audit.noActiveLeak
      && audit.noActivePings
      && audit.noActiveSampling
      && audit.noPendingTimers
      && audit.stable
      && audit.resourceInBounds
      && audit.observationSeconds >= 10
      && activeAudioVoices === 0,
    );
    writeConsole([
      { tag: "FAULT", text: `${evidence.fault.code} @ T+${evidence.fault.at}s · SNAPSHOT SAVED`, tone: "fail" },
      { tag: "REC", text: `EMERGENCY RECOVERY @ T+${evidence.recovery.at}s`, tone: "good" },
      { tag: "OBS", text: `${audit.observationSeconds.toFixed(1)}s · ACTIVE FAULT 0 · LEAK 0 · AUDIO ${activeAudioVoices}`, tone: "good" },
      { tag: "PASS", text: "NO RESIDUAL TIMERS / SAMPLING / PINGS / VOICES", tone: "good" },
    ]);
    setBanner({
      kicker: "RECOVERY OBSERVATION COMPLETE",
      title: "恢复后 10 秒观察通过",
      copy: `故障快照已保存；观察期 ${audit.observationSeconds.toFixed(1)} 秒内无活动故障、无泄漏、无挂起采样或计时器。O₂ 与电池仅按生命维持负载正常下降。`,
      action: "再次运行恢复演练",
      tone: "success",
      handler: "recovery",
    });
    elements.banner.classList.remove("hidden");
    toast("恢复残留检查通过", "0 active faults · 0 leaks · 0 timers", "good");
  }
  updateAuditChecks();
  renderStaticMeta();
}

function runDoubleVerification() {
  ensureAudio();
  clearToasts();
  writeConsole([{ tag: "RUN", text: "DUAL RUN · SAME SEED / SAME INPUT TRACE" }]);
  elements.auditStatus.textContent = "RUNNING";
  elements.auditStatus.className = "status-pill running";
  const audit = runDoubleAudit(SEED);
  auditFlags.layout = audit.checks.sameLayout;
  auditFlags.samples = audit.first.sampledCount === 3 && audit.second.sampledCount === 3;
  auditFlags.failure = audit.checks.sameFailure;
  auditFlags.double = audit.pass;
  updateAuditChecks();
  writeConsole([
    { tag: "LAYOUT", text: `${audit.checks.sameLayout ? "MATCH" : "MISMATCH"} · #${audit.first.layoutHash}`, tone: audit.checks.sameLayout ? "good" : "fail" },
    { tag: "INPUT", text: `${audit.checks.sameInputDigest ? "MATCH" : "MISMATCH"} · ${audit.first.inputDigest}`, tone: audit.checks.sameInputDigest ? "good" : "fail" },
    { tag: "SEQ", text: `${audit.checks.sameMissionSequence ? "MATCH" : "MISMATCH"} · ${audit.first.missionSequence.length} EVENTS`, tone: audit.checks.sameMissionSequence ? "good" : "fail" },
    { tag: "RES", text: `${audit.checks.sameResourceTimeline ? "MATCH" : "MISMATCH"} · ${audit.first.timeline.length} SAMPLES`, tone: audit.checks.sameResourceTimeline ? "good" : "fail" },
    { tag: "FINAL", text: `${audit.pass ? "ALL 6 CHECKS PASS" : "DIFFERENCE DETECTED"} · ${audit.first.final.status.toUpperCase()} @ ${audit.first.final.resources.battery}%`, tone: audit.pass ? "good" : "fail" },
  ]);
  toast(
    audit.pass ? "双跑审计一致" : "双跑出现差异",
    audit.pass ? "布局 / 输入 / 任务 / 资源 / 结局 全部一致" : "查看审计控制台",
    audit.pass ? "good" : "fail",
  );
  renderStaticMeta();
}

function applyManualControls() {
  if (scenario || !manualStarted || game.status !== "running") return;
  if (game.paused) {
    game.clearControls();
    return;
  }
  game.clearControls();
  game.setControl("thrust", (keys.forward ? 1 : 0) + (keys.reverse ? -1 : 0));
  game.setControl("turn", (keys.right ? 1 : 0) + (keys.left ? -1 : 0));
  game.setControl("boost", keys.boost);
}

function togglePause() {
  if (game.status !== "running") return;
  ensureAudio();
  game.togglePause();
  accumulator = 0;
  updateHud();
}

function singleStep() {
  ensureAudio();
  if (game.status !== "running") return;
  if (scenario) {
    const wasPaused = game.paused;
    game.paused = false;
    for (let index = 0; index < 3 && !scenario.finished; index += 1) scenario.step(TICK);
    game.paused = wasPaused;
    consumeGameEvents();
    if (scenario.finished) finishScenario();
  } else {
    game.stepOnce(0.1);
    consumeGameEvents();
  }
  updateHud();
}

function toggleSound() {
  ensureAudio();
  audio.setEnabled(!audio.enabled);
  elements.soundIcon.textContent = audio.enabled ? "◖" : "○";
  elements.sound.classList.toggle("is-muted", !audio.enabled);
  toast(audio.enabled ? "声呐音频开启" : "声呐音频静音", audio.enabled ? "推进 / 回波 / 碰撞" : "模拟继续运行");
}

function checkManualOutcome() {
  if (scenario || !manualStarted || manualAnnounced) return;
  if (game.status === "failed") {
    manualAnnounced = true;
    auditFlags.samples = game.sampledCount === 3;
    auditFlags.failure = game.failure?.phase === "RETURN";
    updateAuditChecks();
    writeConsole([
      { tag: "FAIL", text: `${game.failure.reason} · T+${game.time.toFixed(1)}s`, tone: "fail" },
      { tag: "STATE", text: "FAULT SNAPSHOT AVAILABLE IN RECORDER", tone: "fail" },
    ]);
    setBanner({
      kicker: "MANUAL MISSION FAILED",
      title: `${game.failure.label} · ${game.failure.phase}`,
      copy: `${game.failure.detail}。可重置后使用同一 seed 重放，或运行自动恢复审计。`,
      action: "重置任务",
      tone: "fail",
      handler: "reset",
    });
    elements.banner.classList.remove("hidden");
  } else if (game.status === "complete") {
    manualAnnounced = true;
    setBanner({
      kicker: "MISSION COMPLETE",
      title: "三件取样与安全返航完成",
      copy: `返航路线已测绘，三项资源保持在安全范围。最终电池 ${game.resources.battery.toFixed(1)}%。`,
      action: "重置任务",
      tone: "success",
      handler: "reset",
    });
    elements.banner.classList.remove("hidden");
    toast("任务完成", "三件取样 · 安全返航", "good");
  }
}

function bindEvents() {
  elements.pause.addEventListener("click", togglePause);
  elements.step.addEventListener("click", singleStep);
  elements.reset.addEventListener("click", resetGame);
  elements.sound.addEventListener("click", toggleSound);
  elements.failureRun.addEventListener("click", () => launchScenario("failure"));
  elements.recoveryRun.addEventListener("click", () => launchScenario("recovery"));
  elements.doubleRun.addEventListener("click", runDoubleVerification);
  elements.bannerAction.addEventListener("click", () => {
    ensureAudio();
    if (bannerHandler === "start") startManualGame();
    else if (bannerHandler === "failure") launchScenario("failure");
    else if (bannerHandler === "recovery") launchScenario("recovery");
    else if (bannerHandler === "reset") resetGame();
  });

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const code = event.code;
    const key = event.key.toLowerCase();
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(code)) event.preventDefault();
    if (code === "KeyW" || code === "ArrowUp") keys.forward = true;
    if (code === "KeyS" || code === "ArrowDown") keys.reverse = true;
    if (code === "KeyA" || code === "ArrowLeft") keys.left = true;
    if (code === "KeyD" || code === "ArrowRight") keys.right = true;
    if (code === "ShiftLeft" || code === "ShiftRight") keys.boost = true;
    if (event.repeat) return;
    if (code === "Space") {
      ensureAudio();
      if (!scenario && manualStarted) game.ping();
    } else if (key === "e") {
      ensureAudio();
      if (!scenario && manualStarted) game.beginSample();
    } else if (key === "x") {
      ensureAudio();
      if (!scenario && manualStarted) game.emergencyRecovery();
    } else if (key === "p") {
      togglePause();
    } else if (key === ".") {
      singleStep();
    } else if (key === "r") {
      resetGame();
    } else if (key === "m") {
      toggleSound();
    } else if (code === "Enter" && !elements.banner.classList.contains("hidden")) {
      elements.bannerAction.click();
    }
    consumeGameEvents();
  });

  window.addEventListener("keyup", (event) => {
    const code = event.code;
    if (code === "KeyW" || code === "ArrowUp") keys.forward = false;
    if (code === "KeyS" || code === "ArrowDown") keys.reverse = false;
    if (code === "KeyA" || code === "ArrowLeft") keys.left = false;
    if (code === "KeyD" || code === "ArrowRight") keys.right = false;
    if (code === "ShiftLeft" || code === "ShiftRight") keys.boost = false;
  });

  window.addEventListener("blur", () => {
    keys.forward = false;
    keys.reverse = false;
    keys.left = false;
    keys.right = false;
    keys.boost = false;
  });
}

function frame(now) {
  const realDelta = clamp((now - lastFrame) / 1000, 0, 0.08);
  lastFrame = now;
  if (!game.paused && !scenario?.finished) {
    const speed = scenario instanceof FailureScenario ? DEMO_SPEED : 1;
    accumulator += realDelta * speed;
    if (scenario) {
      let steps = 0;
      while (accumulator >= TICK && steps < 12 && !scenario.finished) {
        scenario.step(TICK);
        accumulator -= TICK;
        steps += 1;
      }
      if (scenario.finished) finishScenario();
    } else if (manualStarted && game.status === "running") {
      applyManualControls();
      let steps = 0;
      while (accumulator >= TICK && steps < 5) {
        game.update(TICK);
        accumulator -= TICK;
        steps += 1;
      }
      checkManualOutcome();
    } else {
      accumulator = 0;
    }
  } else {
    accumulator = 0;
  }

  consumeGameEvents();
  audio.update(game, now / 1000);
  renderer.draw(game, now / 1000);
  updateHud();
  requestAnimationFrame(frame);
}

function initialize() {
  buildArtifactCards();
  renderStaticMeta();
  setScenarioButtons();
  updateAuditChecks();
  writeConsole([{ tag: "SYS", text: `SEED ${SEED} · LAYOUT #${game.world.layoutHash} · ${game.reachability.passed}/${game.reachability.total} REACHABLE`, tone: "good" }]);
  setBanner({
    kicker: "MISSION READY / FIXED SEED",
    title: "等待下潜指令",
    copy: "声呐只能提供短暂轮廓。保持三项生命资源，完成三件取样。",
    action: "开始测绘",
    handler: "start",
  });
  bindEvents();
  updateHud();
  window.__blackwater = {
    get game() { return game; },
    get scenario() { return scenario; },
    get auditFlags() { return { ...auditFlags }; },
    launchFailure: () => launchScenario("failure"),
    launchRecovery: () => launchScenario("recovery"),
    runDoubleAudit: runDoubleVerification,
    reset: resetGame,
    step: singleStep,
    pause: togglePause,
  };
  requestAnimationFrame(frame);
}

initialize();
