/* Writes a machine-readable audit report and a human-readable trace into
   artifacts/, demonstrating determinism, fault snapshots and the clean
   post-recovery observation window. */
'use strict';

var fs = require('fs');
var path = require('path');
var RS = require('../src/simulation.js');
var SC = require('../src/scenarios.js');

function run(script, horizon) {
  var engine = new RS.Engine();
  engine.loadScript(script.map(function (c) {
    return { at: c.at, cmd: JSON.parse(JSON.stringify(c.cmd)) };
  }));
  engine.run(horizon);
  return engine;
}

var winA = run(SC.winningScript);
var winB = run(SC.winningScript);
var failA = run(SC.failureScript);
var failB = run(SC.failureScript);
var recA = run(SC.recoveryScript, 1400);
var recB = run(SC.recoveryScript, 1400);
var terminalTick = recA.state.tick;
recA.observe(RS.OBSERVE_TICKS);
recB.observe(RS.OBSERVE_TICKS);

var report = {
  seed: 20261112,
  fixedSchedule: winA.state.schedule,
  determinism: {
    winningIdentical: JSON.stringify(winA.state) === JSON.stringify(winB.state),
    failureIdentical: JSON.stringify(failA.state) === JSON.stringify(failB.state),
    recoveryIdentical: JSON.stringify(recA.state) === JSON.stringify(recB.state)
  },
  winning: {
    status: winA.state.status,
    wonAt: winA.state.wonAt,
    stats: winA.state.stats,
    idleReport: winA.idleResourceReport()
  },
  failure: {
    status: failA.state.status,
    lostReason: failA.state.lostReason,
    stats: failA.state.stats,
    idleReport: failA.idleResourceReport(),
    faultSnapshots: failA.state.faultSnapshots
  },
  recovery: {
    terminalTick: terminalTick,
    observedUntil: recA.state.tick,
    observeTicks: RS.OBSERVE_TICKS,
    status: recA.state.status,
    stats: recA.state.stats,
    rerouteEvents: recA.state.log.filter(function (l) { return l.kind === 'REROUTE'; }),
    roadOpenEvents: recA.state.log.filter(function (l) { return l.kind === 'ROAD_OPEN'; }),
    residual: {
      blockedEdges: Object.keys(recA.state.map.edges)
        .filter(function (k) { return recA.state.map.edges[k].blocked; }),
      occupiedBeds: Object.keys(recA.state.medpoints).reduce(function (acc, k) {
        acc[k] = Object.keys(recA.state.medpoints[k].beds).length;
        return acc;
      }, {}),
      passengers: Object.keys(recA.state.ambulances).map(function (k) {
        return { amb: k, count: recA.state.ambulances[k].passengers.length,
                 mode: recA.state.ambulances[k].mode };
      }),
      sarMode: recA.state.sar.mode,
      sarQueue: recA.state.sar.queue,
      transientCasualties: Object.keys(recA.state.casualties)
        .filter(function (k) {
          return ['TREATED', 'DEAD'].indexOf(recA.state.casualties[k].state) === -1;
        }),
      queuedCommands: recA.state.commands.length
    }
  }
};

var outDir = path.join(__dirname, '..', 'artifacts');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'audit-report.json'),
  JSON.stringify(report, null, 2));

var lines = [];
lines.push('地震救援模拟 - 确定性审计报告');
lines.push('固定种子: ' + report.seed);
lines.push('固定余震顺序: ' + report.fixedSchedule.map(function (e) {
  return 't' + e.tick + ' 断 ' + e.edge + '(M' + e.magnitude + ')';
}).join('，'));
lines.push('');
lines.push('双跑一致性: 胜利=' + report.determinism.winningIdentical +
  '，失败=' + report.determinism.failureIdentical +
  '，恢复=' + report.determinism.recoveryIdentical);
lines.push('胜利场景: ' + report.winning.status + ' @t' + report.winning.wonAt +
  '，处置 ' + report.winning.stats.treated + ' 人，死亡 ' + report.winning.stats.dead);
lines.push('失败场景: ' + report.failure.status + '（' + report.failure.lostReason +
  '），处置 ' + report.failure.stats.treated + ' 人，死亡 ' + report.failure.stats.dead);
report.failure.faultSnapshots.forEach(function (f) {
  var bc = f.after.filter(function (p) { return p.pair === 'B>C'; })[0];
  lines.push('  故障快照 t' + f.tick + ' 断 ' + f.edge +
    '，B>C 成本 ' + f.before.filter(function (p) { return p.pair === 'B>C'; })[0].cost +
    ' -> ' + (bc ? bc.cost : 'n/a') +
    '，受影响实体 ' + f.affectedEntities.length + ' 个');
});
lines.push('恢复场景: 终局 t' + report.recovery.terminalTick +
  '，继续观察 ' + report.recovery.observeTicks + ' tick 至 t' + report.recovery.observedUntil);
report.recovery.rerouteEvents.forEach(function (l) {
  lines.push('  重算: t' + l.tick + ' ' + l.detail.entity +
    ' 新成本 ' + l.detail.newCost);
});
report.recovery.roadOpenEvents.forEach(function (l) {
  lines.push('  复通: t' + l.tick + ' ' + l.detail.edge);
});
lines.push('观察期末残留: 阻断路=' + report.recovery.residual.blockedEdges.length +
  '，暂留伤员=' + report.recovery.residual.transientCasualties.length +
  '，待执行命令=' + report.recovery.residual.queuedCommands +
  '，SAR=' + report.recovery.residual.sarMode);
fs.writeFileSync(path.join(outDir, 'audit-report.txt'),
  lines.join('\n') + '\n');

console.log(lines.join('\n'));
console.log('\n报告已写入 artifacts/audit-report.json 与 artifacts/audit-report.txt');
