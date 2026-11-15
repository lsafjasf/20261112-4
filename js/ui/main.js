// UI wiring: game loop, pause/step/reset, scenario replay, in-page verification.
import { createSim, schedule, step, issue, stateHash, SIM_TICKS } from '../core/sim.js';
import { failureScenario, successScenario, SEED } from '../core/scenarios.js';
import { W, H, CELL, idx } from '../core/terrain.js';
import { createRenderer } from './render.js';
import { createAudio } from './audio.js';

const canvas = document.getElementById('map');
const renderer = createRenderer(canvas);
const audio = createAudio();
const el = id => document.getElementById(id);

let sim = createSim(SEED);
let paused = true;
let speed = 4;
let selected = 'truck0';
let digMode = false;
let digStart = null;
let renderedEvents = 0;

function reset() {
  sim = createSim(SEED);
  renderedEvents = 0;
  el('log').innerHTML = '';
  setStatus('就绪');
  paused = true;
  el('btnPause').textContent = '继续';
}

function setStatus(text) { el('status').textContent = text; }

function loadScenario(scenario) {
  reset();
  for (const { tick, cmd } of scenario.commands) schedule(sim, tick, cmd);
  paused = false;
  el('btnPause').textContent = '暂停';
  setStatus(`回放场景: ${scenario.name}`);
  logLine('info', `已加载场景 ${scenario.name}(${scenario.commands.length} 条指令)`);
}

// --- Controls ---
el('btnPause').onclick = () => {
  paused = !paused;
  el('btnPause').textContent = paused ? '继续' : '暂停';
};
el('btnStep').onclick = () => {
  if (!paused) el('btnPause').click();
  step(sim);
  render();
};
el('btnReset').onclick = reset;
el('speed').onchange = e => { speed = +e.target.value; };
el('audioOn').onchange = e => audio.toggle(e.target.checked);
el('btnRunFail').onclick = () => loadScenario(failureScenario());
el('btnRunWin').onclick = () => loadScenario(successScenario());
el('btnVerify').onclick = () => {
  const ok = verifyDeterminism();
  logLine(ok ? 'ok' : 'warn', ok ? '一致性校验通过: 两次运行结果完全相同' : '一致性校验失败!');
  setStatus(ok ? '校验通过' : '校验失败');
};

window.addEventListener('keydown', e => {
  if (e.key === '1') selected = 'truck0';
  else if (e.key === '2') selected = 'truck1';
  else if (e.key === '3') selected = 'drone';
  else if (e.key === 'b' || e.key === 'B') digMode = !digMode;
  else if (e.key === ' ') { e.preventDefault(); el('btnPause').click(); }
  else if (e.key === 'Escape') { if (!sim.crew.trapped) issue(sim, { type: 'evacuate' }); }
});

// --- Mouse commands ---
function cellAt(e) {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / CELL);
  const y = Math.floor((e.clientY - r.top) / CELL);
  return (x >= 0 && y >= 0 && x < W && y < H) ? idx(x, y) : -1;
}
canvas.addEventListener('mousedown', e => {
  const cell = cellAt(e);
  if (cell < 0) return;
  if (digMode) digStart = cell;
});
canvas.addEventListener('mouseup', e => {
  const cell = cellAt(e);
  if (cell < 0) return;
  if (digMode && digStart !== null) {
    const cells = lineCells(digStart, cell);
    issue(sim, { type: 'dig', cells });
    digStart = null;
    return;
  }
  if (selected === 'drone') {
    issue(sim, { type: 'drone', cell });
  } else {
    const id = selected === 'truck0' ? 0 : 1;
    issue(sim, { type: 'truck', id, cell });
  }
});

function lineCells(a, b) {
  const cells = [];
  let x0 = a % W, y0 = (a / W) | 0;
  const x1 = b % W, y1 = (b / W) | 0;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    cells.push(idx(x0, y0));
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    else { err += dx; y0 += sy; }
  }
  return cells;
}

// --- Headless double-run determinism check (same input, twice) ---
function verifyDeterminism() {
  for (const scenario of [failureScenario(), successScenario()]) {
    const runs = [0, 1].map(() => {
      const s = createSim(scenario.seed);
      for (const { tick, cmd } of scenario.commands) schedule(s, tick, cmd);
      let guard = 0;
      while (s.status === 'running' && guard++ < SIM_TICKS + 10) step(s);
      return { events: JSON.stringify(s.events), hash: stateHash(s), status: s.status };
    });
    const same = runs[0].events === runs[1].events
      && runs[0].hash === runs[1].hash
      && runs[0].status === runs[1].status;
    logLine(same ? 'ok' : 'warn',
      `${scenario.name}: ${same ? '两次运行一致' : '两次运行不一致'} (status=${runs[0].status}, hash=${runs[0].hash})`);
    if (!same) return false;
  }
  return true;
}

