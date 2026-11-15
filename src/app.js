import { WaterAudio } from './audio.js';
import { digest, stableStringify, verificationPayload } from './digest.js';
import {
  buildReservoirSummaries,
  buildStationSummaries,
  createSimulation,
  enqueueCommand,
  runSimulation,
  tickSimulation,
} from './engine.js';
import { buildAuditReport, downloadText, stationsToCsv } from './export.js';
import {
  DEFAULT_SCENARIO_ID,
  getScenario,
  listScenarios,
} from './scenarios.js';
import {
  RECOVERY_WATCH_SECONDS,
  RESERVOIRS,
  RESERVOIR_IDS,
  SIM_DURATION_SECONDS,
  STATIONS,
  STATION_IDS,
  formatClock,
} from './model.js';
import { renderCanvas } from './renderer.js';

const $ = (id) => document.getElementById(id);
const els = {
  canvas: $('networkCanvas'),
  simClock: $('simClock'),
  pauseBtn: $('pauseBtn'),
  stepBtn: $('stepBtn'),
  resetBtn: $('resetBtn'),
  speedSelect: $('speedSelect'),
  soundBtn: $('soundBtn'),
  runStatus: $('runStatus'),
  scenarioSelect: $('scenarioSelect'),
  scenarioDescription: $('scenarioDescription'),
  kpiRain: $('kpiRain'),
  kpiPumpFlow: $('kpiPumpFlow'),
  kpiWtp: $('kpiWtp'),
  kpiWatch: $('kpiWatch'),
  kpiWatchDetail: $('kpiWatchDetail'),
  pumpControls: $('pumpControls'),
  reservoirControls: $('reservoirControls'),
  priorityLabel: $('priorityLabel'),
  burstState: $('burstState'),
  isolateBtn: $('isolateBtn'),
  repairBtn: $('repairBtn'),
  eventFeed: $('eventFeed'),
  eventCount: $('eventCount'),
  resultBody: $('resultBody'),
  resultBadge: $('resultBadge'),
  verificationBox: $('verificationBox'),
  verifyBtn: $('verifyBtn'),
  csvBtn: $('csvBtn'),
  auditBtn: $('auditBtn'),
};

const audio = new WaterAudio();
let state = createSimulation(getScenario(DEFAULT_SCENARIO_ID));
let paused = false;
let speed = Number(els.speedSelect.value);
let accumulator = 0;
let lastFrame = performance.now();
let lastInterfaceUpdate = 0;
let lastEventId = '';
let priorityDraft = [...state.priority];
let lastVerification = null;
let verificationRunId = 0;
let lastRenderedEventCount = -1;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function signedNumber(value, digits = 1) {
  return Number(value).toFixed(digits);
}

function makeRange(id, label, value, min = 0, max = 100) {
  return `<input id="${id}" type="range" min="${min}" max="${max}" step="1" value="${value}" aria-label="${label}">`;
}

function buildPumpControls() {
  els.pumpControls.innerHTML = STATION_IDS.map((id) => {
    const station = STATIONS[id];
    return `
      <article class="pump-row" data-pump="${id}">
        <div class="control-main">
          <div class="control-name">${id} ${station.short}<small>${station.capacityM3s.toFixed(1)} m³/s 额定</small></div>
          ${makeRange(`pump-${id}`, `${station.name}泵速`, station.initialSpeed)}
          <output class="control-value" id="pump-value-${id}">--</output>
        </div>
        <div class="control-meta">
          <span id="pump-flow-${id}">流量 --</span>
          <span id="pump-pending-${id}">就绪</span>
        </div>
      </article>`;
  }).join('');

  for (const id of STATION_IDS) {
    $(`pump-${id}`).addEventListener('input', (event) => {
      $(`pump-value-${id}`).textContent = `${event.target.value}%`;
      paintRange(event.target);
    });
    $(`pump-${id}`).addEventListener('change', (event) => {
      enqueueCommand(state, { type: 'setPump', station: id, value: Number(event.target.value) });
      updateInterface(true);
    });
  }
}

