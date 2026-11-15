/* Minimal DOM/Canvas stub so src/app.js can be exercised under Node.
   This validates wiring (event handlers, render paths, control logic)
   without a real browser. */
'use strict';

var path = require('path');
var fs = require('fs');

function makeCtx2d() {
  return new Proxy({}, {
    get: function (t, prop) {
      if (prop === 'canvas') return {};
      return typeof prop === 'string' ? function () {} : undefined;
    },
    set: function () { return true; }
  });
}

var handlers = {};
function fakeEl(id) {
  return {
    id: id,
    textContent: '',
    innerHTML: '',
    value: id === 'speedRange' ? '4' : 'win',
    addEventListener: function (evt, fn) { handlers[id + ':' + evt] = fn; },
    getContext: function () { return makeCtx2d(); }
  };
}

var els = {};
global.window = global;
global.self = global;
global.document = {
  getElementById: function (id) {
    return (els[id] = els[id] || fakeEl(id));
  }
};
global.setTimeout = function (fn) { return 0; };
global.clearTimeout = function () {};

global.RescueSim = require('../src/simulation.js');
global.RescueScenarios = require('../src/scenarios.js');
global.AudioContext = function () {
  return {
    state: 'running',
    currentTime: 0,
    destination: {},
    createGain: function () {
      return { gain: { value: 0, setValueAtTime: function () {},
        exponentialRampToValueAtTime: function () {} } , connect: function () {} };
    },
    createOscillator: function () {
      return { connect: function () {}, start: function () {},
        stop: function () {}, frequency: {
          value: 0, setValueAtTime: function () {},
          exponentialRampToValueAtTime: function () {} } };
    },
    createBiquadFilter: function () {
      return { type: '', frequency: { value: 0 }, connect: function () {} };
    },
    resume: function () {}
  };
};
require('../src/audio.js');

var appSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
(0, eval)(appSrc);

var RescueSim = global.RescueSim;
var failures = 0;
function check(name, cond) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
  if (!cond) failures++;
}

check('start handler wired', typeof handlers['btnStart:click'] === 'function');
check('step handler wired', typeof handlers['btnStep:click'] === 'function');
check('reset handler wired', typeof handlers['btnReset:click'] === 'function');
check('scenario handler wired', typeof handlers['scenarioSelect:change'] === 'function');

handlers['btnStep:click']();
handlers['btnStep:click']();
check('two manual steps rendered rows',
      els.resourceRows.innerHTML.indexOf('AMB1') !== -1);

els.scenarioSelect.value = 'fail';
handlers['scenarioSelect:change']({ target: { value: 'fail' } });
check('failure scenario loads', els.faultState.textContent === '暂无');

for (var i = 0; i < 800; i++) handlers['btnStep:click']();
check('failure scenario reaches terminal state in UI',
      /失败|LOST/.test(els.runState.textContent));

handlers['btnReset:click']();
check('reset restores initial panel text',
      els.runState.textContent.indexOf('重置') !== -1);

els.scenarioSelect.value = 'recovery';
handlers['scenarioSelect:change']({ target: { value: 'recovery' } });
for (var j = 0; j < 1400; j++) handlers['btnStep:click']();
check('recovery scenario records all three faults in UI',
      (els.faultState.textContent.match(/断/g) || []).length === 3);

handlers['btnMute:click']();
check('mute toggle works', els.btnMute.textContent === '取消静音');

console.log('\n' + (failures === 0 ? 'DOM SMOKE PASSED' : failures + ' FAILED'));
process.exit(failures ? 1 : 0);
