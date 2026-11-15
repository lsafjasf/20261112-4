/* 浏览器端：Canvas 渲染 + Web Audio + 控件，驱动同一个 engine.js 固定步长引擎 */
(function () {
  'use strict';
  const E = window.PolarEngine;
  const { Simulation, FixedDriver, NODES, EDGES, EDGE_MAP, STORM } = E;

  // ---------- 场景脚本（与 run-tests.js 同一组确定性输入） ----------
  const SCENES = {
    success: [
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
    ],
    miss: [
      { at: 1, cmd: { type: 'load', vehicle: 'rover', batch: 'b1' } },
      { at: 2, cmd: { type: 'load', vehicle: 'rover', batch: 'b2a' } },
      { at: 3, cmd: { type: 'load', vehicle: 'rover', batch: 'b3' } },
      { at: 4, cmd: { type: 'load', vehicle: 'drone', batch: 'b2b' } },
      { at: 110, cmd: { type: 'depart', vehicle: 'rover', to: 'S3' } },
      { at: 111, cmd: { type: 'depart', vehicle: 'drone', path: ['aBS1', 'aS12'] } }
    ],
    drone: [
      { at: 1, cmd: { type: 'load', vehicle: 'drone', batch: 'b2b' } },
      { at: STORM[0] + 1, cmd: { type: 'depart', vehicle: 'drone',
        path: ['aBS1', 'aS12'] } }
    ]
  };

  // ---------- Web Audio：风声随风速、引擎声随负载 ----------
  const Audio2 = {
    ctx: null, master: null, windGain: null, windFilter: null,
    roverOsc: null, roverGain: null, droneOsc: null, droneGain: null,
    muted: false,
    ensure() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);

      // 风：白噪声 -> 带通滤波，频率/增益随风速
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const noise = this.ctx.createBufferSource();
      noise.buffer = buf; noise.loop = true;
      this.windFilter = this.ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass'; this.windFilter.Q.value = 0.8;
      this.windFilter.frequency.value = 400;
      this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0.02;
      noise.connect(this.windFilter).connect(this.windGain).connect(this.master);
      noise.start();

      // 履带车引擎：低频锯齿波
      this.roverOsc = this.ctx.createOscillator();
      this.roverOsc.type = 'sawtooth'; this.roverOsc.frequency.value = 55;
      this.roverGain = this.ctx.createGain(); this.roverGain.gain.value = 0;
      this.roverOsc.connect(this.roverGain).connect(this.master);
      this.roverOsc.start();

      // 无人机：高频方波
      this.droneOsc = this.ctx.createOscillator();
      this.droneOsc.type = 'square'; this.droneOsc.frequency.value = 220;
      this.droneGain = this.ctx.createGain(); this.droneGain.gain.value = 0;
      this.droneOsc.connect(this.droneGain).connect(this.master);
      this.droneOsc.start();
    },
    toggleMute() {
      this.muted = !this.muted;
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.9;
      return this.muted;
    },
    update(sim) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      const w = sim.weather.wind;
      this.windFilter.frequency.setTargetAtTime(220 + w * 28, t, 0.2);
      this.windGain.gain.setTargetAtTime(0.015 + Math.min(0.22, w * 0.008), t, 0.2);
      const rover = sim.vehicle('rover');
      const drone = sim.vehicle('drone');
      const loadRatio = rover.cargo.reduce((s, id) =>
        s + sim.batch(id).weight, 0) / rover.config.capacity;
      this.roverOsc.frequency.setTargetAtTime(
        rover.status === 'moving' ? 48 + loadRatio * 34 : 30, t, 0.15);
      this.roverGain.gain.setTargetAtTime(rover.status === 'moving' ? 0.05 : 0, t, 0.2);
      this.droneOsc.frequency.setTargetAtTime(
        drone.status === 'moving' ? 200 + w * 4 : 160, t, 0.15);
      this.droneGain.gain.setTargetAtTime(drone.status === 'moving' ? 0.025 : 0, t, 0.2);
    }
  };

  // ---------- 应用状态 ----------
  let sim, driver, sceneName = 'success', rafId = null, lastFrame = 0;
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const SCALE = 78, OX = 40, OY = 30;

  function px(p) { return { x: OX + p.x * SCALE, y: OY + p.y * SCALE }; }

  function loadScene(name) {
    sceneName = name;
    sim = new Simulation({ seed: 20261112,
      script: SCENES[name].map(s => JSON.parse(JSON.stringify(s))) });
    driver = new FixedDriver(sim);
    document.getElementById('sResult').textContent = '';
    if (window.__polarRender) window.__polarRender();
  }

  window.__polarApp = {
    loadScene: loadScene,
    get sim() { return sim; }
  };

  // 渲染与控件在后续分块挂载
  window.__polar = { E, SCENES, Audio2, get sim() { return sim; },
    set sim(v) { sim = v; }, get driver() { return driver; },
    set driver(v) { driver = v; }, get sceneName() { return sceneName; },
    cv: cv, ctx: ctx, px: px, SCALE: SCALE };
})();

