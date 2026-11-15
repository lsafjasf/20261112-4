/* engine.js — 纯逻辑层：确定性世界生成、相机数学、标注避让、增量失效。
 * 不依赖 DOM，可在 Node 下无头测试。浏览器与 Node 双端可用。 */
(function (global) {
  'use strict';

  // ---------- 确定性随机 ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashStr(str) { // FNV-1a 32bit → hex
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function hashU32(...nums) { // 混合若干整数 → uint32
    let h = 0x811c9dc5;
    for (const n of nums) {
      h ^= (n >>> 0);
      h = Math.imul(h, 0x01000193);
      h ^= h >>> 13;
    }
    return h >>> 0;
  }

  // ---------- 值噪声（世界坐标采样，跨瓦片天然连续） ----------
  function makeNoise2D(seed) {
    function lattice(ix, iy) {
      return hashU32(seed, ix * 0x9E3779B1, iy * 0x85EBCA6B) / 4294967296;
    }
    function smooth(t) { return t * t * (3 - 2 * t); }
    return function noise2(x, y) {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = x - ix, fy = y - iy;
      const v00 = lattice(ix, iy), v10 = lattice(ix + 1, iy);
      const v01 = lattice(ix, iy + 1), v11 = lattice(ix + 1, iy + 1);
      const sx = smooth(fx), sy = smooth(fy);
      return v00 + (v10 - v00) * sx + (v01 - v00) * sy +
             (v00 - v10 - v01 + v11) * sx * sy;
    };
  }

  function fbm(noise2, x, y, octaves, lacunarity, gain) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise2(x * freq, y * freq);
      norm += amp;
      amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }

  // ---------- 参数 ----------
  const DEFAULT_PARAMS = Object.freeze({
    seed: 20261115,
    waterLevel: 0.42,
    riverLevel: 0.055,
    roadDensity: 0.7,
    labelDensity: 1.0,
    cityCount: 160,
    terrainScale: 0.0032,
  });

  const TERRAIN_TYPES = ['water', 'sand', 'grass', 'forest', 'mountain', 'snow'];

  const TERRAIN_COLORS = {
    water: '#3d6fa8', sand: '#d9c98a', grass: '#7fb069',
    forest: '#4a7c46', mountain: '#8d8d94', snow: '#eef2f5',
  };

  function validateParams(p) {
    const errs = [];
    if (!Number.isFinite(p.seed)) errs.push('seed 必须是有限数字');
    if (!(p.waterLevel > 0 && p.waterLevel < 1)) errs.push('waterLevel 需在 (0,1)');
    if (!(p.roadDensity >= 0 && p.roadDensity <= 1)) errs.push('roadDensity 需在 [0,1]');
    if (!(p.labelDensity >= 0 && p.labelDensity <= 1)) errs.push('labelDensity 需在 [0,1]');
    if (!(p.cityCount >= 0 && p.cityCount <= 500)) errs.push('cityCount 需在 [0,500]');
    if (!(p.terrainScale > 0 && p.terrainScale < 0.1)) errs.push('terrainScale 需在 (0,0.1)');
    return errs;
  }

  // 参数 → 受影响图层（用于增量更新）
  const PARAM_LAYER_MAP = {
    seed: ['terrain', 'water', 'roads', 'labels'],
    waterLevel: ['terrain', 'water'],
    riverLevel: ['water'],
    roadDensity: ['roads'],
    labelDensity: ['labels'],
    cityCount: ['roads', 'labels'],
    terrainScale: ['terrain', 'water'],
  };

  function affectedLayers(changedKeys) {
    const set = new Set();
    for (const k of changedKeys) {
      const layers = PARAM_LAYER_MAP[k];
      if (layers) layers.forEach(l => set.add(l));
    }
    return [...set];
  }

  // ---------- 世界生成（全部为世界坐标的确定函数，与瓦片无关） ----------
  const WORLD_SIZE = 2048; // 世界边长（世界单位 = 缩放 z0 像素）

  function createWorld(params) {
    const errs = validateParams(params);
    if (errs.length) throw new Error('参数非法: ' + errs.join('; '));
    const seed = params.seed | 0;
    const elevNoise = makeNoise2D(hashU32(seed, 11));
    const moistNoise = makeNoise2D(hashU32(seed, 23));
    const ridgeNoise = makeNoise2D(hashU32(seed, 37));
    const s = params.terrainScale;

    function elevation(x, y, octaves) {
      return fbm(elevNoise, x * s, y * s, octaves || 5, 2.0, 0.5);
    }
    function moisture(x, y) {
      return fbm(moistNoise, x * s * 1.7, y * s * 1.7, 3, 2.0, 0.5);
    }
    // 山脊噪声：|n-0.5| 越小越接近"河线"
    function riverness(x, y) {
      const n = fbm(ridgeNoise, x * s * 2.3, y * s * 2.3, 4, 2.1, 0.5);
      return Math.abs(n - 0.5) * 2;
    }
    function terrainAt(x, y) {
      const e = elevation(x, y);
      if (e < params.waterLevel) return 'water';
      if (e < params.waterLevel + 0.03) return 'sand';
      if (e > 0.82) return 'snow';
      if (e > 0.68) return 'mountain';
      return moisture(x, y) > 0.52 ? 'forest' : 'grass';
    }
    function isRiver(x, y) {
      if (elevation(x, y, 3) < params.waterLevel) return false; // 已是大水体
      return riverness(x, y) < params.riverLevel;
    }

    // 城市：确定性网格抖动散布，人口即优先级
    const cities = [];
    {
      const rng = mulberry32(hashU32(seed, 51));
      const cell = WORLD_SIZE / Math.ceil(Math.sqrt(params.cityCount));
      let id = 0;
      for (let gy = 0; gy * cell < WORLD_SIZE && cities.length < params.cityCount; gy++) {
        for (let gx = 0; gx * cell < WORLD_SIZE && cities.length < params.cityCount; gx++) {
          if (rng() < 0.25) continue; // 随机空缺，分布更自然
          const x = (gx + 0.2 + rng() * 0.6) * cell;
          const y = (gy + 0.2 + rng() * 0.6) * cell;
          if (terrainAt(x, y) === 'water') continue; // 不建在水里
          cities.push({
            id: id++, x, y,
            name: cityName(rng),
            population: Math.floor(1000 + Math.pow(rng(), 2.2) * 900000),
          });
        }
      }
      cities.sort((a, b) => b.population - a.population);
    }

    // 道路：邻近城市按概率连接，路径为带确定性抖动的折线
    const roads = [];
    {
      const rng = mulberry32(hashU32(seed, 77));
      for (let i = 0; i < cities.length; i++) {
        for (let j = i + 1; j < cities.length; j++) {
          const a = cities[i], b = cities[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);
          if (dist > WORLD_SIZE / 3) continue;
          if (rng() > params.roadDensity) continue;
          const segs = Math.max(2, Math.round(dist / 220));
          const pts = [{ x: a.x, y: a.y }];
          for (let k = 1; k < segs; k++) {
            const t = k / segs;
            const jx = (rng() - 0.5) * dist * 0.12;
            const jy = (rng() - 0.5) * dist * 0.12;
            pts.push({ x: a.x + dx * t + jx, y: a.y + dy * t + jy });
          }
          pts.push({ x: b.x, y: b.y });
          roads.push({ a: a.id, b: b.id, pts });
        }
      }
    }

    return { params: { ...params }, cities, roads, elevation, moisture, riverness, terrainAt, isRiver };
  }

  function cityName(rng) {
    const A = ['青', '云', '岚', '澄', '梧', '沧', '临', '望', '栖', '朔', '衡', '浔'];
    const B = ['川', '洲', '城', '浦', '山', '口', '湾', '原', '驿', '港', '陵', '汀'];
    return A[(rng() * A.length) | 0] + B[(rng() * B.length) | 0];
  }

  // ---------- 相机与投影 ----------
  // camera: { x, y 世界中心, zoom 连续缩放级, rotation 弧度 }
  function createCamera(over) {
    return Object.assign({ x: WORLD_SIZE / 2, y: WORLD_SIZE / 2, zoom: 3, rotation: 0 }, over || {});
  }

  function validateCamera(cam) {
    const errs = [];
    if (!Number.isFinite(cam.x) || !Number.isFinite(cam.y)) errs.push('相机中心非法');
    if (!Number.isFinite(cam.zoom) || cam.zoom < 0 || cam.zoom > 12) errs.push('zoom 需在 [0,12]');
    if (!Number.isFinite(cam.rotation)) errs.push('rotation 非法');
    return errs;
  }

  // 世界 → 屏幕（viewW/H 为视口像素）
  function worldToScreen(cam, wx, wy, viewW, viewH) {
    const scale = Math.pow(2, cam.zoom);
    const dx = wx - cam.x, dy = wy - cam.y;
    const cos = Math.cos(cam.rotation), sin = Math.sin(cam.rotation);
    return {
      x: viewW / 2 + (dx * cos - dy * sin) * scale,
      y: viewH / 2 + (dx * sin + dy * cos) * scale,
    };
  }

  function screenToWorld(cam, sx, sy, viewW, viewH) {
    const scale = Math.pow(2, cam.zoom);
    const dx = (sx - viewW / 2) / scale, dy = (sy - viewH / 2) / scale;
    const cos = Math.cos(-cam.rotation), sin = Math.sin(-cam.rotation);
    return { x: cam.x + dx * cos - dy * sin, y: cam.y + dx * sin + dy * cos };
  }

  // 视口覆盖的世界包围盒（旋转后取 AABB）
  function visibleWorldRect(cam, viewW, viewH) {
    const corners = [
      screenToWorld(cam, 0, 0, viewW, viewH),
      screenToWorld(cam, viewW, 0, viewW, viewH),
      screenToWorld(cam, 0, viewH, viewW, viewH),
      screenToWorld(cam, viewW, viewH, viewW, viewH),
    ];
    const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
    return {
      minX: Math.min(...xs), minY: Math.min(...ys),
      maxX: Math.max(...xs), maxY: Math.max(...ys),
    };
  }

  // ---------- 瓦片数学 ----------
  const TILE_SIZE = 256;

  // 连续 zoom → 瓦片层级（整数层 + 层内放大系数）
  function zoomDecompose(zoom) {
    const z = Math.max(0, Math.min(11, Math.floor(zoom)));
    return { z, scale: Math.pow(2, zoom - z) };
  }

  // 某层级下覆盖世界包围盒的瓦片集合
  function tilesForRect(rect, z) {
    const ts = TILE_SIZE; // 层级 z 下 1 世界单位 = 2^z 像素；瓦片边长(世界单位) = 256 / 2^z
    const worldTile = ts / Math.pow(2, z);
    const x0 = Math.floor(rect.minX / worldTile), x1 = Math.floor(rect.maxX / worldTile);
    const y0 = Math.floor(rect.minY / worldTile), y1 = Math.floor(rect.maxY / worldTile);
    const tiles = [];
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        tiles.push({ z, x: tx, y: ty, worldX: tx * worldTile, worldY: ty * worldTile, worldSize: worldTile });
    return tiles;
  }

  // ---------- 细节层级（LOD） ----------
  function lodForZoom(zoom) {
    return {
      terrainOctaves: zoom < 2 ? 3 : zoom < 4 ? 4 : 5,
      showRivers: zoom >= 2.5,
      showRoads: zoom >= 2,
      maxLabels: zoom < 2 ? 12 : zoom < 3.5 ? 24 : zoom < 5 ? 48 : 80,
      labelMinPop: zoom < 2 ? 250000 : zoom < 3.5 ? 80000 : zoom < 5 ? 15000 : 0,
    };
  }

  // ---------- 标注避让（优先级从高到低，AABB 拒绝） ----------
  // 输入：屏幕坐标候选 [{x,y,text,priority}]，输出：被放置的子集（带 box）
  function layoutLabels(candidates, measure, viewW, viewH) {
    const sorted = [...candidates].sort((a, b) => b.priority - a.priority);
    const placed = [], boxes = [];
    for (const c of sorted) {
      const m = measure(c.text);
      const box = {
        x0: c.x + 6, y0: c.y - m.height / 2,
        x1: c.x + 6 + m.width, y1: c.y + m.height / 2,
      };
      if (box.x0 < 0 || box.y0 < 0 || box.x1 > viewW || box.y1 > viewH) continue;
      let hit = false;
      for (const b of boxes) {
        if (box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0) { hit = true; break; }
      }
      if (hit) continue;
      boxes.push(box);
      placed.push({ ...c, box });
    }
    return placed;
  }

  // ---------- 场景摘要（哈希 + 对象计数，用于对照与一致性校验） ----------
  function sceneDigest(world, cam, layers, viewW, viewH) {
    const rect = visibleWorldRect(cam, viewW, viewH);
    const lod = lodForZoom(cam.zoom);
    const { z } = zoomDecompose(cam.zoom);
    const tiles = layers.terrain || layers.water || layers.roads
      ? tilesForRect(rect, z) : [];
    const visibleCities = world.cities.filter(c =>
      c.x >= rect.minX && c.x <= rect.maxX && c.y >= rect.minY && c.y <= rect.maxY &&
      c.population >= lod.labelMinPop);
    const visibleRoads = world.roads.filter(r =>
      r.pts.some(p => p.x >= rect.minX - 64 && p.x <= rect.maxX + 64 &&
                      p.y >= rect.minY - 64 && p.y <= rect.maxY + 64));
    const digestObj = {
      seed: world.params.seed,
      cam: {
        x: +cam.x.toFixed(4), y: +cam.y.toFixed(4),
        zoom: +cam.zoom.toFixed(6), rotation: +cam.rotation.toFixed(6),
      },
      layers, z,
      tileCount: tiles.length,
      cityCount: visibleCities.length,
      roadCount: visibleRoads.length,
      counts: {
        citiesTotal: world.cities.length,
        roadsTotal: world.roads.length,
      },
    };
    const hash = hashStr(JSON.stringify(digestObj));
    return { ...digestObj, hash };
  }

  // ---------- 快照（一键恢复） ----------
  function createSnapshot(params, cam, layers) {
    return JSON.parse(JSON.stringify({
      version: 1, params, camera: cam, layers,
      savedAt: new Date().toISOString(),
    }));
  }

  function restoreSnapshot(snap) {
    if (!snap || typeof snap !== 'object') throw new Error('快照为空或损坏');
    if (snap.version !== 1) throw new Error('快照版本不支持: ' + snap.version);
    const params = { ...DEFAULT_PARAMS, ...snap.params };
    const errs = validateParams(params);
    if (errs.length) throw new Error('快照参数非法: ' + errs.join('; '));
    const cam = createCamera(snap.camera);
    const camErrs = validateCamera(cam);
    if (camErrs.length) throw new Error('快照相机非法: ' + camErrs.join('; '));
    const layers = Object.assign({ terrain: true, water: true, roads: true, labels: true }, snap.layers);
    return { params, camera: cam, layers };
  }
  global.Engine = {
    mulberry32, hashStr, hashU32, makeNoise2D, fbm,
    DEFAULT_PARAMS, TERRAIN_TYPES, TERRAIN_COLORS,
    validateParams, affectedLayers, PARAM_LAYER_MAP,
    WORLD_SIZE, createWorld, cityName,
    createCamera, validateCamera,
    worldToScreen, screenToWorld, visibleWorldRect,
    TILE_SIZE, zoomDecompose, tilesForRect, lodForZoom,
    layoutLabels, sceneDigest, createSnapshot, restoreSnapshot,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Engine;
})(typeof window !== 'undefined' ? window : globalThis);
