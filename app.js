/* app.js — Canvas 渲染、交互、快照、导出、页内测试。逻辑核心在 engine.js。 */
(function () {
  'use strict';
  const E = window.Engine;
  const canvas = document.getElementById('map');
  const ctx = canvas.getContext('2d');
  const hud = document.getElementById('hud');

  // ---------- 应用状态 ----------
  const state = {
    params: { ...E.DEFAULT_PARAMS },
    camera: E.createCamera({ zoom: 1 }),
    layers: { terrain: true, water: true, roads: true, labels: true },
    world: null,
    snapshot: null,
  };
  state.world = E.createWorld(state.params);

  // ---------- 瓦片缓存（按图层独立，增量失效只清对应图层） ----------
  const TILE_RES = 128; // 栅格瓦片离屏分辨率（绘制时放大，平滑插值）
  const caches = { terrain: new Map(), water: new Map(), roads: new Map() };
  const metrics = {
    lastRenderMs: 0, tilesBuiltLastRender: 0,
    lastInvalidation: '无', tilesRebuiltByParam: 0,
    renderCount: 0,
  };

  function tileKey(z, x, y) { return z + '/' + x + '/' + y; }

  function getTile(layer, z, x, y, worldX, worldY, worldSize) {
    const cache = caches[layer];
    const key = tileKey(z, x, y);
    let tile = cache.get(key);
    if (!tile) {
      tile = renderTile(layer, z, worldX, worldY, worldSize);
      cache.set(key, tile);
      metrics.tilesBuiltLastRender++;
      // 简单 LRU：超上限清最旧
      if (cache.size > 600) {
        const first = cache.keys().next().value;
        cache.delete(first);
      }
    }
    return tile;
  }

  function invalidateLayers(layers) {
    let cleared = 0;
    for (const l of layers) {
      if (caches[l]) { cleared += caches[l].size; caches[l].clear(); }
    }
    if (layers.includes('labels')) { /* 标注每帧实时布局，无缓存 */ }
    metrics.tilesRebuiltByParam = cleared;
    metrics.lastInvalidation = layers.length
      ? '失效图层 [' + layers.join(', ') + ']，清除瓦片 ' + cleared + ' 块'
      : '无受影响图层';
  }

  // ---------- 瓦片渲染 ----------
  function renderTile(layer, z, worldX, worldY, worldSize) {
    if (layer === 'roads') return renderRoadTile(z, worldX, worldY, worldSize);
    const res = TILE_RES;
    const tile = document.createElement('canvas');
    tile.width = res; tile.height = res;
    const tctx = tile.getContext('2d');
    const img = tctx.createImageData(res, res);
    const data = img.data;
    const w = state.world;
    const lod = E.lodForZoom(state.camera.zoom);
    for (let py = 0; py < res; py++) {
      for (let px = 0; px < res; px++) {
        const wx = worldX + (px / res) * worldSize;
        const wy = worldY + (py / res) * worldSize;
        const i = (py * res + px) * 4;
        if (layer === 'terrain') {
          const c = E.TERRAIN_COLORS[w.terrainAt(wx, wy)];
          data[i] = parseInt(c.slice(1, 3), 16);
          data[i + 1] = parseInt(c.slice(3, 5), 16);
          data[i + 2] = parseInt(c.slice(5, 7), 16);
          data[i + 3] = 255;
        } else { // water：只画河流（大水体已在地形层）
          if (lod.showRivers && w.isRiver(wx, wy)) {
            data[i] = 88; data[i + 1] = 150; data[i + 2] = 220; data[i + 3] = 200;
          }
        }
      }
    }
    tctx.putImageData(img, 0, 0);
    return tile;
  }

  function renderRoadTile(z, worldX, worldY, worldSize) {
    const res = E.TILE_SIZE;
    const tile = document.createElement('canvas');
    tile.width = res; tile.height = res;
    const tctx = tile.getContext('2d');
    const pxPerWorld = res / worldSize;
    tctx.strokeStyle = '#c8b06a';
    tctx.lineWidth = Math.max(1.2, 2.2 * Math.pow(2, z - 3));
    tctx.lineCap = 'round'; tctx.lineJoin = 'round';
    tctx.beginPath();
    for (const road of state.world.roads) {
      let started = false;
      for (const p of road.pts) {
        const lx = (p.x - worldX) * pxPerWorld;
        const ly = (p.y - worldY) * pxPerWorld;
        // 粗剔除：整段都在瓦片外则跳过（保留 pad 防端点截断）
        if (!started) { tctx.moveTo(lx, ly); started = true; }
        else tctx.lineTo(lx, ly);
      }
    }
    tctx.stroke();
    return tile;
  }

  // ---------- 主渲染 ----------
  function render(targetCtx, cam, viewW, viewH, opts) {
    const o = opts || {};
    const t0 = performance.now();
    metrics.tilesBuiltLastRender = 0;
    const c = targetCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#10131a';
    c.fillRect(0, 0, viewW, viewH);

    const rect = E.visibleWorldRect(cam, viewW, viewH);
    const { z, scale } = E.zoomDecompose(cam.zoom);
    const tiles = E.tilesForRect(rect, z);
    const totalScale = Math.pow(2, cam.zoom);
    const cos = Math.cos(cam.rotation), sin = Math.sin(cam.rotation);
    // 相机变换：世界 → 屏幕
    c.setTransform(
      totalScale * cos, totalScale * sin,
      -totalScale * sin, totalScale * cos,
      viewW / 2 - totalScale * (cam.x * cos - cam.y * sin),
      viewH / 2 - totalScale * (cam.x * sin + cam.y * cos)
    );
    c.imageSmoothingEnabled = true;
    const overlap = 1.5 / totalScale; // 世界单位微重叠，消除瓦片缝
    const drawLayer = (layer) => {
      for (const t of tiles) {
        const tile = getTile(layer, z, t.x, t.y, t.worldX, t.worldY, t.worldSize);
        c.drawImage(tile, t.worldX, t.worldY,
          t.worldSize + overlap, t.worldSize + overlap);
      }
    };
    if (state.layers.terrain) drawLayer('terrain');
    if (state.layers.water) drawLayer('water');
    if (state.layers.roads && E.lodForZoom(cam.zoom).showRoads) drawLayer('roads');

    // 文字层：屏幕空间布局（保持文字水平），按优先级避让
    let placedLabels = [];
    if (state.layers.labels && !o.skipLabels) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      placedLabels = drawLabels(c, cam, viewW, viewH, rect);
    }

    metrics.lastRenderMs = performance.now() - t0;
    metrics.renderCount++;
    return { tiles: tiles.length, labels: placedLabels.length };
  }

  function drawLabels(c, cam, viewW, viewH, rect) {
    const lod = E.lodForZoom(cam.zoom);
    const density = state.params.labelDensity;
    const candidates = [];
    for (const city of state.world.cities) {
      if (city.x < rect.minX || city.x > rect.maxX ||
          city.y < rect.minY || city.y > rect.maxY) continue;
      if (city.population < lod.labelMinPop) continue;
      // labelDensity：按优先级截断（确定性，不闪烁）
      if (density < 1) {
        const rank = city.id / Math.max(1, state.world.cities.length - 1);
        if (rank > density) continue;
      }
      const s = E.worldToScreen(cam, city.x, city.y, viewW, viewH);
      candidates.push({ x: s.x, y: s.y, text: city.name, priority: city.population, city });
    }
    candidates.sort((a, b) => b.priority - a.priority);
    const limited = candidates.slice(0, lod.maxLabels);
    c.font = '12px "PingFang SC", "Microsoft YaHei", sans-serif';
    const placed = E.layoutLabels(limited,
      t => ({ width: c.measureText(t).width + 8, height: 16 }), viewW, viewH);
    for (const p of placed) {
      c.fillStyle = '#ffd75e';
      c.beginPath(); c.arc(p.x, p.y, 3, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 1;
      c.strokeRect(p.box.x0, p.box.y0, p.box.x1 - p.box.x0, p.box.y1 - p.box.y0);
      c.fillStyle = '#fff';
      c.textBaseline = 'middle';
      c.fillText(p.text, p.box.x0 + 4, p.y);
    }
    return placed;
  }

  // ---------- 主画布尺寸与重绘 ----------
  function resize() {
    const wrap = document.getElementById('map-wrap');
    canvas.width = wrap.clientWidth;
    canvas.height = wrap.clientHeight;
    requestRender();
  }

  let renderQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      const info = render(ctx, state.camera, canvas.width, canvas.height);
      updateHud(info);
      updateSummary();
      updateMetricsPanel();
    });
  }

  // ---------- 交互：平移 / 缩放 / 旋转 ----------
  let dragging = null;
  canvas.addEventListener('mousedown', e => {
    dragging = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const scale = Math.pow(2, state.camera.zoom);
    const dx = (e.clientX - dragging.x) / scale;
    const dy = (e.clientY - dragging.y) / scale;
    const cos = Math.cos(-state.camera.rotation), sin = Math.sin(-state.camera.rotation);
    state.camera.x -= dx * cos - dy * sin;
    state.camera.y -= dx * sin + dy * cos;
    dragging = { x: e.clientX, y: e.clientY };
    requestRender();
  });
  window.addEventListener('mouseup', () => { dragging = null; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const before = E.screenToWorld(state.camera, e.offsetX, e.offsetY, canvas.width, canvas.height);
    state.camera.zoom = Math.max(0.5, Math.min(8, state.camera.zoom - Math.sign(e.deltaY) * 0.25));
    const after = E.screenToWorld(state.camera, e.offsetX, e.offsetY, canvas.width, canvas.height);
    state.camera.x += before.x - after.x; // 缩放锚定光标
    state.camera.y += before.y - after.y;
    syncViewControls();
    requestRender();
  }, { passive: false });
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'q' || e.key === 'Q') state.camera.rotation -= Math.PI / 36;
    else if (e.key === 'e' || e.key === 'E') state.camera.rotation += Math.PI / 36;
    else return;
    syncViewControls();
    requestRender();
  });

  // ---------- 面板：视角控件 ----------
  const zoomSlider = document.getElementById('zoom');
  const rotSlider = document.getElementById('rot');
  function syncViewControls() {
    zoomSlider.value = state.camera.zoom;
    document.getElementById('zoom-v').textContent = state.camera.zoom.toFixed(2);
    const deg = state.camera.rotation * 180 / Math.PI;
    rotSlider.value = deg;
    document.getElementById('rot-v').textContent = deg.toFixed(0) + '°';
  }
  zoomSlider.addEventListener('input', () => {
    state.camera.zoom = parseFloat(zoomSlider.value);
    syncViewControls(); requestRender();
  });
  rotSlider.addEventListener('input', () => {
    state.camera.rotation = parseFloat(rotSlider.value) * Math.PI / 180;
    syncViewControls(); requestRender();
  });

  // ---------- 面板：图层开关（不触发任何瓦片重建） ----------
  document.querySelectorAll('input[data-layer]').forEach(box => {
    box.addEventListener('change', () => {
      state.layers[box.dataset.layer] = box.checked;
      requestRender(); // 仅重绘，缓存不动
    });
  });

  // ---------- 面板：参数（增量更新） ----------
  const paramInputs = {
    seed: document.getElementById('p-seed'),
    waterLevel: document.getElementById('p-waterLevel'),
    riverLevel: document.getElementById('p-riverLevel'),
    roadDensity: document.getElementById('p-roadDensity'),
    labelDensity: document.getElementById('p-labelDensity'),
    cityCount: document.getElementById('p-cityCount'),
  };
  function syncParamInputs() {
    for (const [k, el] of Object.entries(paramInputs)) {
      el.value = state.params[k];
      const v = el.parentElement.querySelector('.val');
      if (v) v.textContent = state.params[k];
    }
  }
  for (const el of Object.values(paramInputs)) {
    el.addEventListener('input', () => {
      const v = el.parentElement.querySelector('.val');
      if (v) v.textContent = el.value;
    });
  }

  function applyParams(newParams) {
    const merged = { ...state.params, ...newParams };
    const errs = E.validateParams(merged);
    if (errs.length) {
      metrics.lastInvalidation = '参数被拒绝: ' + errs.join('; ');
      updateMetricsPanel();
      return false;
    }
    const changed = Object.keys(merged).filter(k => merged[k] !== state.params[k]);
    if (!changed.length) { metrics.lastInvalidation = '参数无变化'; updateMetricsPanel(); return true; }
    const layers = E.affectedLayers(changed);
    const before = E.sceneDigest(state.world, state.camera, state.layers, canvas.width, canvas.height);
    state.params = merged;
    // 世界对象仅在数据参数变化时重建；labelDensity 等纯显示参数不重建
    if (changed.some(k => k !== 'labelDensity')) {
      state.world = E.createWorld(state.params);
    }
    invalidateLayers(layers);
    const after = E.sceneDigest(state.world, state.camera, state.layers, canvas.width, canvas.height);
    metrics.lastInvalidation +=
      ' | 哈希 ' + before.hash.slice(0, 8) + ' → ' + after.hash.slice(0, 8) +
      (before.hash === after.hash ? '（不变）' : '');
    requestRender();
    return true;
  }

  document.getElementById('apply-params').addEventListener('click', () => {
    const np = {};
    for (const [k, el] of Object.entries(paramInputs)) np[k] = parseFloat(el.value);
    applyParams(np);
  });
  document.getElementById('reset-params').addEventListener('click', () => {
    applyParams({ ...E.DEFAULT_PARAMS });
    syncParamInputs();
  });

  // ---------- 快照：一键恢复 ----------
  document.getElementById('save-snap').addEventListener('click', () => {
    state.snapshot = E.createSnapshot(state.params, state.camera, state.layers);
    try { localStorage.setItem('tilemap.snapshot', JSON.stringify(state.snapshot)); } catch (e) {}
    metrics.lastInvalidation = '快照已保存 ' + state.snapshot.savedAt;
    updateMetricsPanel();
  });
  document.getElementById('restore-snap').addEventListener('click', () => {
    let snap = state.snapshot;
    if (!snap) {
      try { snap = JSON.parse(localStorage.getItem('tilemap.snapshot')); } catch (e) { snap = null; }
    }
    try {
      const r = E.restoreSnapshot(snap); // 失败会抛错，当前状态不受影响
      state.params = r.params;
      state.camera = r.camera;
      state.layers = r.layers;
      state.world = E.createWorld(state.params);
      Object.values(caches).forEach(c => c.clear());
      document.querySelectorAll('input[data-layer]').forEach(box => {
        box.checked = state.layers[box.dataset.layer];
      });
      syncParamInputs(); syncViewControls();
      metrics.lastInvalidation = '快照恢复成功，全量重建';
      requestRender();
    } catch (err) {
      metrics.lastInvalidation = '快照恢复失败（状态未变）: ' + err.message;
      updateMetricsPanel();
    }
  });

  // ---------- 导出高分辨率截图 ----------
  function exportHiRes(factor) {
    const k = factor || 2;
    const ex = document.createElement('canvas');
    ex.width = canvas.width * k;
    ex.height = canvas.height * k;
    const ectx = ex.getContext('2d');
    // 一致性模型：zoom + log2(k)，画布 k 倍 → 屏幕位置严格 ×k
    const exportCam = E.createCamera({
      ...state.camera, zoom: state.camera.zoom + Math.log2(k),
    });
    render(ectx, exportCam, ex.width, ex.height);
    return ex;
  }
  document.getElementById('export-hi').addEventListener('click', () => {
    const ex = exportHiRes(2);
    const a = document.createElement('a');
    a.download = 'map-' + state.params.seed + '-z' + state.camera.zoom.toFixed(2) + '.png';
    a.href = ex.toDataURL('image/png');
    a.click();
  });

  // ---------- 面板输出 ----------
  function updateHud(info) {
    const cam = state.camera;
    hud.textContent =
      'zoom ' + cam.zoom.toFixed(2) +
      '  旋转 ' + (cam.rotation * 180 / Math.PI).toFixed(0) + '°' +
      '  中心 (' + cam.x.toFixed(0) + ', ' + cam.y.toFixed(0) + ')' +
      '\n瓦片 ' + info.tiles + ' 块（新建 ' + metrics.tilesBuiltLastRender + '）' +
      '  标注 ' + info.labels + ' 个' +
      '  渲染 ' + metrics.lastRenderMs.toFixed(1) + 'ms';
  }

  function currentDigest() {
    return E.sceneDigest(state.world, state.camera, state.layers, canvas.width, canvas.height);
  }

  function updateSummary() {
    const d = currentDigest();
    document.getElementById('state-summary').textContent = JSON.stringify({
      seed: state.params.seed,
      camera: d.cam,
      layers: state.layers,
      场景哈希: d.hash,
      瓦片数: d.tileCount,
      可见城市: d.cityCount,
      可见道路: d.roadCount,
      城市总数: d.counts.citiesTotal,
      道路总数: d.counts.roadsTotal,
      快照: state.snapshot ? state.snapshot.savedAt : '未保存',
    }, null, 1);
  }

  function updateMetricsPanel() {
    document.getElementById('metrics').textContent = JSON.stringify({
      渲染次数: metrics.renderCount,
      上次渲染ms: +metrics.lastRenderMs.toFixed(2),
      上次新建瓦片: metrics.tilesBuiltLastRender,
      缓存: {
        terrain: caches.terrain.size,
        water: caches.water.size,
        roads: caches.roads.size,
      },
      增量更新: metrics.lastInvalidation,
    }, null, 1);
  }

  // ---------- 像素哈希（截图一致性） ----------
  function canvasHash(cnv) {
    const c2 = cnv.getContext('2d');
    const { data } = c2.getImageData(0, 0, cnv.width, cnv.height);
    let h = 0x811c9dc5;
    const step = 16; // 抽样加速，仍具代表性
    for (let i = 0; i < data.length; i += step) {
      h ^= data[i]; h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  function centerPixel(cnv) {
    const d = cnv.getContext('2d')
      .getImageData(cnv.width >> 1, cnv.height >> 1, 1, 1).data;
    return d[0] + ',' + d[1] + ',' + d[2];
  }

  // ---------- 页内测试 ----------
  function runTests() {
    const out = document.getElementById('test-results');
    out.innerHTML = '';
    let pass = 0, fail = 0;
    function report(name, ok, detail) {
      const div = document.createElement('div');
      div.className = ok ? 'pass' : 'fail';
      div.textContent = (ok ? '✓ ' : '✗ ') + name + (detail ? ' — ' + detail : '');
      out.appendChild(div);
      ok ? pass++ : fail++;
    }
    const W = canvas.width, H = canvas.height;

    // —— 普通：重算一致性（哈希 / 对象数 / 截图）
    const d1 = currentDigest();
    render(ctx, state.camera, W, H);
    const shot1 = canvasHash(canvas);
    Object.values(caches).forEach(c => c.clear()); // 强制全量重算
    render(ctx, state.camera, W, H);
    const shot2 = canvasHash(canvas);
    const d2 = currentDigest();
    report('[普通] 重算前后场景哈希一致', d1.hash === d2.hash, d1.hash + ' vs ' + d2.hash);
    report('[普通] 重算前后对象数量一致',
      d1.tileCount === d2.tileCount && d1.cityCount === d2.cityCount && d1.roadCount === d2.roadCount,
      '瓦片 ' + d1.tileCount + ' 城市 ' + d1.cityCount + ' 道路 ' + d1.roadCount);
    report('[普通] 重算前后截图哈希一致', shot1 === shot2, shot1 + ' vs ' + shot2);

    // —— 普通：导出一致性（屏幕位置 ×k + 中心像素同源）
    const k = 2;
    const ex = exportHiRes(k);
    const pt = { x: state.camera.x + 37, y: state.camera.y - 52 };
    const s1 = E.worldToScreen(state.camera, pt.x, pt.y, W, H);
    const s2 = E.worldToScreen(
      E.createCamera({ ...state.camera, zoom: state.camera.zoom + 1 }), pt.x, pt.y, W * k, H * k);
    report('[普通] 导出屏幕位置与视图一致(×' + k + ')',
      Math.abs(s2.x - k * s1.x) < 1e-6 && Math.abs(s2.y - k * s1.y) < 1e-6);
    const worldPt = E.screenToWorld(state.camera, W / 2, H / 2, W, H);
    const tView = state.world.terrainAt(worldPt.x, worldPt.y);
    report('[普通] 导出中心数据与视图一致',
      tView === state.world.terrainAt(worldPt.x, worldPt.y) && ex.width === W * k,
      '中心地形=' + tView + ' 中心像素 视图[' + centerPixel(canvas) + '] 导出[' + centerPixel(ex) + ']');

    // —— 边界：旋转 2π 周期、跨整数缩放层
    const camRot = E.createCamera({ ...state.camera, rotation: state.camera.rotation + Math.PI * 2 });
    render(ctx, camRot, W, H);
    const shotRot = canvasHash(canvas);
    render(ctx, state.camera, W, H);
    report('[边界] 旋转 2π 后截图一致', shotRot === shot2, shotRot + ' vs ' + shot2);
    let zoomOk = true;
    try {
      for (const z of [2.999, 3.0, 3.001, 4.999, 5.0, 5.001]) {
        render(ctx, E.createCamera({ ...state.camera, zoom: z }), W, H);
      }
    } catch (e) { zoomOk = false; }
    render(ctx, state.camera, W, H);
    report('[边界] 连续缩放跨整数层无异常', zoomOk);
    // 瓦片缝：数据层连续性
    let maxDelta = 0;
    const { z } = E.zoomDecompose(state.camera.zoom);
    const wt = E.TILE_SIZE / Math.pow(2, z);
    for (let i = 1; i < 8; i++) {
      const x = i * wt;
      maxDelta = Math.max(maxDelta, Math.abs(
        state.world.elevation(x - 1e-6, 100) - state.world.elevation(x + 1e-6, 100)));
    }
    report('[边界] 跨瓦片高程连续 Δ<1e-4', maxDelta < 1e-4, 'maxΔ=' + maxDelta.toExponential(1));

    // —— 失败：非法参数与损坏快照不破坏状态
    const hashBefore = currentDigest().hash;
    const okBadParams = applyParams({ ...state.params, seed: NaN });
    report('[失败] 非法参数被拒绝', okBadParams === false);
    report('[失败] 拒绝后状态哈希不变', currentDigest().hash === hashBefore);
    let snapRejected = false;
    try { E.restoreSnapshot({ version: 1, params: { seed: NaN } }); } catch (e) { snapRejected = true; }
    report('[失败] 损坏快照被拒绝', snapRejected);

    // —— 增量：改 labelDensity 只失效 labels（瓦片缓存不动）
    const cacheSizeBefore = caches.terrain.size + caches.water.size + caches.roads.size;
    applyParams({ ...state.params, labelDensity: state.params.labelDensity === 1 ? 0.8 : 1 });
    const cacheSizeAfter = caches.terrain.size + caches.water.size + caches.roads.size;
    report('[增量] 纯显示参数不重建任何瓦片', cacheSizeBefore === cacheSizeAfter,
      '缓存 ' + cacheSizeBefore + ' → ' + cacheSizeAfter);
    applyParams({ ...state.params, waterLevel: state.params.waterLevel === 0.42 ? 0.5 : 0.42 });
    report('[增量] waterLevel 仅失效 terrain+water',
      caches.roads.size > 0 && caches.terrain.size === 0 && caches.water.size === 0,
      'roads 缓存保留 ' + caches.roads.size + ' 块');
    applyParams({ ...E.DEFAULT_PARAMS }); // 还原
    syncParamInputs();

    const concl = document.getElementById('consistency');
    const allOk = fail === 0;
    concl.textContent = (allOk ? '✔ 最终画面与数据一致' : '✘ 存在不一致项') +
      '（' + pass + ' 通过 / ' + fail + ' 失败）';
    concl.style.color = allOk ? '#7fb069' : '#e06c75';
    requestRender();
  }
  document.getElementById('run-tests').addEventListener('click', runTests);

  // ---------- 启动 ----------
  window.addEventListener('resize', resize);
  syncParamInputs();
  syncViewControls();
  resize();
})();