// ---------- Canvas 渲染 ----------
(function () {
  const P = window.__polar;
  const { ctx, cv, px, SCALE } = P;
  const { EDGE_MAP, NODES, EDGES, STORM } = P.E;

  function drawWind(sim) {
    const n = Math.round(sim.weather.wind * 2.2);
    ctx.strokeStyle = sim.weather.storm ? 'rgba(255,120,120,.55)' : 'rgba(140,190,240,.35)';
    ctx.lineWidth = 1;
    const r = E2.rng(sim.seed + sim.t * 131);
    for (let i = 0; i < n; i++) {
      const x = r() * cv.width, y = r() * cv.height;
      const len = 12 + sim.weather.wind * 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y + (r() - 0.5) * 6);
      ctx.stroke();
    }
  }

  const E2 = { rng: P.E.rng };

  function drawEdge(e, color, width, dashed) {
    const a = px(NODES[e.a]), b = px(NODES[e.b]);
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = width;
    if (dashed) ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.restore();
  }

  function draw(sim) {
    ctx.clearRect(0, 0, cv.width, cv.height);
    // 冰原底色与网格
    ctx.fillStyle = '#0d1c2c';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = 'rgba(90,140,190,.08)';
    for (let gx = 0; gx < cv.width; gx += SCALE) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, cv.height); ctx.stroke();
    }
    for (let gy = 0; gy < cv.height; gy += SCALE) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(cv.width, gy); ctx.stroke();
    }

    drawWind(sim);

    // 暴风窗口遮罩
    if (sim.weather.storm) {
      ctx.fillStyle = 'rgba(120,40,60,.16)';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = 'rgba(255,120,120,.9)';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('⚠ 暴风窗口 ' + STORM[0] + '–' + STORM[1] + '：山口关闭、无人机禁飞', 18, 28);
    }

    // 道路与航线
    EDGES.forEach(e => drawEdge(e,
      e.mode === 'air' ? 'rgba(120,170,230,.30)' : 'rgba(150,180,210,.45)',
      e.mode === 'air' ? 1.2 : 2.2, e.mode === 'air'));

    // 已走路径（改道后仍保留，高亮不消失）
    sim.vehicles.forEach(v => {
      v.pathTraveled.forEach(id => drawEdge(EDGE_MAP[id],
        v.type === 'drone' ? 'rgba(126,211,255,.95)' : 'rgba(87,208,160,.95)', 3.4));
    });
    // 待走路线
    sim.vehicles.forEach(v => {
      if (v.status === 'blocked' || v.status === 'moving') {
        v.route.forEach(id => drawEdge(EDGE_MAP[id],
          v.status === 'blocked' ? 'rgba(255,200,87,.7)' : 'rgba(109,184,255,.55)',
          2, true));
      }
    });

    // 节点：基地 / 补给站 / 营地
    Object.keys(NODES).forEach(id => {
      const n = px(NODES[id]);
      const isStation = id.indexOf('S') === 0;
      ctx.beginPath();
      ctx.arc(n.x, n.y, isStation ? 11 : 8, 0, Math.PI * 2);
      ctx.fillStyle = id === 'B' ? '#6db8ff' : (isStation ? '#57d0a0' : '#88a4bd');
      ctx.fill();
      ctx.fillStyle = '#dcebf7';
      ctx.font = '12px sans-serif';
      ctx.fillText(NODES[id].name + '(' + id + ')', n.x + 13, n.y + 4);
    });

    // 车辆
    sim.vehicles.forEach(v => drawVehicle(v));
  }

  function drawVehicle(v) {
    const p = px(v.position);
    ctx.save();
    if (v.type === 'rover') {
      ctx.fillStyle = v.status === 'lost' ? '#7a3340' :
        (v.status === 'blocked' ? '#ffc857' : '#e8b04b');
      ctx.fillRect(p.x - 10, p.y - 7, 20, 14);
      ctx.fillStyle = '#223333';
      ctx.fillRect(p.x - 12, p.y + 5, 6, 4);
      ctx.fillRect(p.x + 6, p.y + 5, 6, 4);
    } else {
      ctx.fillStyle = v.status === 'lost' ? '#7a3340' :
        (v.status === 'blocked' ? '#ffc857' : '#7ed3ff');
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 9); ctx.lineTo(p.x + 10, p.y + 7);
      ctx.lineTo(p.x - 10, p.y + 7); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(v.type === 'rover' ? '履带车' : '无人机', p.x + 12, p.y - 10);
    if (v.status === 'blocked') {
      ctx.fillStyle = '#ffc857';
      ctx.fillText('⛔' + v.blockedReason, p.x - 20, p.y + 26);
    }
    if (v.status === 'lost') {
      ctx.fillStyle = '#ff6b6b';
      ctx.fillText('✕ 失联', p.x - 20, p.y + 26);
    }
    ctx.restore();
  }

  window.__polarDraw = draw;
})();

