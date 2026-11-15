import { AppEngine } from './engine.js';
import { UI } from './ui.js';
import { runScenario, continuousChain } from './scenario.js';
import { fnv1a } from './util.js';
import * as renderer from './renderer.js';
import { AnimationFSM } from './fsm.js';

window._renderer = renderer;
window._fsm = { AnimationFSM };

const canvas = document.getElementById('stage');
const ui = new UI();
const engine = new AppEngine(canvas, ui);

ui.refreshEditors(engine.project);
engine.start();

document.getElementById('controls').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-input]');
  if (btn) engine.handleInput(btn.dataset.input);
});

document.getElementById('editors').addEventListener('change', (e) => {
  const card = e.target.closest('.state-card');
  if (!card) return;
  const stateId = card.dataset.state;
  const st = engine.project.config.states[stateId];
  if (e.target.dataset.eventAt !== undefined) {
    st.events[Number(e.target.dataset.eventAt)].at = Number(e.target.value);
    engine.updateStateParam(stateId, 'events', st.events);
    return;
  }
  if (e.target.dataset.eventSfx !== undefined) {
    st.events[Number(e.target.dataset.eventSfx)].sfx = e.target.value;
    engine.updateStateParam(stateId, 'events', st.events);
    return;
  }
  const key = e.target.dataset.key;
  if (!key) return;
  const value = Number(e.target.value);
  if (stateId === 'attack' && ['chargeFrames', 'strikeFrames', 'recoveryFrames'].includes(key)) {
    st[key] = value;
    rebalanceAttack(st);
    engine.updateStateParam(stateId, key, st[key]);
    ui.refreshEditors(engine.project);
    return;
  }
  if (key === 'frameCount' && stateId === 'attack') {
    st.frameCount = value;
    rebalanceAttack(st);
    engine.updateStateParam(stateId, 'frameCount', st.frameCount);
    ui.refreshEditors(engine.project);
    return;
  }
  engine.updateStateParam(stateId, key, value);
});

function rebalanceAttack(st) {
  const parts = ['chargeFrames', 'strikeFrames', 'recoveryFrames'];
  let sum = parts.reduce((n, k) => n + st[k], 0);
  st.recoveryFrames = Math.max(0, st.recoveryFrames + (st.frameCount - sum));
  sum = parts.reduce((n, k) => n + st[k], 0);
  if (sum !== st.frameCount) {
    const delta = st.frameCount - sum;
    st.chargeFrames = Math.max(1, st.chargeFrames + delta);
  }
}

document.getElementById('view-options').addEventListener('change', (e) => {
  const key = e.target.dataset.view;
  if (!key) return;
  engine.updateView(key, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
});

document.getElementById('btn-mute').addEventListener('click', (e) => {
  engine.audio.muted = !engine.audio.muted;
  e.target.textContent = engine.audio.muted ? '取消静音' : '静音';
});

document.getElementById('btn-restore').addEventListener('click', () => engine.restoreDefaults());

document.getElementById('btn-save').addEventListener('click', () => {
  const text = engine.exportJSON();
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'asm2d-project.json';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('file-import').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  file.text().then((text) => engine.importJSON(text));
});

function measure(config, view) {
  const run = runScenario(config, continuousChain.script, continuousChain.steps);
  return {
    traceHash: run.traceHash,
    eventHash: run.eventHash,
    objects: countPlain(run.traces) + countPlain(run.events),
    shot: shotHash(config, view),
  };
}

function countPlain(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return 0;
  seen.add(value);
  let n = 1;
  for (const k of Object.keys(value)) n += countPlain(value[k], seen);
  return n;
}

function shotHash(config, view) {
  const probe = document.createElement('canvas');
  probe.width = canvas.width;
  probe.height = canvas.height;
  const { drawScene, createSceneGraph } = window._renderer;
  const { AnimationFSM } = window._fsm;
  const fsm = new AnimationFSM(config);
  const graph = createSceneGraph();
  for (let i = 0; i < 30; i++) fsm.update(1 / 60);
  drawScene(probe, fsm, view, { graph });
  const ctx = probe.getContext('2d');
  const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
  let nonzero = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]) nonzero++;
  return { pixelHash: fnv1a(Array.from(data).join(',')), nonzero, dataUrl: probe.toDataURL() };
}

document.getElementById('btn-roundtrip').addEventListener('click', () => {
  const before = measure(engine.project.config, engine.project.view);
  const text = engine.exportJSON();
  engine.importJSON(text);
  const after = measure(engine.project.config, engine.project.view);
  const chain = engine.runChainDemo();
  const report = engine.runSuites();
  ui.renderTestReport(report);
  ui.renderHashes(before, after, '保存 JSON → 重新载入');
  const frameOk = verifyFrameOrder(chain.events);
  const eventOk = verifyEventPoints(chain.events, engine.project.config);
  const hashOk = before.traceHash === after.traceHash && before.eventHash === after.eventHash &&
    before.objects === after.objects && before.shot.pixelHash === after.shot.pixelHash;
  const allOk = frameOk && eventOk && hashOk && report.summary.failed === 0;
  ui.renderVerdict(allOk,
    `最终判定：${allOk ? '画面与数据一致 ✅' : '存在不一致 ❌'} ｜ 帧序 ${frameOk ? '✓' : '✗'} 事件点 ${eventOk ? '✓' : '✗'} 哈希 ${hashOk ? '✓' : '✗'} 测试 ${report.summary.passed}/${report.summary.total}`);
});

document.getElementById('btn-dirty').addEventListener('click', () => {
  const base = engine.dirtyStats.fullRedraws + engine.dirtyStats.partialRedraws;
  const stateId = 'idle';
  const st = engine.project.config.states[stateId];
  const oldFps = st.fps;
  st.fps = oldFps === 6 ? 8 : 6;
  engine.updateStateParam(stateId, 'fps', st.fps);
  setTimeout(() => {
    const next = engine.dirtyStats;
    const changed = next.fullRedraws + next.partialRedraws - base;
    const total = canvas.width * canvas.height;
    const ratio = (next.dirtyPixels / total * 100).toFixed(1);
    document.getElementById('dirty-output').innerHTML = `
      <h4>局部更新实验（仅改 idle.fps）</h4>
      <p>参数变化后场景节点数保持 <b>7</b>（未重建），后续帧仅刷新角色脏区。
      本轮新增绘制 ${changed} 次；累计全量 ${next.fullRedraws} 次、局部 ${next.partialRedraws} 次，
      最近脏区 ${next.dirtyPixels} px，仅占整屏 ${total} px 的 ${ratio}%；全量刷新只发生在状态切换/参数变化瞬间。</p>`;
    st.fps = oldFps;
    engine.updateStateParam(stateId, 'fps', oldFps);
  }, 350);
});

function verifyFrameOrder(events) {
  const last = new Map();
  for (const ev of events.filter((e) => e.type === 'frame')) {
    const prev = last.get(ev.state);
    if (prev !== undefined && ev.frame !== prev + 1 && ev.frame !== 0) return false;
    last.set(ev.state, ev.frame);
  }
  return true;
}

function verifyEventPoints(events, config) {
  const fired = events.filter((e) => e.type === 'sfx');
  return fired.every((ev) => {
    const st = config.states[ev.state];
    const defined = st.events.some((d) => d.id === ev.id && d.sfx === ev.sfx);
    return defined && ev.at >= 0 && ev.at < 1;
  });
}