function buildReservoirControls() {
  els.reservoirControls.innerHTML = RESERVOIR_IDS.map((id) => {
    const reservoir = RESERVOIRS[id];
    return `
      <article class="reservoir-row" data-reservoir="${id}">
        <div class="control-main">
          <div class="control-name">${id} ${reservoir.short}<small>闸门开度</small></div>
          ${makeRange(`gate-${id}`, `${reservoir.name}闸门`, reservoir.initialGate)}
          <output class="control-value" id="gate-value-${id}">--</output>
        </div>
        <div class="control-meta">
          <span id="res-level-${id}">水位 --</span>
          <div class="priority-tools">
            <button type="button" data-priority="up" data-reservoir="${id}" aria-label="提高${reservoir.name}优先级">↑</button>
            <span class="priority-rank" id="priority-rank-${id}">P--</span>
            <button type="button" data-priority="down" data-reservoir="${id}" aria-label="降低${reservoir.name}优先级">↓</button>
          </div>
        </div>
      </article>`;
  }).join('');

  for (const id of RESERVOIR_IDS) {
    $(`gate-${id}`).addEventListener('input', (event) => {
      $(`gate-value-${id}`).textContent = `${event.target.value}%`;
      paintRange(event.target);
    });
    $(`gate-${id}`).addEventListener('change', (event) => {
      enqueueCommand(state, { type: 'setGate', reservoir: id, value: Number(event.target.value) });
      updateInterface(true);
    });
  }
  els.reservoirControls.querySelectorAll('[data-priority]').forEach((button) => {
    button.addEventListener('click', () => movePriority(button.dataset.reservoir, button.dataset.priority));
  });
}

function movePriority(reservoirId, direction) {
  const index = priorityDraft.indexOf(reservoirId);
  const next = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || next < 0 || next >= priorityDraft.length) return;
  [priorityDraft[index], priorityDraft[next]] = [priorityDraft[next], priorityDraft[index]];
  enqueueCommand(state, { type: 'setPriority', order: [...priorityDraft] });
  updateInterface(true);
}

function paintRange(input) {
  const percent = ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
  input.style.background = `linear-gradient(90deg, rgba(45,212,191,.8) ${percent}%, rgba(77,216,238,.18) ${percent}%)`;
}

function loadScenario(scenarioId, autoStart = true) {
  const scenario = getScenario(scenarioId);
  state = createSimulation(scenario);
  priorityDraft = [...state.priority];
  accumulator = 0;
  paused = !autoStart;
  lastEventId = '';
  lastRenderedEventCount = -1;
  lastVerification = null;
  els.verificationBox.classList.add('hidden');
  els.verificationBox.classList.remove('failed');
  syncScenarioDescription();
  updateInterface(true);
}

function syncScenarioDescription() {
  const scenario = getScenario(els.scenarioSelect.value);
  els.scenarioDescription.textContent = scenario.description;
  els.scenarioSelect.value = state.scenarioId;
}

function controlValueText(pump) {
  return `${pump.speed.toFixed(0)}%`;
}

function watchStatus() {
  const watch = state.recoveryWatch;
  if (watch.startedAt === null) {
    return { main: '未触发', detail: `${watch.requiredSec / 60} min 固定` };
  }
  if (watch.completedAt === null) {
    const remaining = Math.max(0, watch.endsAt - state.timeSec);
    return { main: '观察中', detail: `剩余 ${formatClock(remaining)}` };
  }
  return watch.clean
    ? { main: '无残留', detail: `${watch.requiredSec / 60} min 已通过` }
    : { main: '发现残留', detail: `${watch.requiredSec / 60} min 未通过` };
}