// ---------- 侧栏状态、故障快照、事件日志 ----------
(function () {
  const P = window.__polar;
  const STORM = P.E.STORM;

  function bar(pct) {
    return '<div class="bar"><i style="width:' + Math.max(0, Math.min(100, pct)) + '%"></i></div>';
  }

  function panels(sim) {
    document.getElementById('vehicles').innerHTML = sim.vehicles.map(v => {
      const pct = (v.battery / v.batteryMax) * 100;
      const load = v.cargo.reduce((s, id) => s + sim.batch(id).weight, 0);
      return '<div class="card"><div class="name">' + v.name +
        '<span class="badge ' + v.status + '">' + v.status + '</span></div>' +
        '电量 ' + v.battery.toFixed(2) + '/' + v.batteryMax + ' kWh' + bar(pct) +
        '负重 ' + load + '/' + v.config.capacity + 'kg，货物 [' +
        (v.cargo.join(',') || '空') + ']<br>' +
        '位置 ' + v.node + '，已走 [' + (v.pathTraveled.join('→') || '无') + ']<br>' +
        '待走 [' + (v.route.join('→') || '无') + ']' +
        (v.blockedReason ? '<br style="color:#ffc857"><span style="color:#ffc857">受阻：' +
          v.blockedReason + '</span>' : '') + '</div>';
    }).join('');

    document.getElementById('batches').innerHTML = sim.batches.map(b => {
      const state = b.delivered ? '<span style="color:#57d0a0">已送达 t=' +
        b.deliveredAt + '</span>' : (b.late ? '<span style="color:#ff6b6b">错过窗口</span>' :
        (b.location || (b.carriedBy ? '在途(' + b.carriedBy + ')' : '基地')));
      return '<div class="card">' + b.id + '（' + b.weight + 'kg → ' + b.target +
        '，截止 t=' + b.deadline + '）：' + state + '</div>';
    }).join('');

    const faultEl = document.getElementById('fault');
    if (sim.faultSnapshots.length) {
      faultEl.innerHTML = sim.faultSnapshots.map(fs => {
        const row = snap => '<tr><td>' + snap.t + '</td><td>' +
          snap.weather.wind.toFixed(1) + 'm/s ' + snap.weather.temp.toFixed(1) + '°C</td><td>' +
          snap.vehicles.map(v => v.id + ':' + v.status + '/' + v.battery.toFixed(1) +
            'kWh/[' + v.pathTraveled.join('→') + ']').join('<br>') + '</td><td>' +
          snap.batches.map(b => b.id + (b.delivered ? '✓' : (b.late ? '迟' : '…'))).join(' ') +
          '</td></tr>';
        return '<div class="card" style="border-color:#8a3a48"><b style="color:#ff6b6b">' +
          fs.code + '</b><br>' + fs.text +
          '<table><tr><th>时刻</th><th>天气</th><th>车辆</th><th>物资</th></tr>' +
          '<tr><th colspan="4" style="color:#ffc857">故障前</th></tr>' + row(fs.before) +
          '<tr><th colspan="4" style="color:#ff6b6b">故障后</th></tr>' + row(fs.after) +
          '</table></div>';
      }).join('');
    } else {
      faultEl.textContent = '尚未触发故障';
    }
  }

  function logView(sim) {
    const el = document.getElementById('log');
    const atBottom = el.scrollTop + el.clientHeight > el.scrollHeight - 30;
    el.innerHTML = sim.events.slice(-120).map(e =>
      '<div class="row ' + e.kind + '"><span class="t">t=' + e.t + '</span>' +
      (e.text || e.kind) + '</div>').join('');
    if (atBottom) el.scrollTop = el.scrollHeight;
  }

  function header(sim) {
    document.getElementById('sTime').textContent = sim.t;
    document.getElementById('sTemp').textContent = sim.weather.temp.toFixed(1);
    document.getElementById('sWind').textContent = sim.weather.wind.toFixed(1);
    const storm = document.getElementById('sStorm');
    storm.textContent = sim.weather.storm ? '⚠ 暴风封山中' :
      '暴风窗口 ' + STORM[0] + '–' + STORM[1];
    storm.className = sim.weather.storm ? 'storm-on' : '';
    const r = document.getElementById('sResult');
    if (sim.over) {
      r.textContent = sim.outcome === 'success' ? '✓ 任务成功' : '✕ 任务失败：' +
        sim.failureReasons.join(',');
      r.className = 'result ' + sim.outcome;
    } else {
      r.textContent = '';
    }
  }

  window.__polarPanels = { panels: panels, logView: logView, header: header };
})();

