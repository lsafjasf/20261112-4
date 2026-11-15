/*
 * Deterministic earthquake rescue simulation engine.
 * Runs unchanged in the browser (global RescueSim) and in Node (require).
 * One tick == one simulated second; mission horizon is 1200 ticks (20 min).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RescueSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TICK_LIMIT = 1200;
  var WIN_TREATED = 8;
  var SEED = 20261112;
  var AMB_CAPACITY = 2;
  var LOAD_TICKS = 10;
  var UNLOAD_TICKS = 10;
  var TREAT_TICKS = 90;
  var EXTRACT_TICKS = 40;
  var CLEAR_TICKS = 60;
  var OBSERVE_TICKS = 600;

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildMap() {
    var nodes = {
      D:  { id: 'D',  x: 80,  y: 300, kind: 'depot' },
      A:  { id: 'A',  x: 260, y: 120, kind: 'block' },
      B:  { id: 'B',  x: 520, y: 300, kind: 'block' },
      C:  { id: 'C',  x: 260, y: 480, kind: 'block' },
      M1: { id: 'M1', x: 700, y: 120, kind: 'medpoint' },
      M2: { id: 'M2', x: 700, y: 480, kind: 'medpoint' }
    };
    function edge(id, a, b) {
      var dx = nodes[a].x - nodes[b].x;
      var dy = nodes[a].y - nodes[b].y;
      var dist = Math.round(Math.sqrt(dx * dx + dy * dy));
      return { id: id, a: a, b: b, dist: dist, cost: Math.round(dist / 10),
               blocked: false, blockedAtTick: null, clearedAtTick: null };
    }
    var edges = {
      e1: edge('e1', 'D', 'A'),
      e2: edge('e2', 'D', 'B'),
      e3: edge('e3', 'D', 'C'),
      e4: edge('e4', 'A', 'B'),
      e5: edge('e5', 'B', 'C'),
      e6: edge('e6', 'A', 'M1'),
      e7: edge('e7', 'B', 'M1'),
      e8: edge('e8', 'B', 'M2'),
      e9: edge('e9', 'C', 'M2'),
      e10: edge('e10', 'A', 'C'),
      e11: edge('e11', 'M1', 'M2')
    };
    return { nodes: nodes, edges: edges };
  }

  function buildCasualties() {
    function c(id, node, triage, trapped, deadline, degradeAt) {
      return {
        id: id, node: node, triage: triage, trapped: trapped,
        state: trapped ? 'TRAPPED' : 'WAITING',
        deadline: deadline, degradeAt: degradeAt || null,
        assignedTo: null, carrier: null, bedAt: null,
        treatedAt: null, diedAt: null, history: []
      };
    }
    return {
      c1: c('c1', 'A', 'YELLOW', false, 700, 400),
      c2: c('c2', 'A', 'GREEN', false, 1000, null),
      c3: c('c3', 'A', 'RED', false, 500, null),
      c4: c('c4', 'A', 'YELLOW', true, 900, 500),
      c5: c('c5', 'B', 'RED', false, 550, null),
      c6: c('c6', 'B', 'YELLOW', false, 760, 460),
      c7: c('c7', 'B', 'GREEN', true, 1050, null),
      c8: c('c8', 'C', 'RED', false, 600, null),
      c9: c('c9', 'C', 'YELLOW', false, 820, 520),
      c10: c('c10', 'C', 'YELLOW', true, 960, 600)
    };
  }

  /* Fixed event timetable, drawn once from the seeded RNG at construction.
     The generated schedule is stored on the engine and snapshotted, so the
     "random" event order is identical across every reset and replay. */
  function buildSchedule(rng) {
    var candidates = ['e5', 'e3', 'e10', 'e8', 'e4'];
    var times = [120, 480, 780];
    var events = [];
    var chosen = [];
    for (var i = 0; i < times.length; i++) {
      var pick;
      do {
        pick = candidates[Math.floor(rng() * candidates.length)];
      } while (chosen.indexOf(pick) !== -1);
      chosen.push(pick);
      events.push({ tick: times[i], kind: 'AFTERSHOCK', edge: pick,
                    magnitude: 5 + Math.floor(rng() * 3) });
    }
    return events;
  }

  function findEdge(map, a, b) {
    var keys = Object.keys(map.edges);
    for (var i = 0; i < keys.length; i++) {
      var e = map.edges[keys[i]];
      if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return e;
    }
    return null;
  }

  function shortestPath(map, from, to) {
    if (from === to) return { nodes: [to], edges: [], cost: 0 };
    var dist = {}, prev = {}, prevEdge = {}, visited = {};
    var all = Object.keys(map.nodes);
    all.forEach(function (n) { dist[n] = Infinity; });
    dist[from] = 0;
    while (true) {
      var cur = null;
      all.forEach(function (n) {
        if (!visited[n] && (cur === null || dist[n] < dist[cur])) cur = n;
      });
      if (cur === null || dist[cur] === Infinity) break;
      visited[cur] = true;
      Object.keys(map.edges).forEach(function (ek) {
        var e = map.edges[ek];
        if (e.blocked) return;
        var nb = null;
        if (e.a === cur) nb = e.b;
        else if (e.b === cur) nb = e.a;
        if (nb && !visited[nb] && dist[cur] + e.cost < dist[nb]) {
          dist[nb] = dist[cur] + e.cost;
          prev[nb] = cur;
          prevEdge[nb] = ek;
        }
      });
    }
    if (dist[to] === Infinity) return null;
    var nodes = [], edges = [];
    var n = to;
    while (n !== from) {
      nodes.unshift(n);
      edges.unshift(prevEdge[n]);
      n = prev[n];
    }
    return { nodes: nodes, edges: edges, cost: dist[to] };
  }

  function Engine(seed) {
    this.seed = seed == null ? SEED : seed;
    this.reset();
  }

  Engine.prototype.reset = function () {
    var rng = mulberry32(this.seed);
    var map = buildMap();
    this.state = {
      tick: 0,
      status: 'RUNNING',
      map: map,
      casualties: buildCasualties(),
      schedule: buildSchedule(rng),
      scheduleDrawn: rng().toFixed(6),
      ambulances: {
        AMB1: { id: 'AMB1', node: 'D', edge: null, fromNode: null, toNode: null,
                edgeProgress: 0, mode: 'IDLE', timer: 0, passengers: [],
                pathNodes: [], pathEdges: [], target: null, pickup: [],
                deliverTo: null, idleTicks: 0, reroutes: 0, tasks: 0 },
        AMB2: { id: 'AMB2', node: 'D', edge: null, fromNode: null, toNode: null,
                edgeProgress: 0, mode: 'IDLE', timer: 0, passengers: [],
                pathNodes: [], pathEdges: [], target: null, pickup: [],
                deliverTo: null, idleTicks: 0, reroutes: 0, tasks: 0 },
        AMB3: { id: 'AMB3', node: 'D', edge: null, fromNode: null, toNode: null,
                edgeProgress: 0, mode: 'IDLE', timer: 0, passengers: [],
                pathNodes: [], pathEdges: [], target: null, pickup: [],
                deliverTo: null, idleTicks: 0, reroutes: 0, tasks: 0 }
      },
      sar: { id: 'SAR', node: 'D', edge: null, fromNode: null, toNode: null,
             edgeProgress: 0, mode: 'IDLE', timer: 0,
             pathNodes: [], pathEdges: [], target: null, job: null,
             casualtyId: null, edgeId: null, idleTicks: 0, reroutes: 0, tasks: 0,
             queue: [] },
      medpoints: {
        M1: { id: 'M1', capacity: 3, beds: {}, queueTimer: 0 },
        M2: { id: 'M2', capacity: 3, beds: {} }
      },
      stats: { treated: 0, dead: 0, idleTicks: 0, rejected: 0,
               aftershocks: 0, reroutes: 0, reopened: 0 },
      log: [],
      commands: [],
      faultSnapshots: [],
      wonAt: null, lostReason: null
    };
    return this.state;
  };

  Engine.prototype.log = function (kind, detail) {
    var entry = { tick: this.state.tick, kind: kind, detail: detail || {} };
    this.state.log.push(entry);
    return entry;
  };

  Engine.prototype.loadScript = function (commands) {
    this.state.commands = commands.map(function (c) {
      return { at: c.at, cmd: c.cmd };
    }).sort(function (a, b) { return a.at - b.at; });
  };

  Engine.prototype.snapshot = function () {
    return JSON.parse(JSON.stringify(this.state));
  };

  Engine.prototype.movingEntities = function () {
    var s = this.state;
    return Object.keys(s.ambulances).map(function (k) { return s.ambulances[k]; })
      .concat([s.sar]);
  };

  Engine.prototype._startMove = function (ent, dest) {
    var route = shortestPath(this.state.map, ent.node, dest);
    if (!route) {
      this.log('NO_PATH', { entity: ent.id, dest: dest });
      return false;
    }
    ent.target = dest;
    ent.pathNodes = route.nodes;
    ent.pathEdges = route.edges;
    ent.mode = 'MOVING';
    return true;
  };

  Engine.prototype._reroute = function (ent) {
    var s = this.state;
    if (ent.edge) ent.node = ent.fromNode;
    ent.edge = null; ent.fromNode = null; ent.toNode = null; ent.edgeProgress = 0;
    var route = shortestPath(s.map, ent.node, ent.target);
    if (!route) {
      ent.mode = 'IDLE';
      ent.pathNodes = []; ent.pathEdges = [];
      this.log('STUCK', { entity: ent.id, node: ent.node, target: ent.target });
      return false;
    }
    ent.reroutes++;
    s.stats.reroutes++;
    ent.pathNodes = route.nodes;
    ent.pathEdges = route.edges;
    this.log('REROUTE', { entity: ent.id, node: ent.node,
                          target: ent.target, newCost: route.cost });
    return true;
  };

  Engine.prototype.dispatch = function (ambId, casualtyIds, medpointId) {
    var s = this.state;
    var amb = s.ambulances[ambId];
    if (!amb) return this._reject('BAD_AMBULANCE', { ambId: ambId });
    if (amb.mode !== 'IDLE') return this._reject('AMB_BUSY', { ambId: ambId, mode: amb.mode });
    if (!medpointId || !s.medpoints[medpointId])
      return this._reject('BAD_MEDPOINT', { medpointId: medpointId });
    if (!Array.isArray(casualtyIds) || casualtyIds.length === 0 ||
        casualtyIds.length > AMB_CAPACITY)
      return this._reject('BAD_CAPACITY', { ambId: ambId, count: (casualtyIds || []).length });
    var node = null, ids = [];
    for (var i = 0; i < casualtyIds.length; i++) {
      var cas = s.casualties[casualtyIds[i]];
      if (!cas) return this._reject('BAD_CASUALTY', { casualtyId: casualtyIds[i] });
      if (cas.state !== 'WAITING')
        return this._reject('CAS_NOT_READY', { casualtyId: cas.id, state: cas.state });
      if (cas.assignedTo)
        return this._reject('CAS_ASSIGNED', { casualtyId: cas.id, assignedTo: cas.assignedTo });
      if (node === null) node = cas.node;
      else if (node !== cas.node) return this._reject('MIXED_NODES', { casualtyId: cas.id });
      ids.push(cas.id);
    }
    ids.forEach(function (id) { s.casualties[id].assignedTo = ambId; });
    amb.pickup = ids;
    amb.deliverTo = medpointId;
    amb.tasks++;
    this.log('DISPATCH', { amb: ambId, casualties: ids, from: node, to: medpointId });
    return this._startMove(amb, node);
  };

  Engine.prototype.extract = function (casualtyId) {
    var s = this.state, sar = s.sar;
    var cas = s.casualties[casualtyId];
    if (!cas) return this._reject('BAD_CASUALTY', { casualtyId: casualtyId });
    if (cas.state !== 'TRAPPED') return this._reject('NOT_TRAPPED', { casualtyId: cas.id });
    if (sar.mode !== 'IDLE') {
      sar.queue.push({ type: 'EXTRACT', casualty: cas.id });
      this.log('SAR_QUEUED', { casualty: cas.id, queue: sar.queue.length });
      return { ok: true, queued: true };
    }
    sar.job = 'EXTRACT';
    sar.casualtyId = cas.id;
    sar.tasks++;
    this.log('SAR_EXTRACT', { casualty: cas.id, node: cas.node });
    return this._startMove(sar, cas.node);
  };

  Engine.prototype.clearEdge = function (edgeId) {
    var s = this.state, sar = s.sar;
    var e = s.map.edges[edgeId];
    if (!e) return this._reject('BAD_EDGE', { edgeId: edgeId });
    if (sar.mode !== 'IDLE') {
      sar.queue.push({ type: 'CLEAR', edge: edgeId });
      this.log('SAR_QUEUED', { edge: edgeId, queue: sar.queue.length });
      return { ok: true, queued: true };
    }
    if (!e.blocked) {
      sar.queue.push({ type: 'CLEAR', edge: edgeId });
      this.log('SAR_QUEUED', { edge: edgeId, queue: sar.queue.length, note: 'AWAIT_BLOCK' });
      return { ok: true, queued: true };
    }
    sar.job = 'CLEAR';
    sar.edgeId = edgeId;
    sar.tasks++;
    this.log('SAR_CLEAR', { edge: edgeId, target: e.a });
    return this._startMove(sar, e.a);
  };

  Engine.prototype.reposition = function (ambId, node) {
    var s = this.state;
    var amb = s.ambulances[ambId];
    if (!amb) return this._reject('BAD_AMBULANCE', { ambId: ambId });
    if (amb.mode !== 'IDLE') return this._reject('AMB_BUSY', { ambId: ambId, mode: amb.mode });
    if (!s.map.nodes[node]) return this._reject('BAD_NODE', { node: node });
    if (amb.node === node) return { ok: true, skipped: true };
    amb.deliverTo = null;
    amb.tasks++;
    this.log('REPOSITION', { amb: ambId, to: node });
    return this._startMove(amb, node);
  };

  Engine.prototype._reject = function (reason, detail) {
    this.state.stats.rejected++;
    var entry = this.log('REJECT', Object.assign({ reason: reason }, detail));
    return { ok: false, reason: reason, entry: entry };
  };

  Engine.prototype._tickMovement = function (ent) {
    var s = this.state;
    if (ent.mode !== 'MOVING') return;
    if (ent.pathEdges.length === 0) {
      this._arrive(ent);
      return;
    }
    if (!ent.edge) {
      var edgeId = ent.pathEdges[0];
      var e = s.map.edges[edgeId];
      if (e.blocked) { this._reroute(ent); return; }
      ent.edge = edgeId;
      ent.fromNode = ent.node;
      ent.toNode = ent.pathNodes[0];
      ent.edgeProgress = 0;
    }
    var edge = s.map.edges[ent.edge];
    if (edge.blocked) { this._reroute(ent); return; }
    ent.edgeProgress++;
    if (ent.edgeProgress >= edge.cost) {
      ent.node = ent.toNode;
      ent.pathEdges.shift();
      ent.pathNodes.shift();
      ent.edge = null; ent.fromNode = null; ent.toNode = null; ent.edgeProgress = 0;
      if (ent.pathEdges.length === 0) {
        this._arrive(ent);
      }
    }
  };

  Engine.prototype._arrive = function (ent) {
    var s = this.state;
    if (ent === s.sar) { this._sarArrive(s.sar); return; }
    var amb = ent;
    if (amb.pickup.length > 0) {
      amb.mode = 'LOADING';
      amb.timer = LOAD_TICKS;
    } else if (!amb.deliverTo) {
      amb.mode = 'IDLE';
      amb.target = null;
      amb.pathNodes = []; amb.pathEdges = [];
    } else {
      var mp = s.medpoints[amb.deliverTo];
      if (Object.keys(mp.beds).length < mp.capacity) {
        amb.mode = 'UNLOADING';
        amb.timer = UNLOAD_TICKS;
      } else {
        amb.mode = 'WAITING_BED';
      }
    }
  };

  Engine.prototype._sarArrive = function (sar) {
    if (sar.job === 'EXTRACT') {
      sar.mode = 'EXTRACTING';
      sar.timer = EXTRACT_TICKS;
    } else if (sar.job === 'CLEAR') {
      var e = this.state.map.edges[sar.edgeId];
      if (e.blocked && (e.a === sar.node || e.b === sar.node)) {
        sar.mode = 'CLEARING';
        sar.timer = CLEAR_TICKS;
      } else if (!e.blocked) {
        this.log('ROAD_ALREADY_OPEN', { edge: e.id });
        this._sarToIdle();
      } else {
        if (!this._reroute(sar)) this.log('SAR_CANNOT_REACH', { edge: e.id });
      }
    }
  };

  var TRIAGE_RANK = { GREEN: 0, YELLOW: 1, RED: 2, BLACK: 3 };

  Engine.prototype._tickJobs = function () {
    var s = this.state;
    Object.keys(s.ambulances).forEach(function (id) {
      var amb = s.ambulances[id];
      if (amb.mode === 'LOADING' || amb.mode === 'UNLOADING') {
        amb.timer--;
        if (amb.timer <= 0) this._finishStationary(amb);
      }
      if (amb.mode === 'IDLE') amb.idleTicks++;
    }, this);
    var sar = s.sar;
    if (sar.mode === 'EXTRACTING' || sar.mode === 'CLEARING') {
      sar.timer--;
      if (sar.timer <= 0) this._finishSar(sar);
    }
    if (sar.mode === 'IDLE') sar.idleTicks++;
  };

  Engine.prototype._finishStationary = function (amb) {
    var s = this.state;
    if (amb.mode === 'LOADING') {
      var picked = [];
      amb.pickup.forEach(function (cid) {
        var cas = s.casualties[cid];
        if (cas && cas.state === 'WAITING' && cas.assignedTo === amb.id) {
          cas.state = 'IN_TRANSIT';
          cas.carrier = amb.id;
          cas.assignedTo = null;
          amb.passengers.push(cid);
          picked.push(cid);
        }
      });
      amb.pickup = [];
      this.log('LOADED', { amb: amb.id, casualties: picked, node: amb.node });
      this._startMove(amb, amb.deliverTo);
    } else if (amb.mode === 'UNLOADING') {
      var mp = s.medpoints[amb.deliverTo];
      var unloaded = [];
      amb.passengers.slice().forEach(function (cid) {
        var cas = s.casualties[cid];
        if (cas && Object.keys(mp.beds).length < mp.capacity) {
          cas.state = 'TREATING';
          cas.carrier = null;
          cas.bedAt = mp.id;
          cas.history.push({ tick: s.tick, event: 'BED' });
          mp.beds[cid] = { casualtyId: cid, since: s.tick, remaining: TREAT_TICKS };
          amb.passengers.splice(amb.passengers.indexOf(cid), 1);
          unloaded.push(cid);
        }
      });
      this.log('UNLOADED', { amb: amb.id, casualties: unloaded, medpoint: mp.id });
      if (amb.passengers.length === 0) {
        amb.mode = 'IDLE';
        amb.target = null; amb.deliverTo = null;
        amb.pathNodes = []; amb.pathEdges = [];
      } else {
        amb.mode = 'WAITING_BED';
      }
    }
  };

  Engine.prototype._finishSar = function (sar) {
    var s = this.state;
    if (sar.mode === 'EXTRACTING') {
      var cas = s.casualties[sar.casualtyId];
      if (cas && cas.state === 'TRAPPED') {
        cas.state = 'WAITING';
        cas.trapped = false;
        cas.history.push({ tick: s.tick, event: 'EXTRACTED' });
        this.log('EXTRACTED', { casualty: cas.id, node: sar.node });
      }
      this._sarToIdle();
    } else if (sar.mode === 'CLEARING') {
      var e = s.map.edges[sar.edgeId];
      e.blocked = false;
      e.clearedAtTick = s.tick;
      s.stats.reopened++;
      this.log('ROAD_OPEN', { edge: e.id, tick: s.tick });
      this._sarToIdle();
      this.movingEntities().forEach(function (ent) {
        if (ent.mode === 'IDLE' && ent.target) this._reroute(ent);
      }, this);
    }
  };

  Engine.prototype._sarToIdle = function () {
    var sar = this.state.sar;
    sar.mode = 'IDLE';
    sar.job = null; sar.casualtyId = null; sar.edgeId = null;
    sar.target = null; sar.pathNodes = []; sar.pathEdges = [];
    while (sar.queue.length) {
      var next = sar.queue.shift();
      var res = next.type === 'EXTRACT'
        ? this.extract(next.casualty)
        : this.clearEdge(next.edge);
      if (res && res.ok) return;
    }
  };

  Engine.prototype._tickBeds = function () {
    var s = this.state;
    Object.keys(s.medpoints).forEach(function (mid) {
      var mp = s.medpoints[mid];
      Object.keys(mp.beds).forEach(function (cid) {
        var bed = mp.beds[cid];
        var cas = s.casualties[cid];
        bed.remaining--;
        if (bed.remaining <= 0) {
          cas.state = 'TREATED';
          cas.treatedAt = s.tick;
          cas.bedAt = null;
          cas.history.push({ tick: s.tick, event: 'TREATED' });
          delete mp.beds[cid];
          s.stats.treated++;
          this.log('TREATED', { casualty: cid, medpoint: mid });
        }
      }, this);
    }, this);
    Object.keys(s.ambulances).forEach(function (id) {
      var amb = s.ambulances[id];
      if (amb.mode === 'WAITING_BED') {
        var mp = s.medpoints[amb.deliverTo];
        if (Object.keys(mp.beds).length < mp.capacity) {
          amb.mode = 'UNLOADING';
          amb.timer = UNLOAD_TICKS;
        }
      }
    });
  };

  Engine.prototype._tickCasualties = function () {
    var s = this.state;
    Object.keys(s.casualties).forEach(function (cid) {
      var cas = s.casualties[cid];
      if (cas.state === 'TREATED' || cas.state === 'DEAD') return;
      if (cas.degradeAt !== null && s.tick >= cas.degradeAt &&
          TRIAGE_RANK[cas.triage] < TRIAGE_RANK.RED) {
        var old = cas.triage;
        cas.triage = TRIAGE_RANK[old] === 1 ? 'RED' : 'YELLOW';
        cas.degradeAt = null;
        cas.history.push({ tick: s.tick, event: 'DEGRADE', from: old, to: cas.triage });
        this.log('DEGRADE', { casualty: cid, from: old, to: cas.triage });
      }
      if (s.tick >= cas.deadline &&
          (cas.state === 'WAITING' || cas.state === 'TRAPPED' || cas.state === 'IN_TRANSIT')) {
        cas.state = 'DEAD';
        cas.diedAt = s.tick;
        cas.history.push({ tick: s.tick, event: 'DIED' });
        if (cas.assignedTo) {
          var amb = s.ambulances[cas.assignedTo];
          if (amb) amb.pickup = amb.pickup.filter(function (x) { return x !== cid; });
          cas.assignedTo = null;
        }
        if (cas.carrier) {
          var car = s.ambulances[cas.carrier];
          if (car) car.passengers = car.passengers.filter(function (x) { return x !== cid; });
          cas.carrier = null;
        }
        s.stats.dead++;
        this.log('CASUALTY_DIED', { casualty: cid, node: cas.node });
      }
    }, this);
  };

  Engine.prototype._tickAftershocks = function () {
    var s = this.state;
    var due = s.schedule.filter(function (ev) { return ev.tick === s.tick && !ev.done; });
    due.forEach(function (ev) {
      ev.done = true;
      var edge = s.map.edges[ev.edge];
      var before = this._routeSummary(edge);
      edge.blocked = true;
      edge.blockedAtTick = s.tick;
      s.stats.aftershocks++;
      this.log('AFTERSHOCK', { edge: edge.id, magnitude: ev.magnitude,
                               zone: edge.a + '-' + edge.b });
      var affected = this.movingEntities().filter(function (ent) {
        return ent.pathEdges.indexOf(edge.id) !== -1 || ent.edge === edge.id;
      }, this);
      affected.forEach(function (ent) { this._reroute(ent); }, this);
      var after = this._routeSummary(edge);
      s.faultSnapshots.push({
        tick: s.tick,
        edge: edge.id,
        magnitude: ev.magnitude,
        before: before,
        after: after,
        affectedEntities: affected.map(function (ent) {
          return { id: ent.id, reroutes: ent.reroutes, node: ent.node, target: ent.target };
        })
      });
    }, this);
  };

  Engine.prototype._routeSummary = function (blockedEdge) {
    var s = this.state;
    var pairs = [['D', 'A'], ['D', 'B'], ['D', 'C'],
                 ['A', 'M1'], ['B', 'M2'], ['C', 'M2'],
                 ['B', 'C'], ['C', 'B']];
    return pairs.map(function (p) {
      var route = shortestPath(s.map, p[0], p[1]);
      return { pair: p[0] + '>' + p[1],
               reachable: !!route,
               cost: route ? route.cost : null,
               edges: route ? route.edges.slice() : null };
    });
  };

  Engine.prototype._tickCommands = function () {
    var s = this.state;
    while (s.commands.length && s.commands[0].at <= s.tick) {
      var item = s.commands.shift();
      this._runCommand(item.cmd);
    }
  };

  Engine.prototype._runCommand = function (cmd) {
    this.log('COMMAND', { cmd: cmd });
    switch (cmd.type) {
      case 'DISPATCH':
        return this.dispatch(cmd.amb, cmd.casualties, cmd.medpoint);
      case 'EXTRACT':
        return this.extract(cmd.casualty);
      case 'CLEAR':
        return this.clearEdge(cmd.edge);
      case 'REPOSITION':
        return this.reposition(cmd.amb, cmd.node);
      default:
        return this._reject('UNKNOWN_COMMAND', { type: cmd.type });
    }
  };

  Engine.prototype.step = function () {
    var s = this.state;
    if (s.status !== 'RUNNING') return s.status;
    this._tickCommands();
    this._tickAftershocks();
    this.movingEntities().forEach(this._tickMovement, this);
    this._tickJobs();
    this._tickBeds();
    this._tickCasualties();
    if (s.stats.treated >= WIN_TREATED) {
      s.status = 'WON';
      s.wonAt = s.tick;
      this.log('MISSION_WON', { treated: s.stats.treated, tick: s.tick });
    } else if (s.stats.dead > 10 - WIN_TREATED) {
      s.status = 'LOST';
      s.lostReason = 'TOO_MANY_DEAD';
      this.log('MISSION_LOST', { reason: s.lostReason, dead: s.stats.dead });
    } else if (s.tick >= TICK_LIMIT) {
      s.status = 'LOST';
      s.lostReason = 'TIME_LIMIT';
      this.log('MISSION_LOST', { reason: s.lostReason, treated: s.stats.treated });
    }
    s.tick++;
    return s.status;
  };

  Engine.prototype.forceStep = function () {
    var s = this.state;
    this._tickCommands();
    this._tickAftershocks();
    this.movingEntities().forEach(this._tickMovement, this);
    this._tickJobs();
    this._tickBeds();
    this._tickCasualties();
    s.tick++;
    return s.status;
  };

  Engine.prototype.observe = function (extraTicks) {
    var s = this.state;
    var target = s.tick + extraTicks;
    while (s.tick < target) this.forceStep();
    return s;
  };

  Engine.prototype.run = function (limit) {
    var cap = limit == null ? TICK_LIMIT : limit;
    while (this.state.status === 'RUNNING' && this.state.tick < cap) this.step();
    return this.state;
  };

  Engine.prototype.idleResourceReport = function () {
    var s = this.state;
    return {
      ambulances: Object.keys(s.ambulances).map(function (id) {
        var a = s.ambulances[id];
        return { id: id, idleTicks: a.idleTicks, reroutes: a.reroutes,
                 tasks: a.tasks, mode: a.mode };
      }),
      sar: { idleTicks: s.sar.idleTicks, tasks: s.sar.tasks, mode: s.sar.mode },
      medpoints: Object.keys(s.medpoints).map(function (id) {
        var m = s.medpoints[id];
        return { id: id, occupied: Object.keys(m.beds).length, capacity: m.capacity };
      }),
      rejected: s.stats.rejected
    };
  };

  return {
    TICK_LIMIT: TICK_LIMIT,
    WIN_TREATED: WIN_TREATED,
    AMB_CAPACITY: AMB_CAPACITY,
    LOAD_TICKS: LOAD_TICKS,
    UNLOAD_TICKS: UNLOAD_TICKS,
    TREAT_TICKS: TREAT_TICKS,
    EXTRACT_TICKS: EXTRACT_TICKS,
    CLEAR_TICKS: CLEAR_TICKS,
    OBSERVE_TICKS: OBSERVE_TICKS,
    mulberry32: mulberry32,
    buildMap: buildMap,
    buildCasualties: buildCasualties,
    buildSchedule: buildSchedule,
    shortestPath: shortestPath,
    findEdge: findEdge,
    Engine: Engine
  };
});