function updateInterface(force = false) {
  const now = performance.now();
  if (!force && now - lastInterfaceUpdate < 110) return;
  lastInterfaceUpdate = now;
  const isFinished = Boolean(state.result);
  els.simClock.textContent = formatClock(state.timeSec);
  els.kpiRain.textContent = state.rainfallMmH.toFixed(1);
  const totalFlow = STATION_IDS.reduce((sum, id) => sum + state.pumps[id].flowM3s, 0);
  els.kpiPumpFlow.textContent = totalFlow.toFixed(2);
  els.kpiWtp.textContent = state.wtpInflowM3s.toFixed(2);
  const watch = watchStatus();
  els.kpiWatch.textContent = watch.main;
  els.kpiWatchDetail.textContent = watch.detail;

  els.runStatus.className = `status-pill ${state.result ? state.result.status : paused ? 'paused' : 'running'}`;
  els.runStatus.textContent = state.result
    ? state.result.passed ? '演练通过' : '演练失败'
    : paused ? '已暂停' : '运行中';
  els.pauseBtn.textContent = paused ? '继续' : '暂停';
  els.pauseBtn.disabled = isFinished;
  els.stepBtn.disabled = isFinished;

  for (const id of STATION_IDS) {
    const pump = state.pumps[id];
    const slider = $(`pump-${id}`);
    slider.disabled = isFinished;
    if (document.activeElement !== slider) slider.value = pump.targetSpeed;
    $(`pump-value-${id}`).textContent = controlValueText(pump);
    $(`pump-flow-${id}`).textContent = `实际 ${pump.speed.toFixed(0)}% · ${pump.flowM3s.toFixed(1)} m³/s`;
    const pending = state.pendingCommands.filter((task) => task.target === id);
    const pendingEl = $(`pump-pending-${id}`);
    pendingEl.textContent = pending.length
      ? `延迟执行 ${Math.max(0, pending[0].effectiveAt - state.timeSec)}s`
      : '就绪';
    pendingEl.className = pending.length ? 'pending' : '';
    paintRange(slider);
  }

  for (const id of RESERVOIR_IDS) {
    const reservoir = state.reservoirs[id];
    const slider = $(`gate-${id}`);
    slider.disabled = isFinished;
    if (document.activeElement !== slider) slider.value = reservoir.targetGate;
    $(`gate-value-${id}`).textContent = `${reservoir.gate.toFixed(0)}%`;
    $(`res-level-${id}`).textContent = `水位 ${(reservoir.level * 100).toFixed(1)}% · 闸 ${reservoir.gate.toFixed(0)}%`;
    $(`priority-rank-${id}`).textContent = `P${priorityDraft.indexOf(id) + 1}`;
    paintRange(slider);
  }
  els.reservoirControls.querySelectorAll('[data-priority]').forEach((button) => {
    button.disabled = isFinished;
  });
  els.priorityLabel.textContent = `优先级 ${priorityDraft.join(' → ')}`;

  const burst = state.burst;
  els.burstState.textContent = burst
    ? burst.status === 'active' ? `${burst.segment} 爆管` : burst.status === 'isolated' ? `${burst.segment} 已隔离` : `${burst.segment} 已修复`
    : '无爆管';
  els.burstState.style.color = burst && burst.status === 'active' ? 'var(--red)' : burst ? 'var(--yellow)' : '';
  els.isolateBtn.disabled = isFinished || !(burst?.status === 'active')
    || state.pendingCommands.some((task) => task.type === 'isolateBurst');
  els.repairBtn.disabled = isFinished || !(burst?.status === 'isolated')
    || state.pendingCommands.some((task) => task.type === 'repairBurst');

  const eventSignature = `${state.eventSeq}:${state.events.length}`;
  if (lastEventId !== eventSignature) {
    lastEventId = eventSignature;
    renderEvents();
  }
  renderResult();
}

function renderEvents() {
  els.eventCount.textContent = `${state.eventSeq} EVENTS`;
  if (state.eventSeq === lastRenderedEventCount) return;
  lastRenderedEventCount = state.eventSeq;
  const events = state.events.slice(-64).reverse();
  els.eventFeed.innerHTML = events.map((event) => `
    <div class="event-row ${event.level}">
      <time>${event.clock}</time>
      <span class="event-code">${escapeHtml(event.code)}</span>
      <span>${escapeHtml(event.message)}</span>
    </div>`).join('');
}