// ---------- 控件与主循环 ----------
(function () {
  const P = window.__polar;
  const draw = window.__polarDraw;
  const UI = window.__polarPanels;
  let playing = false;
  let rafId = 0;

  function render() {
    const sim = P.sim;
    draw(sim); UI.panels(sim); UI.logView(sim); UI.header(sim);
    document.getElementById('btnReroute').disabled =
      !(sim.vehicle('rover').status === 'blocked' || sim.vehicle('rover').status === 'moving');
  }
  window.__polarRender = render;

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (!playing) return;
    if (now - lastFrame < 200) return;
    lastFrame = now;
    const mult = parseInt(document.getElementById('speed').value, 10);
    const ran = P.driver.pulse(mult);
    P.Audio2.update(P.sim);
    if (ran === 0 && P.sim.over) setPlaying(false);
    render();
  }

  function setPlaying(on) {
    playing = on;
    P.driver.setPaused(!on);
    document.getElementById('btnPlay').disabled = on;
    document.getElementById('btnPause').disabled = !on;
    if (on) { P.Audio2.ensure(); lastFrame = 0; }
  }

  document.getElementById('btnPlay').onclick = () => setPlaying(true);
  document.getElementById('btnPause').onclick = () => setPlaying(false);
  document.getElementById('btnStep').onclick = () => {
    P.Audio2.ensure();
    P.driver.step();
    P.Audio2.update(P.sim);
    render();
  };
  document.getElementById('btnReset').onclick = () => {
    setPlaying(false);
    window.__polarApp.loadScene(P.sceneName);
  };
  document.getElementById('btnMute').onclick = function () {
    P.Audio2.ensure();
    const muted = P.Audio2.toggleMute();
    this.textContent = muted ? '🔇 静音' : '🔊 声音开';
  };
  document.querySelectorAll('[data-scene]').forEach(btn => {
    btn.onclick = () => {
      setPlaying(false);
      window.__polarApp.loadScene(btn.dataset.scene);
    };
  });
  document.getElementById('btnReroute').onclick = () => {
    const v = P.sim.vehicle('rover');
    if (v.status !== 'blocked' && v.status !== 'moving') return;
    // 从当前节点绕开北坡，经营地-补给站1-东营地
    const detour = P.E.findPath(v.node, 'S2', 'ground')
      .filter(id => id !== 'ePG' && id !== 'eGS2');
    const fallback = ['ePS1', 'eS1X', 'eXS3'];
    P.sim.command({ type: 'reroute', vehicle: 'rover',
      path: detour.length ? detour : fallback });
    render();
  };

  window.__polarApp.loadScene('success');
  rafId = requestAnimationFrame(frame);
})();
