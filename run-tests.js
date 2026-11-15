/* 极地补给仿真 —— Node 验证套件
 * 覆盖：统一时间推进、暂停/单步、改道已走路径不丢失、暴风封山、
 *       两组可重复失败场景（错过窗口 / 无人机失联）、故障前后快照、
 *       重置、同一组输入双跑一致性、恢复后固定时间观察无残留。 */
'use strict';
const E = require('./engine.js');
const { Simulation, FixedDriver, digest, STORM, HORIZON } = E;

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed += 1; console.log('  ✓ ' + name); }
  else { failed += 1; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function section(title) { console.log('\n=== ' + title + ' ==='); }

// 标准成功脚本：同一组输入将被连续运行两次
function successScript() {
  return [
    { at: 1, cmd: { type: 'load', vehicle: 'rover', batch: 'b1' } },
    { at: 2, cmd: { type: 'load', vehicle: 'rover', batch: 'b2a' } },
    { at: 3, cmd: { type: 'load', vehicle: 'rover', batch: 'b3' } },
    { at: 4, cmd: { type: 'load', vehicle: 'drone', batch: 'b2b' } },
    { at: 5, cmd: { type: 'depart', vehicle: 'rover', to: 'S3' } },
    { at: 6, cmd: { type: 'depart', vehicle: 'drone', path: ['aBS1', 'aS12'] } },
    { at: 20, cmd: { type: 'depart', vehicle: 'drone', path: ['aS12', 'aBS1'] } },
    { at: 60, cmd: { type: 'depart', vehicle: 'rover', to: 'B' } },
    { at: 100, cmd: { type: 'depart', vehicle: 'rover', path: ['eBP', 'ePG', 'eGS2'] } },
    { at: 200, cmd: { type: 'depart', vehicle: 'rover', to: 'B' } }
  ];
}

// ---------- T1 统一时间推进 + 暂停/单步 ----------
section('T1 统一时间推进：暂停、单步、恢复');
{
  const sim = new Simulation({ script: successScript() });
  const drv = new FixedDriver(sim);
  check('初始 t=0', sim.t === 0);
  check('单步推进 1 tick', drv.step() === true && sim.t === 1);
  drv.setPaused(true);
  const snapBefore = sim.snapshot();
  const ran = drv.pulse(30);
  check('暂停期间 pulse 不推进', ran === 0 && sim.t === 1);
  check('暂停期间状态零变化', JSON.stringify(sim.snapshot()) === JSON.stringify(snapBefore));
  drv.step(); // 暂停下手动单步也不应推进
  check('暂停下单步不推进', sim.t === 1);
  drv.setPaused(false);
  check('恢复后单步继续', drv.step() === true && sim.t === 2);
  check('t=1 的装载脚本命令已执行', sim.batch('b1').carriedBy === 'rover');
  drv.runTo(40);
  check('runTo 精确到目标 tick', sim.t === 40);
}

// ---------- T2 改道后已走路径不丢失 + 暴风封山 ----------
section('T2 改道：已走路径保留，暴风关闭山口');
{
  const sim = new Simulation();
  const drv = new FixedDriver(sim);
  sim.command({ type: 'load', vehicle: 'rover', batch: 'b2a' });
  drv.runTo(110);
  sim.command({ type: 'depart', vehicle: 'rover', path: ['eBP', 'ePG', 'eGS2'] });
  drv.runTo(STORM[0] + 2);
  const r = sim.vehicle('rover');
  check('暴风窗口中山口阻塞', r.status === 'blocked' && r.edge === 'ePG');
  check('阻塞原因记录为暴风封山', (r.blockedReason || '').includes('暴风关闭山口'));
  const traveledBefore = r.pathTraveled.slice();
  check('受阻前已走边已记录', JSON.stringify(traveledBefore) === JSON.stringify(['eBP']));
  const accepted = sim.command({ type: 'reroute', vehicle: 'rover',
    path: ['ePS1', 'eS1X', 'eXS3'] });
  check('阻塞状态允许改道', accepted === true);
  check('改道后已走路径不丢失',
    JSON.stringify(r.pathTraveled) === JSON.stringify(traveledBefore));
  check('未走路线被整体替换', JSON.stringify(r.route) ===
    JSON.stringify(['ePS1', 'eS1X', 'eXS3']));
  drv.runTo(140);
  check('改道后继续推进且路径累积', r.pathTraveled.length > traveledBefore.length &&
    r.pathTraveled[0] === 'eBP');
  const rerouteEvt = sim.events.find(e => e.kind === 'reroute');
  check('改道事件保留 kept/oldRoute/newRoute',
    JSON.stringify(rerouteEvt.data.kept) === JSON.stringify(['eBP']) &&
    rerouteEvt.data.newRoute.length === 3);
}

// ---------- T3 失败场景 A：错过截止窗口 ----------
section('T3 失败场景 A：错过窗口（迟出发）');
{
  const script = [
    { at: 1, cmd: { type: 'load', vehicle: 'rover', batch: 'b1' } },
    { at: 2, cmd: { type: 'load', vehicle: 'rover', batch: 'b2a' } },
    { at: 3, cmd: { type: 'load', vehicle: 'rover', batch: 'b3' } },
    { at: 4, cmd: { type: 'load', vehicle: 'drone', batch: 'b2b' } },
    // 无人机与履带车都拖到 t=110 才出发，b1 截止 150 无法抵达
    { at: 110, cmd: { type: 'depart', vehicle: 'rover', to: 'S3' } },
    { at: 111, cmd: { type: 'depart', vehicle: 'drone', path: ['aBS1', 'aS12'] } }
  ];
  const sim = new Simulation({ script });
  const drv = new FixedDriver(sim);
  drv.pulse(HORIZON);
  check('任务判定失败', sim.over && sim.outcome === 'failure');
  check('失败原因为 missed-window', sim.failureReasons.includes('missed-window'));
  check('失败在错过截止的首个 tick 触发', sim.t === 271);
  const fs = sim.faultSnapshots[0];
  check('记录故障前后两份快照', fs && fs.before.t === 271 && fs.after.t === 271);
  check('故障前 b1 未送达、故障后 late=true',
    fs.before.batches.find(b => b.id === 'b2a').delivered === false &&
    fs.after.batches.find(b => b.id === 'b2a').late === true);
  check('快照含天气与车辆资源状态',
    typeof fs.before.weather.wind === 'number' &&
    fs.before.vehicles.every(v => typeof v.battery === 'number'));
  check('失败后 tick 停止推进', drv.pulse(20) === 0 && sim.t === 271);
}

// ---------- T4 失败场景 B：无人机闯入暴风失联 ----------
section('T4 失败场景 B：无人机暴风失联');
{
  const script = [
    { at: 1, cmd: { type: 'load', vehicle: 'drone', batch: 'b2b' } },
    { at: STORM[0] + 1, cmd: { type: 'depart', vehicle: 'drone',
      path: ['aBS1', 'aS12'] } }
  ];
  const sim = new Simulation({ script });
  const drv = new FixedDriver(sim);
  drv.pulse(HORIZON);
  const d = sim.vehicle('drone');
  check('无人机状态为 lost', d.status === 'lost');
  check('失败原因为 lost', sim.failureReasons.includes('lost'));
  const fs = sim.faultSnapshots.find(s => s.code === 'lost');
  check('失联前后快照齐全且风速超上限',
    fs && fs.before.vehicles[1].status === 'idle' &&
    fs.after.vehicles[1].status === 'lost' &&
    fs.before.weather.wind > E.DRONE.windLimit);
  check('失联后所载货物不再占用载具', sim.batch('b2b').carriedBy === null);
}

// ---------- T5 重置 ----------
section('T5 重置：回到初始资源与任务序列');
{
  const sim = new Simulation({ script: successScript() });
  const drv = new FixedDriver(sim);
  drv.runTo(80);
  check('运行中已有交付', sim.batches.some(b => b.delivered));
  sim.reset();
  check('重置后 t=0、无结果', sim.t === 0 && sim.over === false && sim.outcome === null);
  check('货物全部回到基地未交付',
    sim.batches.every(b => b.location === 'B' && !b.delivered && b.carriedBy === null));
  check('车辆电量满、路径清空、位于基地',
    sim.vehicles.every(v => v.battery === v.batteryMax &&
      v.pathTraveled.length === 0 && v.route.length === 0 && v.node === 'B'));
  check('故障快照与事件日志清空', sim.faultSnapshots.length === 0);
  drv.pulse(HORIZON);
  check('重置后可重新跑完整任务', sim.over && sim.outcome === 'success');
}

// ---------- T6 同一组输入双跑一致性 + 恢复后观察无残留 ----------
section('T6 确定性：同输入连续运行两次结果一致');
function fullRun() {
  const sim = new Simulation({ seed: 20261112, script: successScript() });
  const drv = new FixedDriver(sim);
  // 中途插入暂停/单步，验证驱动器不影响确定性结果
  drv.runTo(30); drv.setPaused(true); drv.pulse(10); drv.setPaused(false);
  drv.runTo(90); drv.step();
  drv.pulse(HORIZON);
  const endDigest = digest(sim);
  // 恢复操作完成后继续固定观察 60 tick，检查残留资源/错误状态
  const tEnd = sim.t;
  const observeRan = drv.pulse(60);
  return {
    digest: endDigest, sim: sim, observeRan: observeRan, tEnd: tEnd,
    observedDigest: digest(sim)
  };
}
const run1 = fullRun();
const run2 = fullRun();
check('两次运行任务序列/资源变化/最终结果完全一致',
  run1.digest === run2.digest);
const simA = run1.sim;
check('两次均为成功且全部货物准时',
  simA.outcome === 'success' && simA.batches.every(b => b.delivered && !b.late));
check('交付时刻两次一致',
  JSON.stringify(simA.batches.map(b => b.deliveredAt)) ===
  JSON.stringify(run2.sim.batches.map(b => b.deliveredAt)));
check('结束后观察期无多余 tick（无残留推进）',
  run1.observeRan === 0 && run2.observeRan === 0);
check('观察期后摘要不变（无残留资源/错误状态）',
  run1.digest === run1.observedDigest);
check('无滞留/失联车辆，无人机已返航',
  simA.vehicles.every(v => v.status === 'idle') &&
  simA.vehicle('drone').node === 'B');
check('无货物仍被载具占用',
  simA.batches.every(b => b.carriedBy === null && b.delivered));

// ---------- T7 低温与负重的资源影响可观测 ----------
section('T7 环境模型：低温降容量、负重影响坡限与能耗');
{
  const sim = new Simulation();
  const cold = sim._coldFactor(sim.vehicle('rover'));
  check('低温系数 < 1（容量折减）', cold < 1 && cold > 0.7);
  sim.command({ type: 'load', vehicle: 'rover', batch: 'b1' });
  sim.command({ type: 'load', vehicle: 'rover', batch: 'b2a' });
  sim.command({ type: 'load', vehicle: 'rover', batch: 'b3' });
  const edge = E.EDGE_MAP.ePG;
  check('重载无法通过 22% 雪坡', sim._edgeCheck(sim.vehicle('rover'), edge).ok === false);
  const drainHeavy = sim._drainPerTick(sim.vehicle('rover'), edge);
  const sim2 = new Simulation();
  const drainEmpty = sim2._drainPerTick(sim2.vehicle('rover'), edge);
  check('重载能耗高于空载', drainHeavy > drainEmpty);
}

console.log('\n----------------------------------------');
console.log('结果：' + passed + ' 通过，' + failed + ' 失败');
process.exit(failed ? 1 : 0);