function snapshotLine(snapshot, side) {
  if (!snapshot) return '';
  return `<div class="result-note"><strong>${side}</strong> 压力 N/C/L ${snapshot.pressure.north.toFixed(2)} / ${snapshot.pressure.central.toFixed(2)} / ${snapshot.pressure.lowland.toFixed(2)} bar · P2 ${snapshot.pumpSpeeds.P2.toFixed(0)}% · 河堤路积水 ${snapshot.facilityFloodM3.D2.toFixed(1)} m³ · 积压指令 ${snapshot.pendingCommands}</div>`;
}

function renderResult() {
  const badge = els.resultBadge;
  if (state.result) {
    badge.className = `result-badge ${state.result.status}`;
    badge.textContent = state.result.passed ? '通过' : '失败';
    const results = state.result;
    const watch = results.checks.recoveryWatch;
    const fault = state.faultRecords.at(-1);
    const dryCount = Object.values(state.facilities).filter((facility) => !facility.flooded).length;
    const recoveryText = watch.completed
      ? watch.clean ? '30 分钟观察通过' : '观察窗存在残留'
      : watch.startedAt === null ? '未触发恢复观察' : '观察窗进行中';
    const recoveryClass = watch.completed && watch.clean ? 'clean' : watch.completed ? 'issue' : '';
    els.resultBody.innerHTML = `
      <div class="result-grid">
        <div class="result-stat"><span>演练终点</span><strong>${results.finishedClock}</strong></div>
        <div class="result-stat"><span>关键设施</span><strong>${dryCount} / 4 未进水</strong></div>
        <div class="result-stat"><span>故障事件</span><strong>${results.checks.burstIncidents} 起</strong></div>
        <div class="result-stat"><span>累计抽水</span><strong>${results.totals.pumpedM3.toFixed(0)} m³</strong></div>
        <div class="result-stat"><span>总能耗</span><strong>${results.totals.energyKWh.toFixed(0)} kWh</strong></div>
        <div class="result-stat"><span>恢复观察</span><strong>${recoveryText}</strong></div>
      </div>
      <p class="result-note">${escapeHtml(results.reason)}</p>
      ${fault ? `<p class="result-note"><strong>${fault.id} / ${fault.segment} ${fault.segmentName}</strong> ${fault.detectedClock} 触发，${fault.resolution?.isolated ? `${fault.resolution.isolated.clock} 隔离` : '未隔离'}${fault.resolution?.repaired ? `，${fault.resolution.repaired.clock} 修复` : ''}</p>` : ''}
      ${fault ? snapshotLine(fault.before, '触发前') : ''}
      ${fault ? snapshotLine(fault.after, '触发后') : ''}
      <div class="recovery-strip ${recoveryClass}">
        <strong>恢复观察</strong>
        <span>${watch.completed ? `${watch.samples} 个采样` : watch.startedAt === null ? '未开始' : `剩余 ${formatClock(Math.max(0, watch.endsAt - state.timeSec))}`}</span>
        <span>${watch.clean === null ? '待判定' : watch.clean ? '积压指令 0 · 异常状态 0' : escapeHtml(watch.issues.map((issue) => issue.message).join('；'))}</span>
      </div>`;
    return;
  }

  badge.className = 'result-badge neutral';
  badge.textContent = paused ? '已暂停' : '进行中';
  const fault = state.faultRecords.at(-1);
  if (fault) {
    els.resultBody.innerHTML = `
      <p class="result-note"><strong>${fault.id} / ${fault.segment}</strong> ${fault.detectedClock} 爆管 · ${state.burst.status === 'active' ? '等待隔离' : state.burst.status === 'isolated' ? '已隔离，等待修复' : '已修复，观察中'}</p>
      ${snapshotLine(fault.before, '触发前')}
      ${snapshotLine(fault.after, '触发后')}
      <div class="recovery-strip ${state.recoveryWatch.issues.length ? 'issue' : ''}">
        <strong>恢复观察 ${state.recoveryWatch.requiredSec / 60} 分钟</strong>
        <span>${state.recoveryWatch.startedAt === null ? '修复完成后启动' : `剩余 ${formatClock(Math.max(0, state.recoveryWatch.endsAt - state.timeSec))}`}</span>
      </div>`;
  } else {
    els.resultBody.innerHTML = `<p class="empty-state">完成 6 小时演练后显示关键设施、故障快照和恢复观察结论。当前 ${state.alerts.filter((alert) => alert.severity === 'critical').length} 个严重告警。</p>`;
  }
}

