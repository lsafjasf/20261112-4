import { AnimationFSM } from './fsm.js';
import { createSceneGraph, drawScene } from './renderer.js';
import { AudioBus } from './audio.js';
import { saveLocal, loadLocal, serializeProject, parseProject, clearLocal } from './storage.js';
import { defaultProject } from './defaults.js';
import { validateConfig } from './validate.js';
import { runScenario, continuousChain } from './scenario.js';
import { runAllSuites } from './run-tests.js';
import { fnv1a, snapshotHash } from './util.js';

export class AppEngine {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ui = ui;
    this.project = this.bootProject();
    this.fsm = new AnimationFSM(this.project.config);
    this.graph = createSceneGraph();
    this.audio = new AudioBus();
    this.running = true;
    this.lastTs = 0;
    this.lastEventCount = 0;
    this.dirtyStats = { fullRedraws: 0, partialRedraws: 0, dirtyPixels: 0, rebuilt: false };
    this.pendingRegion = null;
    this.lastRegion = null;
    this.chainLog = [];
  }

  bootProject() {
    try {
      const local = loadLocal();
      if (local) return local;
    } catch (err) {
      this.ui.flash('本地工程损坏，已回退默认工程: ' + err.message);
    }
    return defaultProject();
  }

  start() {
    const loop = (ts) => {
      const dt = this.lastTs ? Math.min(0.05, (ts - this.lastTs) / 1000) : 1 / 60;
      this.lastTs = ts;
      if (this.running) this.tick(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  tick(dt) {
    const before = this.fsm.snapshot();
    this.fsm.update(dt);
    this.consumeAudioEvents();
    this.render(before);
    this.ui.updateSummary(this.fsm, this.dirtyStats);
  }

  consumeAudioEvents() {
    const fresh = this.fsm.events.slice(this.lastEventCount);
    for (const ev of fresh) {
      if (ev.type === 'sfx') {
        this.audio.play(ev.sfx, ev.t);
        this.ui.logAudio(ev);
      } else if (ev.type === 'hitBlocked') {
        this.ui.logBlocked(ev);
      }
    }
    this.lastEventCount = this.fsm.events.length;
  }

  render(before) {
    const snap = this.fsm.snapshot();
    const stateChanged = before.state !== snap.state || this.pendingRegion === null;
    if (stateChanged) {
      drawScene(this.canvas, this.fsm, this.project.view, { graph: this.graph });
      this.dirtyStats.fullRedraws++;
      this.pendingRegion = 'full';
      this.lastRegion = { x: 0, y: 0, w: this.canvas.width, h: this.canvas.height };
      this.dirtyStats.dirtyPixels = this.canvas.width * this.canvas.height;
      return;
    }
    const regions = this.computeDirtyRegion(before, snap);
    drawScene(this.canvas, this.fsm, this.project.view, { graph: this.graph, dirtyRegion: regions });
    this.dirtyStats.partialRedraws++;
    this.dirtyStats.dirtyPixels = regions.reduce((sum, r) => sum + r.w * r.h, 0);
    this.lastRegion = regions;
  }

  markFullRedrawNeeded() {
    this.pendingRegion = null;
    this._lastCharacter = null;
    this.dirtyStats.rebuilt = false;
  }

  handleInput(name) {
    this.audio.resume();
    this.fsm.input(name);
    this.ui.logTransition(this.fsm.events.at(-1));
    this.markFullRedrawNeeded();
    this.tick(0);
  }

  updateStateParam(stateId, key, value) {
    const st = this.project.config.states[stateId];
    st[key] = value;
    const validation = validateConfig(this.project.config);
    if (!validation.ok) {
      this.ui.flash('参数未生效: ' + validation.errors.join('; '));
      return false;
    }
    this.markFullRedrawNeeded();
    const saved = saveLocal(this.project);
    this.ui.flash(saved.ok ? `${stateId}.${key}=${value} 已保存（局部参数热更新，场景节点未重建）` : '保存失败: ' + saved.error);
    return true;
  }

  updateView(key, value) {
    this.project.view[key] = value;
    this.markFullRedrawNeeded();
    saveLocal(this.project);
  }

  restoreDefaults() {
    clearLocal();
    this.project = defaultProject();
    this.fsm = new AnimationFSM(this.project.config);
    this.graph = createSceneGraph();
    this.dirtyStats = { fullRedraws: 0, partialRedraws: 0, dirtyPixels: 0, rebuilt: true };
    this.lastRegion = null;
    this.lastEventCount = 0;
    this.markFullRedrawNeeded();
    this.ui.flash('已一键恢复默认工程（含可视化对照参数）');
    this.ui.refreshEditors(this.project);
  }

  exportJSON() {
    return serializeProject(this.project);
  }

  importJSON(text) {
    const project = parseProject(text);
    this.project = project;
    this.fsm = new AnimationFSM(project.config);
    this.graph = createSceneGraph();
    this.lastEventCount = 0;
    this.dirtyStats.rebuilt = true;
    this.markFullRedrawNeeded();
    saveLocal(project);
    this.ui.refreshEditors(project);
    this.ui.flash('工程已重新载入，状态机与场景已按 JSON 重建');
  }

  runChainDemo() {
    const result = runScenario(this.project.config, continuousChain.script, continuousChain.steps);
    this.chainLog = result.events;
    this.ui.renderChain(result, this.project.config);
    return result;
  }

  runSuites() {
    return runAllSuites(this.project.view);
  }

  currentHashes() {
    return {
      traceHash: snapshotHash(this.fsm.snapshot()),
      eventHash: fnv1a(JSON.stringify(this.fsm.events)),
      graphNodes: this.graph.length,
      graphVersions: this.graph.map((n) => n.version),
    };
  }
  computeDirtyRegion(before, snap) {
    const dx = Math.abs(snap.x - before.x) * 0.6 + 40;
    const cy = this.canvas.height - 90;
    const character = {
      x: Math.max(0, this.canvas.width / 2 + Math.min(before.x, snap.x) * 0.6 - 46 - dx),
      y: Math.max(0, cy - 70),
      w: Math.min(this.canvas.width, 92 + dx * 2),
      h: Math.min(this.canvas.height, 154),
    };
    const regions = [character];
    if (this._lastCharacter) {
      regions.push({
        ...this._lastCharacter,
        w: this._lastCharacter.w + 12,
        x: this._lastCharacter.x - 6,
        y: Math.max(0, this._lastCharacter.y - 24),
        h: this._lastCharacter.h + 24,
      });
    }
    this._lastCharacter = character;
    const badge = { x: 0, y: 0, w: 220, h: 52 };
    const frameBar = { x: 0, y: this.canvas.height - 40, w: this.canvas.width, h: 40 };
    regions.push(badge, frameBar);
    return regions.map((r) => ({
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h),
    }));
  }
}
