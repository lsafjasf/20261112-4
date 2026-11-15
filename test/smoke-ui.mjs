// UI smoke test: stub a minimal DOM, import main.js, drive a few frames.
const ctx2d = () => new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : (t[k] = typeof k === 'string' && k.startsWith('__') ? undefined : (() => {}))),
  set: (t, k, v) => (t[k] = v, true),
});

function makeCanvas() {
  return {
    width: 960, height: 640,
    getContext: ctx2d,
    addEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
}

const elements = new Map();
function makeEl(id) {
  return {
    id, textContent: '', innerHTML: '', className: '', value: '4', checked: false,
    children: [], scrollTop: 0, scrollHeight: 0,
    onclick: null, onchange: null,
    appendChild(c) { this.children.push(c); },
    click() { this.onclick && this.onclick(); },
  };
}

const rafQueue = [];
globalThis.document = {
  getElementById: id => {
    if (!elements.has(id)) elements.set(id, id === 'map' ? makeCanvas() : makeEl(id));
    return elements.get(id);
  },
  createElement: tag => (tag === 'canvas' ? makeCanvas() : makeEl(tag)),
};
globalThis.window = { addEventListener: () => {} };
globalThis.requestAnimationFrame = fn => { rafQueue.push(fn); };

await import('../js/ui/main.js');

function frames(n) {
  for (let i = 0; i < n; i++) {
    const fns = rafQueue.splice(0);
    for (const fn of fns) fn(performance.now());
  }
}

frames(5);
console.log('boot OK, status =', elements.get('status').textContent);

// Replay failure scenario at 64x and run to completion.
elements.get('speed').value = '64';
elements.get('speed').onchange({ target: elements.get('speed') });
elements.get('btnRunFail').click();
for (let i = 0; i < 40; i++) frames(1);
console.log('failure replay status =', elements.get('status').textContent);
if (!/失败/.test(elements.get('status').textContent)) throw new Error('expected failure status');

// In-page determinism verification button.
elements.get('btnVerify').click();
const logText = elements.get('log').children.map(c => c.textContent).join('\n');
if (!logText.includes('两次运行一致')) throw new Error('verify log missing');
console.log('verify button OK');

// Success scenario + step/reset controls.
elements.get('btnRunWin').click();
for (let i = 0; i < 40; i++) frames(1);
console.log('success replay status =', elements.get('status').textContent);
if (!/成功/.test(elements.get('status').textContent)) throw new Error('expected success status');
elements.get('btnReset').click();
frames(2);
elements.get('btnStep').click();
elements.get('btnPause').click();
frames(3);
console.log('controls OK');
console.log('UI SMOKE PASSED');