function verificationSummaryText(result) {
  const fault = result.faultRecords.at(-1);
  const watch = result.checks.recoveryWatch;
  if (!fault) return '无爆管；场景按确定性脚本结束';
  const resolution = fault.resolution ?? {};
  return `${fault.segment} 于 ${fault.detectedClock} 爆管；${resolution.isolated ? '已隔离' : '未隔离'}${resolution.repaired ? '、已修复' : ''}；${watch.completed ? `观察 ${watch.samples} 样本，${watch.clean ? '无残留' : '有残留'}` : '未完成恢复观察'}`;
}

async function verifyDeterminism(silent = false) {
  verificationRunId += 1;
  const runId = verificationRunId;
  const scenarioId = state.scenarioId;
  const input = getScenario(scenarioId);
  if (!silent) {
    els.verifyBtn.disabled = true;
    els.verifyBtn.textContent = '双跑执行中…';
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const first = runSimulation(getScenario(scenarioId));
  const second = runSimulation(getScenario(scenarioId));
  if (runId !== verificationRunId) return;
  if (!first.result || !second.result) throw new Error('Determinism run did not finish');
  const firstPayload = verificationPayload(first.result);
  const secondPayload = verificationPayload(second.result);
  const taskDigestA = digest(firstPayload.taskSequence);
  const taskDigestB = digest(secondPayload.taskSequence);
  const resourceDigestA = digest(firstPayload.resources);
  const resourceDigestB = digest(secondPayload.resources);
  const finalDigestA = digest(firstPayload.final);
  const finalDigestB = digest(secondPayload.final);
  const same = stableStringify(firstPayload) === stableStringify(secondPayload);
  lastVerification = {
    scenarioId,
    scenarioName: input.name,
    inputHash: digest(input),
    same,
    taskDigestA,
    taskDigestB,
    resourceDigestA,
    resourceDigestB,
    finalDigestA,
    finalDigestB,
    firstOutcome: first.result.status,
    secondOutcome: second.result.status,
    firstReason: first.result.reason,
    secondReason: second.result.reason,
    taskCount: first.result.taskSequence.length,
    burstCount: first.result.checks.burstIncidents,
    recoveryClean: first.result.checks.recoveryWatch.clean,
    recoverySamples: first.result.checks.recoveryWatch.samples,
    verificationText: verificationSummaryText(first.result),
  };
  renderVerification();
  els.verifyBtn.disabled = false;
  els.verifyBtn.textContent = '同输入双跑校验';
}

function renderVerification() {
  const check = lastVerification;
  if (!check) {
    els.verificationBox.classList.add('hidden');
    return;
  }
  els.verificationBox.classList.remove('hidden');
  els.verificationBox.classList.toggle('failed', !check.same);
  els.verificationBox.innerHTML = `
    <strong>${check.same ? '双跑一致' : '双跑不一致'}</strong>
    <span> · ${escapeHtml(check.scenarioName)} · ${check.firstOutcome} / ${check.secondOutcome}</span><br>
    输入 <code>#${check.inputHash}</code> · 任务 <code>${check.taskDigestA}</code> / <code>${check.taskDigestB}</code><br>
    资源 <code>${check.resourceDigestA}</code> / <code>${check.resourceDigestB}</code> · 结果 <code>${check.finalDigestA}</code> / <code>${check.finalDigestB}</code><br>
    ${escapeHtml(check.verificationText)}`;
}

function exportCsv() {
  const clock = formatClock(state.timeSec).replaceAll(':', '');
  const csv = stationsToCsv(state);
  downloadText(`站点运行摘要_${state.scenarioId}_${clock}.csv`, csv, 'text/csv;charset=utf-8');
}

function exportAudit() {
  const clock = formatClock(state.timeSec).replaceAll(':', '');
  const scenario = getScenario(state.scenarioId);
  const determinism = lastVerification?.scenarioId === state.scenarioId ? lastVerification : null;
  const report = buildAuditReport(state, {
    inputHash: digest(scenario),
    determinism,
  });
  downloadText(
    `水务审计_${state.scenarioId}_${clock}.json`,
    JSON.stringify(report, null, 2),
    'application/json;charset=utf-8',
  );
}

async function ensureAudio() {
  await audio.start();
  audio.setEnabled(!els.soundBtn.classList.contains('silent'));
}

function togglePause() {
  if (state.result) return;
  paused = !paused;
  accumulator = 0;
  updateInterface(true);
}

function singleStep() {
  if (state.result) return;
  paused = true;
  accumulator = 0;
  tickSimulation(state);
  updateInterface(true);
}

function frame(now) {
  const delta = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!paused && !state.result) {
    accumulator += delta * speed;
    let steps = 0;
    while (accumulator >= 1 && steps < 20 && !state.result) {
      tickSimulation(state);
      accumulator -= 1;
      steps += 1;
    }
  } else {
    accumulator = 0;
  }
  renderCanvas(els.canvas, state, now);
  audio.update(state);
  updateInterface();
  requestAnimationFrame(frame);
}

