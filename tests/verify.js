/* Headless deterministic verification.
   Run: node tests/verify.js
   Exits non-zero on any failed assertion and prints a full audit trail. */
'use strict';

var RS = require('../src/simulation.js');
var SC = require('../src/scenarios.js');

var failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('  PASS  ' + name);
  } else {
    failures++;
    console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : ''));
  }
}

function runOnce(script, horizon) {
  var engine = new RS.Engine();
  engine.loadScript(script.map(function (c) {
    return { at: c.at, cmd: JSON.parse(JSON.stringify(c.cmd)) };
  }));
  engine.run(horizon);
  return engine;
}

function comparable(s) {
  return JSON.stringify(s, function (key, value) {
    return value;
  });
}

console.log('== 1. Same inputs, two consecutive runs ====================');
['winningScript', 'failureScript', 'recoveryScript'].forEach(function (name) {
  var horizon = name === 'recoveryScript' ? 1400 : undefined;
  var runA = runOnce(SC[name], horizon);
  var runB = runOnce(SC[name], horizon);
  check(name + ': identical full state snapshots',
        comparable(runA.state) === comparable(runB.state));
  check(name + ': identical event logs',
        JSON.stringify(runA.state.log) === JSON.stringify(runB.state.log));
  check(name + ': identical final status',
        runA.state.status === runB.state.status,
        runA.state.status + ' vs ' + runB.state.status);
  check(name + ': identical resource stats',
        JSON.stringify(runA.state.stats) === JSON.stringify(runB.state.stats));
});

console.log('== 2. Winning play-through reaches the objective ===========');
var win = runOnce(SC.winningScript);
check('status WON', win.state.status === 'WON', win.state.status);
check('at least 8 casualties treated', win.state.stats.treated >= RS.WIN_TREATED,
      String(win.state.stats.treated));
check('finished before 20 minute horizon',
      win.state.wonAt !== null && win.state.wonAt < RS.TICK_LIMIT,
      String(win.state.wonAt));
check('no casualty died', win.state.stats.dead === 0);
check('fixed event order is e4,e8,e5',
      win.state.schedule.map(function (e) { return e.edge; }).join(',') === 'e4,e8,e5');

console.log('== 3. Aftershock forces a live route recalculation =========');
var rec = runOnce(SC.recoveryScript, 1400);
var third = rec.state.faultSnapshots[2];
check('three aftershock snapshots recorded',
      rec.state.faultSnapshots.length === 3);
check('third aftershock blocks e5 (B-C)', third && third.edge === 'e5');
var beforeBC = third.before.filter(function (p) { return p.pair === 'B>C'; })[0];
var afterBC = third.after.filter(function (p) { return p.pair === 'B>C'; })[0];
check('B>C direct route cost 32 before shock', beforeBC.cost === 32,
      String(beforeBC.cost));
check('B>C detour cost 68 after shock (e4+e10)', afterBC.cost === 68,
      String(afterBC.cost));
check('detour no longer uses blocked e5',
      afterBC.edges.indexOf('e5') === -1, afterBC.edges.join(','));
var rerouteEvents = rec.state.log.filter(function (l) { return l.kind === 'REROUTE'; });
check('a moving ambulance was rerouted in real time',
      rerouteEvents.some(function (l) {
        return l.detail.entity === 'AMB2' && l.tick === third.tick;
      }), JSON.stringify(rerouteEvents));
check('reroute counter incremented', rec.state.stats.reroutes >= 1);

console.log('== 4. Repeatable failure scenario + fault snapshots =========');
var fail = runOnce(SC.failureScript);
check('status LOST', fail.state.status === 'LOST', fail.state.status);
check('loss reason recorded', !!fail.state.lostReason, fail.state.lostReason);
check('fewer than 8 treated', fail.state.stats.treated < RS.WIN_TREATED,
      String(fail.state.stats.treated));
check('at least three casualties died', fail.state.stats.dead >= 3,
      String(fail.state.stats.dead));
var idle = fail.idleResourceReport();
var unusedM2 = idle.medpoints.filter(function (m) { return m.id === 'M2'; })[0];
check('M2 beds never occupied (misallocated resource)',
      unusedM2.occupied === 0);
var amb3 = idle.ambulances.filter(function (a) { return a.id === 'AMB3'; })[0];
check('AMB3 accumulated idle ticks', amb3.idleTicks > 0,
      String(amb3.idleTicks));
check('before/after key state captured per shock',
      fail.state.faultSnapshots.every(function (f) {
        return f.before.length === 8 && f.after.length === 8 &&
               Array.isArray(f.affectedEntities);
      }));
check('failure run captured the two shocks before collapse',
      fail.state.faultSnapshots.length === 2,
      String(fail.state.faultSnapshots.length));
var firstFault = fail.state.faultSnapshots[0];
check('snapshot records blocked edge and tick',
      firstFault.edge === 'e4' && firstFault.tick === 120);

console.log('== 5. Recovery then fixed observation window =================');
var rec2 = runOnce(SC.recoveryScript, 1400);
var terminalTick = rec2.state.tick;
rec2.observe(RS.OBSERVE_TICKS);
var s = rec2.state;
check('observation ran exactly ' + RS.OBSERVE_TICKS + ' ticks',
      s.tick === terminalTick + RS.OBSERVE_TICKS,
      s.tick + ' vs ' + (terminalTick + RS.OBSERVE_TICKS));
check('every blocked edge was reopened',
      Object.keys(s.map.edges).filter(function (k) { return s.map.edges[k].blocked; })
        .length === 0);
check('reopened counter equals 3', s.stats.reopened === 3,
      String(s.stats.reopened));
check('SAR finished idle with empty queue',
      s.sar.mode === 'IDLE' && s.sar.queue.length === 0 && s.sar.job === null);
check('all ambulances idle and empty',
      Object.keys(s.ambulances).every(function (k) {
        var a = s.ambulances[k];
        return a.mode === 'IDLE' && a.passengers.length === 0 &&
               a.pickup.length === 0 && a.pathEdges.length === 0;
      }));
check('all medpoint beds released',
      Object.keys(s.medpoints).every(function (k) {
        return Object.keys(s.medpoints[k].beds).length === 0;
      }));
check('no casualty left in transient state',
      Object.keys(s.casualties).every(function (k) {
        return ['TREATED', 'DEAD'].indexOf(s.casualties[k].state) !== -1;
      }));
check('no queued commands remain', s.commands.length === 0);
check('no moving entity retains a stale path',
      rec2.movingEntities().every(function (e) { return e.pathEdges.length === 0; }));

console.log('== 6. Key-state trace around the third fault ==================');
var trace = rec.state.log.filter(function (l) {
  return l.tick >= 775 && l.tick <= 855 &&
    ['DISPATCH', 'AFTERSHOCK', 'REROUTE', 'SAR_CLEAR', 'ROAD_OPEN',
     'LOADED', 'UNLOADED', 'TREATED'].indexOf(l.kind) !== -1;
}).map(function (l) {
  return '  t' + l.tick + '  ' + l.kind + '  ' + JSON.stringify(l.detail);
});
console.log(trace.join('\n'));

console.log('\n' + (failures === 0
  ? 'ALL CHECKS PASSED'
  : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
