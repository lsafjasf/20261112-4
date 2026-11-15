/* Browser UI: Canvas map, triage colours, aftershock zones, entities,
   control panel (pause / step / reset / speed / scenarios / mute). */
(function () {
  'use strict';

  var RS = window.RescueSim;
  var SC = window.RescueScenarios;
  var AudioManager = window.RescueAudio;

  var canvas = document.getElementById('map');
  var ctx = canvas.getContext('2d');
  var audio = new AudioManager();
  var engine = new RS.Engine();
  var activeScript = SC.winningScript;
  var paused = true;
  var speed = 4;
  var timer = null;
  var lastFaultCount = 0;
  var lastTreated = 0;

  var TRIAGE_COLOR = {
    RED: '#e05252',
    YELLOW: '#e8b53a',
    GREEN: '#4caf6d',
    BLACK: '#555'
  };

  function el(id) { return document.getElementById(id); }

  function loadScenario(script) {
    activeScript = script;
    resetAll();
  }

  function resetAll() {
    engine = new RS.Engine();
    engine.loadScript(activeScript.map(function (c) {
      return { at: c.at, cmd: JSON.parse(JSON.stringify(c.cmd)) };
    }));
    paused = true;
    lastFaultCount = 0;
    lastTreated = 0;
    el('runState').textContent = '已重置 / 暂停';
    render();
    renderPanel();
    renderLog();
  }

  function tickOnce() {
    if (engine.state.status !== 'RUNNING') {
      el('runState').textContent =
        engine.state.status === 'WON' ? '任务成功' : '任务失败：' + engine.state.lostReason;
      render();
      renderPanel();
      return;
    }
    engine.step();
    var s = engine.state;
    if (s.faultSnapshots.length > lastFaultCount) {
      lastFaultCount = s.faultSnapshots.length;
      audio.alarm();
    }
    if (s.stats.treated > lastTreated) {
      lastTreated = s.stats.treated;
      audio.success();
    }
    render();
    renderPanel();
    renderLog();
  }

  function loop() {
    clearTimeout(timer);
    if (paused) return;
    tickOnce();
    if (engine.state.status === 'RUNNING') {
      timer = setTimeout(loop, 1000 / speed);
    } else {
      paused = true;
      el('runState').textContent =
        engine.state.status === 'WON' ? '任务成功' : '任务失败：' + engine.state.lostReason;
      if (engine.state.status === 'LOST') audio.error();
    }
  }

  function setPaused(value) {
    paused = value;
    el('runState').textContent = paused ? '暂停中' : '运行中（' + speed + 'x）';
    if (!paused) {
      audio.ensure();
      audio.blip();
      loop();
    }
  }

  function edgePoints(edge) {
    var map = engine.state.map;
    return { p1: map.nodes[edge.a], p2: map.nodes[edge.b] };
  }

  function entityPosition(ent) {
    var map = engine.state.map;
    if (!ent.edge) {
      var n = map.nodes[ent.node];
      return { x: n.x, y: n.y };
    }
    var edge = map.edges[ent.edge];
    var from = map.nodes[ent.fromNode];
    var to = map.nodes[ent.toNode];
    var ratio = ent.edgeProgress / edge.cost;
    return {
      x: from.x + (to.x - from.x) * ratio,
      y: from.y + (to.y - from.y) * ratio
    };
  }

  function drawEdges() {
    var map = engine.state.map;
    Object.keys(map.edges).forEach(function (id) {
      var edge = map.edges[id];
      var pts = edgePoints(edge);
      ctx.beginPath();
      ctx.moveTo(pts.p1.x, pts.p1.y);
      ctx.lineTo(pts.p2.x, pts.p2.y);
      if (edge.blocked) {
        ctx.strokeStyle = '#b23b3b';
        ctx.lineWidth = 7;
        ctx.setLineDash([10, 8]);
      } else {
        ctx.strokeStyle = '#8a93a6';
        ctx.lineWidth = 4;
        ctx.setLineDash([]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (edge.blocked) drawAftershockZone(edge, pts);
    });
  }

  function drawAftershockZone(edge, pts) {
    var mx = (pts.p1.x + pts.p2.x) / 2;
    var my = (pts.p1.y + pts.p2.y) / 2;
    var pulse = 16 + Math.sin(engine.state.tick / 6) * 4;
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.arc(mx, my, pulse + 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#7a1f1f';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('余震 ' + edge.id, mx, my - pulse - 6);
    ctx.restore();
  }

  function drawNodes() {
    var map = engine.state.map;
    Object.keys(map.nodes).forEach(function (id) {
      var n = map.nodes[id];
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.kind === 'depot' ? 16 : 20, 0, Math.PI * 2);
      if (n.kind === 'depot') ctx.fillStyle = '#39455e';
      else if (n.kind === 'medpoint') ctx.fillStyle = '#2f7d8c';
      else ctx.fillStyle = '#4a5470';
      ctx.fill();
      ctx.strokeStyle = '#dfe6f5';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(id, n.x, n.y);
      if (n.kind === 'medpoint') drawBedBadge(n, id);
    });
  }

  function drawBedBadge(node, medId) {
    var mp = engine.state.medpoints[medId];
    var used = Object.keys(mp.beds).length;
    ctx.fillStyle = used >= mp.capacity ? '#e05252' : '#9fe0b0';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(used + '/' + mp.capacity, node.x, node.y + 30);
  }

  function drawCasualties() {
    var map = engine.state.map;
    var grouped = {};
    Object.keys(engine.state.casualties).forEach(function (id) {
      var c = engine.state.casualties[id];
      if (c.state === 'TREATED' || c.state === 'DEAD' || c.carrier) return;
      (grouped[c.node] = grouped[c.node] || []).push(c);
    });
    Object.keys(grouped).forEach(function (nodeId) {
      var n = map.nodes[nodeId];
      grouped[nodeId].forEach(function (c, i) {
        var angle = (i / grouped[nodeId].length) * Math.PI * 2;
        var x = n.x + Math.cos(angle) * 32;
        var y = n.y + Math.sin(angle) * 32 + 24;
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fillStyle = TRIAGE_COLOR[c.triage] || '#999';
        ctx.fill();
        ctx.strokeStyle = c.state === 'TRAPPED' ? '#ffd166' : '#fff';
        ctx.lineWidth = c.state === 'TRAPPED' ? 3 : 1.5;
        ctx.stroke();
        ctx.fillStyle = '#1a1f2b';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.id.replace('c', ''), x, y);
      });
    });
  }

  function drawEntities() {
    engine.movingEntities().forEach(function (ent, idx) {
      var pos = entityPosition(ent);
      var isSar = ent.id === 'SAR';
      ctx.save();
      ctx.translate(pos.x + (idx - 2) * 4, pos.y - 22);
      ctx.fillStyle = isSar ? '#b06ac9' : '#5aa9e6';
      ctx.strokeStyle = '#0e1420';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (isSar) {
      ctx.rect(-9, -9, 18, 18);
      } else {
        ctx.arc(0, 0, 10, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#0e1420';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isSar ? 'SAR' : ent.id.replace('AMB', 'A'), 0, 0);
      ctx.restore();
      if (ent.pathEdges.length) drawPlannedPath(ent);
    });
  }

  function drawPlannedPath(ent) {
    var map = engine.state.map;
    var start = entityPosition(ent);
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    var currentNode = ent.edge ? ent.toNode : ent.node;
    ctx.lineTo(map.nodes[currentNode].x, map.nodes[currentNode].y);
    ent.pathNodes.forEach(function (nid) {
      ctx.lineTo(map.nodes[nid].x, map.nodes[nid].y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111726';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawEdges();
    drawNodes();
    drawCasualties();
    drawEntities();
    drawHud();
  }

  function drawHud() {
    var s = engine.state;
    var mm = Math.floor(s.tick / 60);
    var ss = s.tick % 60;
    ctx.fillStyle = '#dfe6f5';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('任务时间 ' + mm + ':' + String(ss).padStart(2, '0') +
      ' / 20:00   已处置 ' + s.stats.treated + '/8   死亡 ' + s.stats.dead +
      '   余震 ' + s.stats.aftershocks + '   重算 ' + s.stats.reroutes,
      14, 24);
  }

  function renderPanel() {
    var s = engine.state;
    var rows = Object.keys(s.ambulances).map(function (id) {
      var a = s.ambulances[id];
      return '<tr><td>' + id + '</td><td>' + modeLabel(a.mode) +
        '</td><td>' + a.node + '</td><td>' + a.passengers.length +
        '/2</td><td>' + a.reroutes + '</td><td>' + a.idleTicks + '</td></tr>';
    }).join('');
    var sar = s.sar;
    rows += '<tr><td>SAR</td><td>' + modeLabel(sar.mode) +
      '</td><td>' + sar.node + '</td><td>-</td><td>' + sar.reroutes +
      '</td><td>' + sar.idleTicks + '</td></tr>';
    el('resourceRows').innerHTML = rows;
    var mp = Object.keys(s.medpoints).map(function (id) {
      return id + ': ' + Object.keys(s.medpoints[id].beds).length +
        '/' + s.medpoints[id].capacity;
    }).join('　');
    el('bedState').textContent = mp;
    el('faultState').textContent = s.faultSnapshots.map(function (f) {
      return 't' + f.tick + ' 断 ' + f.edge;
    }).join('；') || '暂无';
  }

  function modeLabel(mode) {
    return {
      IDLE: '空闲', MOVING: '行驶', LOADING: '装载', UNLOADING: '卸载',
      WAITING_BED: '等床位', EXTRACTING: '搜救', CLEARING: '清障'
    }[mode] || mode;
  }

  function renderLog() {
    var entries = engine.state.log.slice(-12).reverse();
    el('eventLog').innerHTML = entries.map(function (l) {
      return '<li><span class="tick">t' + l.tick + '</span> ' +
        logLabel(l) + '</li>';
    }).join('');
  }

  function logLabel(l) {
    var d = l.detail;
    switch (l.kind) {
      case 'AFTERSHOCK': return '余震阻断 ' + d.edge + '（震级 ' + d.magnitude + '）';
      case 'REROUTE': return d.entity + ' 路径重算，新成本 ' + d.newCost;
      case 'ROAD_OPEN': return '道路 ' + d.edge + ' 已恢复通行';
      case 'TREATED': return d.casualty + ' 救治完成 @ ' + d.medpoint;
      case 'CASUALTY_DIED': return d.casualty + ' 伤重不治 @ ' + d.node;
      case 'DISPATCH': return d.amb + ' 出动：' + d.casualties.join(',') + ' → ' + d.to;
      case 'REJECT': return '指令被拒绝：' + d.reason;
      case 'MISSION_WON': return '任务成功，共处置 ' + d.treated + ' 人';
      case 'MISSION_LOST': return '任务失败：' + d.reason;
      default: return l.kind + ' ' + JSON.stringify(d);
    }
  }

  el('btnStart').addEventListener('click', function () {
    audio.ensure();
    setPaused(false);
  });
  el('btnPause').addEventListener('click', function () { setPaused(true); });
  el('btnStep').addEventListener('click', function () {
    audio.ensure();
    setPaused(true);
    tickOnce();
  });
  el('btnReset').addEventListener('click', function () {
    clearTimeout(timer);
    resetAll();
  });
  el('speedRange').addEventListener('input', function (e) {
    speed = parseInt(e.target.value, 10);
    el('speedLabel').textContent = speed + 'x';
    if (!paused) {
      clearTimeout(timer);
      loop();
    }
  });
  el('btnMute').addEventListener('click', function () {
    audio.ensure();
    var muted = audio.toggleMute();
    el('btnMute').textContent = muted ? '取消静音' : '静音';
  });
  el('scenarioSelect').addEventListener('change', function (e) {
    var choice = e.target.value;
    if (choice === 'win') loadScenario(SC.winningScript);
    else if (choice === 'fail') loadScenario(SC.failureScript);
    else loadScenario(SC.recoveryScript);
  });

  resetAll();
  renderPanel();
  renderLog();
})();