function bindEvents() {
  els.scenarioSelect.addEventListener('change', () => {
    loadScenario(els.scenarioSelect.value, true);
    void verifyDeterminism(true);
  });
  els.pauseBtn.addEventListener('click', togglePause);
  els.stepBtn.addEventListener('click', singleStep);
  els.resetBtn.addEventListener('click', () => {
    loadScenario(state.scenarioId, true);
    void verifyDeterminism(true);
  });
  els.speedSelect.addEventListener('change', () => {
    speed = Number(els.speedSelect.value);
    accumulator = 0;
  });
  els.soundBtn.addEventListener('click', async () => {
    await ensureAudio();
    const silent = !els.soundBtn.classList.contains('silent');
    els.soundBtn.classList.toggle('silent', silent);
    els.soundBtn.classList.toggle('active', !silent);
    els.soundBtn.textContent = silent ? '声音关' : '声音开';
    audio.setEnabled(!silent);
  });
  els.isolateBtn.addEventListener('click', async () => {
    if (state.burst) enqueueCommand(state, { type: 'isolateBurst', segment: state.burst.segment });
    await ensureAudio();
    updateInterface(true);
  });
  els.repairBtn.addEventListener('click', async () => {
    if (state.burst) enqueueCommand(state, { type: 'repairBurst', segment: state.burst.segment });
    await ensureAudio();
    updateInterface(true);
  });
  els.verifyBtn.addEventListener('click', () => void verifyDeterminism(false));
  els.csvBtn.addEventListener('click', exportCsv);
  els.auditBtn.addEventListener('click', exportAudit);
  document.addEventListener('pointerdown', () => void ensureAudio(), { once: true, capture: true });
  document.addEventListener('visibilitychange', () => {
    lastFrame = performance.now();
    accumulator = 0;
  });
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || ['INPUT', 'SELECT', 'BUTTON'].includes(document.activeElement?.tagName)) return;
    event.preventDefault();
    togglePause();
  });
}

function init() {
  els.scenarioSelect.innerHTML = listScenarios()
    .map((scenario) => `<option value="${scenario.id}">${escapeHtml(scenario.name)}</option>`)
    .join('');
  els.scenarioSelect.value = state.scenarioId;
  buildPumpControls();
  buildReservoirControls();
  syncScenarioDescription();
  bindEvents();
  updateInterface(true);
  renderCanvas(els.canvas, state, performance.now());
  requestAnimationFrame(frame);
  setTimeout(() => void verifyDeterminism(true), 250);
}

init();