// --- Rendering & panels ---
const EVENT_CLASS = {
  crewTrapped: 'warn', lost: 'warn', crewDanger: 'warn', truckEmpty: 'warn',
  won: 'ok', crewSafe: 'ok', breakDone: 'ok', extinguished: 'ok',
};

function logLine(cls, text) {
  const div = document.createElement('div');
  div.className = cls || '';
  div.textContent = text;
  const log = el('log');
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function flushEvents() {
  for (; renderedEvents < sim.events.length; renderedEvents++) {
    const e = sim.events[renderedEvents];
    const t = `T+${fmtTime(e.tick)}`;
    logLine(EVENT_CLASS[e.type] || 'info', `${t} ${describe(e)}`);
  }
}

function describe(e) {
  switch (e.type) {
    case 'ignition': return `三处起火点被点燃`;
    case 'spread': return `火势蔓延 ${e.count} 格`;
    case 'cmdTruck': return `水车 ${e.id} 前往目标区域`;
    case 'truckArrive': return `水车 ${e.id} 就位开始洒水`;
    case 'truckEmpty': return `水车 ${e.id} 水尽返航`;
    case 'truckRefilled': return `水车 ${e.id} 补水完成`;
    case 'extinguished': return `水车 ${e.id} 扑灭一处火点`;
    case 'cmdDig': return `开挖组受命开挖 ${e.cells} 格防火带`;
    case 'digStart': return `开挖组开始挖掘`;
    case 'breakDone': return `防火带完成一格`;
    case 'crewDanger': return `警告: 开挖组接近火线!`;
    case 'crewTrapped': return `开挖组被火围困!`;
    case 'cmdEvacuate': return `开挖组撤离`;
    case 'crewSafe': return `开挖组抵达安全道路`;
    case 'cmdDrone': return `无人机前往侦察`;
    case 'droneArrive': return `无人机就位扫描`;
    case 'won': return `成功: ${e.reason}`;
    case 'lost': return `失败: ${e.reason}`;
    default: return e.type;
  }
}

function fmtTime(tick) {
  const mins = Math.floor(tick * 30 / 60);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

function render() {
  renderer.draw(sim, selected, digMode);
  flushEvents();
  el('clock').textContent = `T+${fmtTime(sim.tick)} / 04:00`;
  if (sim.status !== 'running') {
    setStatus(sim.status === 'won' ? `成功: ${sim.events.at(-1).reason}` : `失败: ${sim.lostReason}`);
  }
  el('resources').innerHTML =
    sim.trucks.map(t =>
      `<div>水车${t.id}: 水量 ${t.water}/100 · ${modeName(t.mode)}</div>`).join('') +
    `<div>开挖组: ${sim.crew.trapped ? '被困!' : sim.crew.evacuating ? '撤离中' : sim.crew.queue.length ? `待挖 ${sim.crew.queue.length} 格` : '待命'}</div>` +
    `<div>无人机: ${sim.drone.mode === 'scanning' ? '扫描中' : sim.drone.mode === 'flying' ? '飞行中' : '待命'}</div>`;
  let burning = 0;
  for (let i = 0; i < W * H; i++) if (sim.ter.fuel[i] === 1) burning++;
  el('env').innerHTML =
    `<div>风速 ${sim.wind.speed.toFixed(1)} · 风向 ${(sim.wind.dir * 180 / Math.PI).toFixed(0)}°</div>` +
    `<div>火点 ${burning} 格 · 状态哈希 ${stateHash(sim)}</div>`;
}

function modeName(m) {
  return { idle: '待命', moving: '行驶', spraying: '洒水', returning: '返航', refilling: '补水' }[m] || m;
}

// --- Main loop ---
let last = performance.now();
function frame(now) {
  const dt = (now - last) / 1000;
  last = now;
  if (!paused && sim.status === 'running') {
    for (let i = 0; i < speed && sim.status === 'running'; i++) step(sim);
  }
  audio.update(sim, dt);
  render();
  requestAnimationFrame(frame);
}
reset();
setStatus('就绪 — 选择场景或手动指挥');
requestAnimationFrame(frame);
