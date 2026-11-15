/* 无浏览器环境下的 DOM 桩冒烟测试：加载 app.js，模拟播放/单步/暂停/重置/改道/场景切换 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEl(id) {
  const listeners = {};
  return {
    id: id, innerHTML: '', textContent: '', value: '4', disabled: false,
    className: '', style: {}, width: 900, height: 560,
    scrollTop: 0, clientHeight: 100, scrollHeight: 100,
    getContext: () => new Proxy({}, { get: (t, k) => {
      if (k === 'measureText') return () => ({ width: 10 });
      return typeof k === 'string' ? () => {} : undefined;
    }, set: () => true }),
    onclick: null,
    addEventListener: (ev, fn) => { listeners[ev] = fn; },
    fire: (ev) => listeners[ev] && listeners[ev]()
  };
}

const ids = ['cv', 'sTime', 'sTemp', 'sWind', 'sStorm', 'sResult', 'vehicles',
  'batches', 'fault', 'log', 'btnPlay', 'btnPause', 'btnStep', 'btnReset',
  'btnMute', 'btnReroute', 'speed'];
const elMap = {};
ids.forEach(id => { elMap[id] = makeEl(id); });
const sceneButtons = ['success', 'miss', 'drone'].map(s => ({
  dataset: { scene: s }, onclick: null
}));

const sandbox = {
  console,
  window: {},
  document: {
    getElementById: id => elMap[id],
    querySelectorAll: () => sceneButtons
  },
  requestAnimationFrame: () => 0,
  AudioContext: function () {
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.destination = {};
    const param = () => ({ value: 0, setTargetAtTime: () => {} });
    const chainNode = () => ({ connect: () => chainNode() });
    this.createGain = () => ({ gain: param(), connect: () => chainNode() });
    this.createBiquadFilter = () => ({
      type: '', Q: param(), frequency: param(), connect: () => chainNode()
    });
    this.createOscillator = () => ({
      type: '', frequency: param(), connect: () => chainNode(), start: () => {}
    });
    this.createBufferSource = () => ({
      buffer: null, loop: false, connect: () => chainNode(), start: () => {}
    });
    this.createBuffer = (ch, len) => ({ getChannelData: () => new Float32Array(len) });
    this.resume = () => {};
  }
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const engineSrc = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
vm.runInContext(engineSrc, sandbox);
vm.runInContext(appSrc, sandbox);

let failures = 0;
function assert(name, cond) {
  if (cond) console.log('  ✓ ' + name);
  else { failures += 1; console.log('  ✗ ' + name); }
}

const app = sandbox.window.__polarApp;
const render = () => sandbox.window.__polarRender();
assert('app 暴露 loadScene', typeof app.loadScene === 'function');

// 初始场景渲染
let sim = app.sim;
assert('初始 t=0 且侧栏已渲染', sim.t === 0 && elMap.vehicles.innerHTML.includes('履带车'));
assert('日志渲染重置事件', elMap.log.innerHTML.includes('系统重置'));

// 单步推进 10 tick
for (let i = 0; i < 10; i++) elMap.btnStep.onclick();
sim = app.sim;
assert('单步后 t=10 且货物已装载', sim.t === 10 && sim.batch('b1').carriedBy === 'rover');

// 模拟播放若干帧（pulse 通过 driver）
elMap.btnPlay.onclick();
for (let i = 0; i < 5; i++) app.sim && sandbox.window.__polar.driver.pulse(4);
elMap.btnPause.onclick();
const tAfterPlay = app.sim.t;
assert('播放后时间推进（t=' + tAfterPlay + '）', tAfterPlay > 10);

// 切到失败场景并跑到底
sceneButtons[1].onclick();
sim = app.sim;
const driver = sandbox.window.__polar.driver;
driver.pulse(360);
render();
assert('错过窗口场景失败', sim.outcome === 'failure' &&
  sim.failureReasons.includes('missed-window'));
assert('故障快照渲染到侧栏', elMap.fault.innerHTML.includes('故障前') &&
  elMap.fault.innerHTML.includes('故障后'));
assert('结果栏显示失败', elMap.sResult.textContent.includes('任务失败'));

// 无人机失联场景
sceneButtons[2].onclick();
sim = app.sim;
sandbox.window.__polar.driver.pulse(360);
assert('无人机场景失联失败', sim.vehicle('drone').status === 'lost');

// 重置回到初始
elMap.btnReset.onclick();
sim = app.sim;
assert('重置后 t=0、日志重建', sim.t === 0 && elMap.sResult.textContent === '');

// 改道按钮：构造阻塞状态
app.sim.command({ type: 'load', vehicle: 'rover', batch: 'b1' });
app.sim.command({ type: 'load', vehicle: 'rover', batch: 'b2a' });
app.sim.command({ type: 'load', vehicle: 'rover', batch: 'b3' });
app.sim.command({ type: 'depart', vehicle: 'rover', path: ['eBP', 'ePG', 'eGS2'] });
sandbox.window.__polar.driver.setPaused(false);
sandbox.window.__polar.driver.pulse(12);
render();
assert('重载在北坡阻塞', app.sim.vehicle('rover').status === 'blocked');
elMap.btnReroute.onclick();
render();
assert('改道按钮触发 reroute 且已走路径保留',
  app.sim.vehicle('rover').pathTraveled.join() === 'eBP' &&
  app.sim.vehicle('rover').status === 'moving');

// 静音切换不抛错
elMap.btnMute.onclick();
assert('静音可切换', elMap.btnMute.textContent.includes('静音'));

console.log('\n浏览器桩冒烟测试：' + (failures ? failures + ' 失败' : '全部通过'));
process.exit(failures ? 1 : 0);
