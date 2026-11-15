/* 极地补给仿真引擎：确定性固定步长（1 tick = 1 分钟），UMD 模块，浏览器/Node 共用 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PolarEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 确定性随机（每 tick 独立种子，保证可重复） ----------
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- 世界地图（坐标为 Canvas 网格公里数） ----------
  const NODES = {
    B:  { x: 1.0, y: 6.0, name: '基地' },
    P:  { x: 3.2, y: 5.0, name: '山口营地' },
    G:  { x: 4.4, y: 2.2, name: '北坡' },
    S1: { x: 6.2, y: 4.2, name: '补给站1' },
    X:  { x: 7.4, y: 6.0, name: '东营地' },
    S2: { x: 9.2, y: 2.2, name: '补给站2' },
    S3: { x: 10.2, y: 4.4, name: '补给站3' }
  };

  // mode: ground 履带车道路 / air 无人机航线；passWind 为可通过最大风速
  const EDGES = [
    { id: 'eBP',  a: 'B',  b: 'P',  dist: 2.4, grade: 0.06, passWind: 15, mode: 'ground' },
    { id: 'ePG',  a: 'P',  b: 'G',  dist: 3.0, grade: 0.22, passWind: 15, mode: 'ground' },
    { id: 'ePS1', a: 'P',  b: 'S1', dist: 3.4, grade: 0.05, passWind: 30, mode: 'ground' },
    { id: 'eGS2', a: 'G',  b: 'S2', dist: 5.0, grade: 0.08, passWind: 30, mode: 'ground' },
    { id: 'eS1X', a: 'S1', b: 'X',  dist: 1.7, grade: 0.04, passWind: 30, mode: 'ground' },
    { id: 'eXS3', a: 'X',  b: 'S3', dist: 3.0, grade: 0.06, passWind: 30, mode: 'ground' },
    { id: 'aBS1', a: 'B',  b: 'S1', dist: 5.6, grade: 0,    passWind: 99, mode: 'air' },
    { id: 'aS12', a: 'S1', b: 'S2', dist: 3.6, grade: 0,    passWind: 99, mode: 'air' },
    { id: 'aS13', a: 'S1', b: 'S3', dist: 4.1, grade: 0,    passWind: 99, mode: 'air' }
  ];

  const EDGE_MAP = {};
  EDGES.forEach(e => { EDGE_MAP[e.id] = e; });

  function adjacency(mode) {
    const adj = {};
    Object.keys(NODES).forEach(n => { adj[n] = []; });
    EDGES.filter(e => e.mode === mode).forEach(e => {
      adj[e.a].push({ to: e.b, edge: e.id });
      adj[e.b].push({ to: e.a, edge: e.id });
    });
    return adj;
  }

  // BFS 最短路，返回边 id 序列
  function findPath(from, to, mode) {
    if (from === to) return [];
    const adj = adjacency(mode);
    const queue = [from], prev = {};
    prev[from] = null;
    while (queue.length) {
      const cur = queue.shift();
      for (const step of adj[cur] || []) {
        if (!(step.to in prev)) {
          prev[step.to] = { node: cur, edge: step.edge };
          if (step.to === to) {
            const path = [];
            let n = to;
            while (prev[n]) { path.unshift(prev[n].edge); n = prev[n].node; }
            return path;
          }
          queue.push(step.to);
        }
      }
    }
    return null;
  }

  function edgeEnds(edgeId, fromNode) {
    const e = EDGE_MAP[edgeId];
    return { from: fromNode, to: e.a === fromNode ? e.b : e.a };
  }

  // ---------- 货物与车辆静态配置 ----------
  const BATCH_DEFS = [
    { id: 'b1',  weight: 80, target: 'S1', deadline: 150 },
    { id: 'b2a', weight: 60, target: 'S2', deadline: 270 },
    { id: 'b2b', weight: 60, target: 'S2', deadline: 270 },
    { id: 'b3',  weight: 50, target: 'S3', deadline: 320 }
  ];

  const ROVER = {
    id: 'rover', type: 'rover', name: '雪地履带车',
    capacity: 200, battery: 30, windLimit: 30,
    speed: 0.48, drainBase: 0.09, recharge: 2.5
  };
  const DRONE = {
    id: 'drone', type: 'drone', name: '短程无人机',
    capacity: 60, battery: 6, windLimit: 18,
    speed: 1.0, drainBase: 0.05, recharge: 0.5
  };

  const HORIZON = 360;
  const STORM = [120, 180]; // 暴风窗口（tick，左闭右开）

  // ---------- 仿真主类 ----------
  function Simulation(options) {
    options = options || {};
    this.seed = options.seed || 20261112;
    this.script = options.script || null; // 定时命令 { at: n, cmd: {...} }
    this.reset();
  }

  Simulation.prototype.reset = function () {
    this.t = 0;
    this.over = false;
    this.outcome = null; // 'success' | 'failure'
    this.failureReasons = [];
    this.events = [];
    this.faultSnapshots = []; // 故障触发前后的关键状态
    this._scriptIdx = 0;
    this._faultPending = false;
    this.weather = this._weatherAt(0);
    this.batches = BATCH_DEFS.map(d => Object.assign({
      location: 'B', delivered: false, deliveredAt: null, late: false,
      carriedBy: null
    }, d));
    this.vehicles = [
      this._newVehicle(ROVER),
      this._newVehicle(DRONE)
    ];
    this._log('reset', { at: 0 }, '系统重置，任务序列清空');
  };

  Simulation.prototype._newVehicle = function (cfg) {
    return {
      id: cfg.id, type: cfg.type, name: cfg.name,
      node: 'B', status: 'idle', // idle | moving | blocked | stranded | lost
      battery: cfg.battery, batteryMax: cfg.battery,
      cargo: [], // 货物 id
      route: [], pathTraveled: [], // 待走边序列 / 已走边序列（改道不丢失）
      edge: null, edgeFrom: null, edgeRemaining: 0,
      position: { x: NODES.B.x, y: NODES.B.y },
      config: cfg, blockedTicks: 0
    };
  };

  // 低温（°C，夜间更低）与风速（m/s，暴风窗口内 20-26，否则 6-13）
  Simulation.prototype._weatherAt = function (t) {
    const r = rng(this.seed + t * 7919)();
    const temp = -28 - 10 * Math.cos((t / HORIZON) * Math.PI * 2) + (r - 0.5) * 1.2;
    let wind;
    if (t >= STORM[0] && t < STORM[1]) {
      wind = 20 + 6 * rng(this.seed + t * 104729)();
    } else {
      wind = 6 + 7 * rng(this.seed + t * 104729)();
    }
    return { t: t, temp: +temp.toFixed(2), wind: +wind.toFixed(2),
             storm: t >= STORM[0] && t < STORM[1] };
  };

  // 低温系数：-30°C 约 0.92，-40°C 约 0.85
  Simulation.prototype._coldFactor = function (v) {
    if (v.type === 'drone') {
      return Math.max(0.7, 1 + (this.weather.temp + 20) * 0.012);
    }
    return Math.max(0.75, 1 + (this.weather.temp + 20) * 0.008);
  };

  Simulation.prototype._log = function (kind, data, text) {
    this.events.push({ t: this.t, kind: kind, data: data || {}, text: text || '' });
  };

  Simulation.prototype.vehicle = function (id) {
    return this.vehicles.find(v => v.id === id);
  };
  Simulation.prototype.batch = function (id) {
    return this.batches.find(b => b.id === id);
  };

  // 外部/脚本命令统一入口，返回 true 表示接受
  Simulation.prototype.command = function (cmd) {
    if (this.over) return false;
    const v = this.vehicle(cmd.vehicle);
    if (!v) return false;
    switch (cmd.type) {
      case 'load': return this._cmdLoad(v, cmd);
      case 'unload': return this._cmdUnload(v, cmd);
      case 'depart': return this._cmdDepart(v, cmd);
      case 'reroute': return this._cmdReroute(v, cmd);
      default: return false;
    }
  };

  Simulation.prototype._cmdLoad = function (v, cmd) {
    if (v.node !== 'B' || v.status !== 'idle') return false;
    const b = this.batch(cmd.batch);
    if (!b || b.carriedBy || b.delivered || b.location !== 'B') return false;
    const weight = this._cargoWeight(v);
    if (weight + b.weight > v.config.capacity) return false;
    b.carriedBy = v.id; b.location = null;
    v.cargo.push(b.id);
    this._log('load', { vehicle: v.id, batch: b.id, load: weight + b.weight },
      v.name + ' 装载 ' + b.id + '，当前负重 ' + (weight + b.weight) + 'kg');
    return true;
  };

  Simulation.prototype._cmdUnload = function (v, cmd) {
    const b = this.batch(cmd.batch);
    if (!b || !v.cargo.includes(b.id)) return false;
    v.cargo = v.cargo.filter(id => id !== b.id);
    b.carriedBy = null;
    if (v.node === b.target) {
      b.delivered = true; b.location = v.node; b.deliveredAt = this.t;
      this._log('deliver', { vehicle: v.id, batch: b.id, node: v.node, t: this.t },
        b.id + ' 已送达 ' + NODES[v.node].name + '（t=' + this.t + '）');
    } else {
      b.location = v.node;
      this._log('unload', { vehicle: v.id, batch: b.id, node: v.node },
        b.id + ' 卸在 ' + NODES[v.node].name);
    }
    return true;
  };

  Simulation.prototype._cargoWeight = function (v) {
    return v.cargo.reduce((s, id) => s + this.batch(id).weight, 0);
  };

  // 车辆在节点上开始走 route 的下一条边；不通过则进入 blocked
  Simulation.prototype._startNextEdge = function (v) {
    if (!v.route.length) {
      v.status = 'idle';
      v.edge = null;
      return;
    }
    const edgeId = v.route[0];
    const edge = EDGE_MAP[edgeId];
    const ends = edgeEnds(edgeId, v.node);
    const check = this._edgeCheck(v, edge);
    if (check.ok) {
      v.status = 'moving';
      v.edge = edgeId;
      v.edgeFrom = v.node;
      v.edgeRemaining = edge.dist;
      v._edgeTo = ends.to;
      v.blockedTicks = 0;
    } else {
      // 无人机在超抗风天气强行起飞 -> 立即失联
      if (v.type === 'drone' && this.weather.wind > v.config.windLimit) {
        this._loseVehicle(v, '无人机在 ' + this.weather.wind.toFixed(1) +
          ' m/s 强风中起飞失控');
        return;
      }
      v.status = 'blocked';
      v.edge = edgeId;
      v.edgeFrom = v.node;
      v._edgeTo = ends.to;
      v.blockedReason = check.reason;
      v.blockedTicks += 1;
      this._log('blocked', { vehicle: v.id, edge: edgeId, reason: check.reason,
        wind: this.weather.wind },
        v.name + ' 在 ' + edgeId + ' 受阻：' + check.reason);
    }
  };

  Simulation.prototype._edgeCheck = function (v, edge) {
    const w = this.weather;
    if (w.wind > edge.passWind) {
      return { ok: false, reason: '暴风关闭山口（风速 ' + w.wind.toFixed(1) + ' > ' + edge.passWind + '）' };
    }
    if (v.type === 'rover') {
      const loadRatio = this._cargoWeight(v) / v.config.capacity;
      const maxGrade = 0.28 - 0.12 * loadRatio; // 负重压低可爬坡上限
      if (edge.grade > maxGrade) {
        return { ok: false, reason: '负重 ' + this._cargoWeight(v) +
          'kg，雪坡 ' + (edge.grade * 100).toFixed(0) + '% 超过可通过坡度 ' +
          (maxGrade * 100).toFixed(0) + '%' };
      }
    } else if (w.wind > v.config.windLimit) {
      return { ok: false, reason: '风速超过无人机抗风上限 ' + v.config.windLimit };
    }
    return { ok: true };
  };

  // 每 tick 能耗（kWh）：低温折减容量，负载与爬坡增加消耗
  Simulation.prototype._drainPerTick = function (v, edge) {
    const cold = this._coldFactor(v);
    if (v.type === 'drone') {
      return (v.config.drainBase * (1 + this._cargoWeight(v) / v.config.capacity * 0.5)) / cold;
    }
    const loadRatio = this._cargoWeight(v) / v.config.capacity;
    const gradePenalty = 1 + edge.grade * 4;
    return (v.config.drainBase * (1 + loadRatio * 0.8) * gradePenalty) / cold;
  };

  Simulation.prototype._speed = function (v, edge) {
    const cold = this._coldFactor(v);
    if (v.type === 'drone') return v.config.speed * cold;
    const loadRatio = this._cargoWeight(v) / v.config.capacity;
    return v.config.speed * (1 - loadRatio * 0.35) * (1 - edge.grade * 1.2) * cold;
  };

  // 推进一个分钟 tick：同一时间推进系统的唯一入口
  Simulation.prototype.tick = function () {
    if (this.over) return false;
    this.t += 1;
    this.weather = this._weatherAt(this.t);
    this._runScript();

    // 截止时间检查（错过窗口即失败）
    this.batches.forEach(b => {
      if (!b.delivered && !b.late && this.t > b.deadline) {
        const text = b.id + ' 未在截止 t=' + b.deadline +
          ' 前送达 ' + NODES[b.target].name + '（当前 t=' + this.t + '）';
        const before = this._snapshot(this.events.length ? this.events[this.events.length - 1] : null);
        b.late = true;
        this.over = true;
        this.outcome = 'failure';
        this.failureReasons.push('missed-window');
        this._log('failure', { code: 'missed-window' }, '任务失败：' + text);
        const after = this._snapshot(this.events[this.events.length - 1]);
        this.faultSnapshots.push({ code: 'missed-window', text: text,
          before: before, after: after });
      }
    });

    this.vehicles.forEach(v => this._tickVehicle(v));

    if (!this.over && this.batches.every(b => b.delivered)) {
      this._succeed();
    }
    if (!this.over && this.t >= HORIZON) {
      const pending = this.batches.filter(b => !b.delivered).map(b => b.id);
      this._fail('timeup', '到达时间终点仍有未送达物资：' + pending.join(','));
    }
    return true;
  };

  Simulation.prototype._tickVehicle = function (v) {
    if (v.status === 'idle' || v.status === 'lost' || v.status === 'stranded') {
      this._recharge(v);
      return;
    }
    const edge = EDGE_MAP[v.edge];

    if (v.status === 'blocked') {
      const check = this._edgeCheck(v, edge);
      if (check.ok) {
        this._log('unblocked', { vehicle: v.id, edge: v.edge },
          v.name + ' 在 ' + v.edge + ' 恢复通行，继续前进');
        v.status = 'moving';
      } else {
        v.blockedTicks += 1;
        this._recharge(v); // 受阻怠速，仅补能/保温耗电已隐含在不推进中
        return;
      }
    }

    // 行驶中天气/路况恶化（暴风关闭山口）→ 原地阻塞，等待恢复
    if (v.status === 'moving') {
      const check = this._edgeCheck(v, edge);
      if (!check.ok) {
        v.status = 'blocked';
        v.blockedReason = check.reason;
        v.blockedTicks = 1;
        this._log('blocked', { vehicle: v.id, edge: edge.id, reason: check.reason,
          wind: this.weather.wind },
          v.name + ' 行驶至 ' + edge.id + ' 受阻：' + check.reason);
        return;
      }
    }

    // 无人机在移动中遭遇超抗风风速 -> 失联
    if (v.type === 'drone' && this.weather.wind > v.config.windLimit) {
      this._loseVehicle(v, '无人机在强风（' + this.weather.wind.toFixed(1) +
        ' m/s）中失控失联');
      return;
    }

    const drain = this._drainPerTick(v, edge);
    if (v.battery < drain) {
      const text = v.name + ' 在 ' + v.edge + ' 电量耗尽抛锚';
      const before = this._snapshot(this.events.length ? this.events[this.events.length - 1] : null);
      v.status = 'stranded';
      v.battery = 0;
      this.over = true;
      this.outcome = 'failure';
      this.failureReasons.push('stranded');
      this._log('failure', { code: 'stranded' }, '任务失败：' + text);
      const after = this._snapshot(this.events[this.events.length - 1]);
      this.faultSnapshots.push({ code: 'stranded', text: text,
        before: before, after: after });
      return;
    }
    v.battery = +(v.battery - drain).toFixed(4);
    const step = this._speed(v, edge);
    v.edgeRemaining = +(v.edgeRemaining - step).toFixed(4);
    this._updatePosition(v, edge, step);

    if (v.edgeRemaining <= 0) this._arrive(v);
  };

  Simulation.prototype._recharge = function (v) {
    if (v.node !== 'B' || v.status === 'lost') return;
    const cap = v.config.battery * this._coldFactor(v);
    v.battery = Math.min(cap, v.battery + v.config.recharge);
  };

  Simulation.prototype._updatePosition = function (v, edge, step) {
    const a = NODES[v.edgeFrom], b = NODES[v._edgeTo];
    const ratio = Math.max(0, Math.min(1, 1 - v.edgeRemaining / edge.dist));
    v.position = {
      x: a.x + (b.x - a.x) * ratio,
      y: a.y + (b.y - a.y) * ratio
    };
  };

  Simulation.prototype._arrive = function (v) {
    const edgeId = v.route.shift();
    v.pathTraveled.push(edgeId); // 已走路径永久保留
    v.node = v._edgeTo;
    v.position = { x: NODES[v.node].x, y: NODES[v.node].y };
    v.edge = null;
    this._log('arrive', { vehicle: v.id, node: v.node, traveled: v.pathTraveled.slice(),
      battery: +v.battery.toFixed(2) },
      v.name + ' 抵达 ' + NODES[v.node].name + '，电量 ' + v.battery.toFixed(1) + 'kWh');
    // 到达目标站自动卸货
    v.cargo.slice().forEach(bid => {
      if (this.batch(bid).target === v.node) this._cmdUnload(v, { type: 'unload', batch: bid });
    });
    this._startNextEdge(v);
  };

  Simulation.prototype._runScript = function () {
    if (!this.script) return;
    while (this._scriptIdx < this.script.length &&
           this.script[this._scriptIdx].at <= this.t) {
      const item = this.script[this._scriptIdx++];
      const ok = this.command(item.cmd);
      this._log('script', { cmd: item.cmd, accepted: ok },
        '脚本命令 t=' + item.at + ' ' + item.cmd.type + ' 执行' + (ok ? '成功' : '被拒绝'));
    }
  };

  Simulation.prototype._succeed = function () {
    this.over = true;
    this.outcome = 'success';
    this._log('result', { outcome: 'success' }, '三批物资全部准时送达，队伍无人失联，任务成功');
  };

  Simulation.prototype._fail = function (code, text) {
    if (this.over) return;
    this.over = true;
    this.outcome = 'failure';
    this.failureReasons.push(code);
    const before = this._snapshot(this.events.length ? this.events[this.events.length - 1] : null);
    this._log('failure', { code: code }, '任务失败：' + text);
    const after = this._snapshot(this.events[this.events.length - 1]);
    this.faultSnapshots.push({ code: code, text: text, before: before, after: after });
  };

  Simulation.prototype._loseVehicle = function (v, text) {
    const before = this._snapshot(this.events.length ? this.events[this.events.length - 1] : null);
    v.status = 'lost';
    v.cargo.forEach(id => { this.batch(id).carriedBy = null; });
    this.over = true;
    this.outcome = 'failure';
    this.failureReasons.push('lost');
    this._log('failure', { code: 'lost' }, '任务失败：' + text + '，' + v.name + ' 失联');
    const after = this._snapshot(this.events[this.events.length - 1]);
    this.faultSnapshots.push({ code: 'lost', text: text + '，' + v.name + ' 失联',
      before: before, after: after });
  };

  // 关键状态快照（用于故障前后对比与双跑一致性校验）
  Simulation.prototype._snapshot = function (triggerEvent) {
    return {
      t: this.t,
      weather: { temp: this.weather.temp, wind: this.weather.wind, storm: this.weather.storm },
      vehicles: this.vehicles.map(v => ({
        id: v.id, status: v.status, node: v.node,
        battery: +v.battery.toFixed(3), cargo: v.cargo.slice(),
        pathTraveled: v.pathTraveled.slice(), route: v.route.slice(),
        position: { x: +v.position.x.toFixed(3), y: +v.position.y.toFixed(3) }
      })),
      batches: this.batches.map(b => ({
        id: b.id, location: b.location, delivered: b.delivered,
        late: b.late, deliveredAt: b.deliveredAt
      })),
      trigger: triggerEvent ? { kind: triggerEvent.kind, text: triggerEvent.text } : null
    };
  };

  Simulation.prototype.snapshot = function () { return this._snapshot(null); };

  Simulation.prototype._cmdDepart = function (v, cmd) {
    if (v.status !== 'idle') return false;
    let path;
    if (cmd.path) {
      path = cmd.path.slice();
    } else {
      path = findPath(v.node, cmd.to, v.type === 'drone' ? 'air' : 'ground');
    }
    if (!path || !path.length) return false;
    // 校验第一条边与当前节点连通
    const first = edgeEnds(path[0], v.node);
    if (EDGE_MAP[path[0]].mode !== (v.type === 'drone' ? 'air' : 'ground')) return false;
    if (first.from !== v.node) return false;
    v.route = path;
    this._startNextEdge(v);
    this._log('depart', { vehicle: v.id, from: v.node, route: path.slice() },
      v.name + ' 出发，路线 ' + path.join('→'));
    return true;
  };

  // 改道：保留 pathTraveled，仅替换未走完的 route
  Simulation.prototype._cmdReroute = function (v, cmd) {
    if (v.status !== 'moving' && v.status !== 'blocked') return false;
    const mode = v.type === 'drone' ? 'air' : 'ground';
    const path = cmd.path ? cmd.path.slice() : findPath(v.node, cmd.to, mode);
    if (!path || !path.length) return false;
    const first = edgeEnds(path[0], v.node);
    if (EDGE_MAP[path[0]].mode !== mode || first.from !== v.node) return false;
    const oldRoute = v.route.slice();
    v.route = path;
    v.status = 'moving';
    v.blockedTicks = 0;
    this._log('reroute', { vehicle: v.id, kept: v.pathTraveled.slice(), oldRoute: oldRoute,
      newRoute: path.slice() },
      v.name + ' 在 ' + v.node + ' 改道，已走路径 ' +
      (v.pathTraveled.join('→') || '无') + ' 保留，新路线 ' + path.join('→'));
    this._startNextEdge(v);
    return true;
  };

  // ---------- 统一时间推进驱动器：暂停 / 单步 / 连续推进 ----------
  function FixedDriver(sim) {
    this.sim = sim;
    this.paused = false;
    this.pulseCount = 0;
  }

  FixedDriver.prototype.setPaused = function (p) {
    const changed = this.paused !== p;
    this.paused = !!p;
    if (changed) {
      this.sim._log('paused', { paused: this.paused },
        this.paused ? '时间推进暂停于 t=' + this.sim.t : '时间推进恢复于 t=' + this.sim.t);
    }
    return this.paused;
  };

  FixedDriver.prototype.step = function () {
    if (this.paused || this.sim.over) return false;
    const advanced = this.sim.tick();
    if (advanced) this.pulseCount += 1;
    return advanced;
  };

  // 推进 n 个 tick；暂停期间不产生任何状态变化
  FixedDriver.prototype.pulse = function (n) {
    n = n || 1;
    let ran = 0;
    for (let i = 0; i < n; i++) {
      if (this.paused || this.sim.over) break;
      if (this.step()) ran += 1;
    }
    return ran;
  };

  FixedDriver.prototype.runTo = function (targetT) {
    let ran = 0;
    while (!this.paused && !this.sim.over && this.sim.t < targetT) {
      if (this.step()) ran += 1;
    }
    return ran;
  };

  // 资源/任务摘要，供双跑一致性比对
  function digest(sim) {
    return JSON.stringify({
      t: sim.t, over: sim.over, outcome: sim.outcome, reasons: sim.failureReasons,
      vehicles: sim.vehicles.map(v => ({
        id: v.id, status: v.status, node: v.node, battery: +v.battery.toFixed(3),
        cargo: v.cargo.slice(), traveled: v.pathTraveled.slice(), route: v.route.slice()
      })),
      batches: sim.batches.map(b => ({
        id: b.id, location: b.location, delivered: b.delivered,
        late: b.late, deliveredAt: b.deliveredAt
      })),
      events: sim.events.map(e => ({ t: e.t, kind: e.kind, text: e.text }))
    });
  }

  return { NODES, EDGES, EDGE_MAP, BATCH_DEFS, ROVER, DRONE, HORIZON, STORM,
           rng, findPath, edgeEnds, Simulation: Simulation,
           FixedDriver: FixedDriver, digest: digest };
});
