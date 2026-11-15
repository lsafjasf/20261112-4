import { defaultConfig } from './defaults.js';
import { validateConfig } from './validate.js';
import { runScenario } from './scenario.js';
import { normalSuite, boundarySuite, failureSuite } from './scenario.js';
import { AnimationFSM } from './fsm.js';
import { snapshotHash } from './util.js';
import { drawScene } from './renderer.js';

const SUITES = [normalSuite, boundarySuite, failureSuite];

function clone(config) {
  return JSON.parse(JSON.stringify(config));
}

function countObjects(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  let n = 1;
  if (Array.isArray(value)) {
    for (const item of value) n += countObjects(item, seen);
  } else {
    for (const key of Object.keys(value)) n += countObjects(value[key], seen);
  }
  return n;
}

function makeFakeCanvas(width = 480, height = 300) {
  const grid = new Uint8Array(width * height * 4);
  return {
    width,
    height,
    grid,
    getContext() {
      return makeFakeContext(width, height, grid);
    },
    toDataURL() {
      let binary = '';
      for (let i = 0; i < grid.length; i += 4096) {
        binary += String.fromCharCode(...grid.subarray(i, i + 4096));
      }
      return 'data:application/octet-stream;base64,' + btoa(binary);
    },
  };
}

function makeFakeContext(width, height, grid) {
  let fill = [125, 211, 252, 255];
  const setPx = (x, y) => {
    const ix = Math.max(0, Math.min(width - 1, Math.round(x)));
    const iy = Math.max(0, Math.min(height - 1, Math.round(y)));
    const p = (iy * width + ix) * 4;
    grid.set(fill, p);
  };
  return {
    canvas: { width, height },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    set fillStyle(v) {
      if (typeof v === 'string' && v.startsWith('#')) {
        fill = hexToRgba(v);
      }
      this._fillStyle = v;
    },
    get fillStyle() {
      return this._fillStyle || '#000000';
    },
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, clip() {},
    clearRect(x, y, w, h) {
      for (let iy = Math.max(0, y); iy < Math.min(height, y + h); iy++) {
        for (let ix = Math.max(0, x); ix < Math.min(width, x + w); ix++) {
          grid[(iy * width + ix) * 4 + 3] = 0;
        }
      }
    },
    fillRect(x, y, w, h) {
      for (let iy = y; iy < y + h; iy += 2) {
        for (let ix = x; ix < x + w; ix += 2) setPx(ix, iy);
      }
    },
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, rect() {},
    stroke() {}, fill() {
      for (let i = 0; i < 64; i++) setPx(width / 2 + (i % 8), height / 2 + (i >> 3));
    },
    fillText() {}, strokeText() {},
  };
}

function hexToRgba(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

function screenshot(config, view) {
  const canvas = makeFakeCanvas();
  const fsm = new AnimationFSM(config);
  for (let i = 0; i < 30; i++) fsm.update(1 / 60);
  drawScene(canvas, fsm, view, { deterministic: true });
  return {
    dataUrl: canvas.toDataURL(),
    pixelHash: snapshotHash(Array.from(canvas.grid)),
    nonzero: canvas.grid.reduce((n, v, i) => (i % 4 === 3 && v ? n + 1 : n), 0),
  };
}

export function runAllSuites(view = defaultViewLite()) {
  const results = [];
  for (const suite of SUITES) {
    for (const tc of suite.cases) {
      results.push(runCase(suite.name, tc, view));
    }
  }
  const summary = {
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };
  return { results, summary, generatedAt: new Date(0).toISOString() };
}

function defaultViewLite() {
  return { frameLines: true, grid: true, eventMarkers: true, ghost: true, tint: '#7dd3fc', zoom: 1 };
}

function runCase(suiteName, tc, view) {
  const started = Date.now();
  const result = { suite: suiteName, id: tc.id, desc: tc.desc, ok: false, details: [] };
  try {
    const config = clone(defaultConfig());
    if (tc.mutate) tc.mutate(config);
    const validation = validateConfig(config);
    if (tc.expectValidationError) {
      result.ok = !validation.ok && validation.errors.some((e) => e.includes(tc.expectValidationError));
      result.details.push(validation.ok ? '校验未拒绝损坏工程' : '校验拒绝: ' + validation.errors.join('; '));
      result.metrics = null;
      result.durationMs = Date.now() - started;
      return result;
    }
    if (!validation.ok) throw new Error('合法工程被校验拒绝: ' + validation.errors.join('; '));
    if (tc.expectRuntimeError) {
      const fsm = new AnimationFSM(config);
      let threw = false;
      try { fsm.input(tc.badInput); } catch (err) { threw = err.message.includes(tc.expectRuntimeError); }
      result.ok = threw;
      result.details.push(threw ? '运行时按预期抛出错误' : '未抛出预期错误');
      result.durationMs = Date.now() - started;
      return result;
    }
    const first = runScenario(config, tc.script || [], tc.steps || 60);
    const second = runScenario(config, tc.script || [], tc.steps || 60);
    const before = {
      traceHash: first.traceHash,
      eventHash: first.eventHash,
      objects: countObjects(first.traces) + countObjects(first.events),
      shot: screenshot(config, view),
    };
    const after = {
      traceHash: second.traceHash,
      eventHash: second.eventHash,
      objects: countObjects(second.traces) + countObjects(second.events),
      shot: screenshot(config, view),
    };
    result.metrics = { before, after };
    result.recomputeStable =
      before.traceHash === after.traceHash &&
      before.eventHash === after.eventHash &&
      before.objects === after.objects &&
      before.shot.pixelHash === after.shot.pixelHash;
    tc.check(first.events, first.traces);
    result.ok = result.recomputeStable;
    result.details.push(
      `trace ${before.traceHash} / event ${before.eventHash}`,
      `对象数 ${before.objects}，非空像素 ${before.shot.nonzero}`,
      '重算前后哈希/对象/截图完全一致'
    );
  } catch (err) {
    result.ok = false;
    result.details.push('异常: ' + err.message);
  }
  result.durationMs = Date.now() - started;
  return result;
}
