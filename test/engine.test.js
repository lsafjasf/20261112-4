/* 无头测试：node test/engine.test.js
 * 覆盖三类场景：普通（确定性/一致性）、边界（瓦片缝/缩放边界/旋转周期）、失败（非法输入）。 */
'use strict';
const E = require('../engine.js');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; failures.push(name); console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n[' + t + ']'); }

const P = { ...E.DEFAULT_PARAMS };
const LAYERS = { terrain: true, water: true, roads: true, labels: true };

section('普通场景：确定性与重算一致性');
{
  const w1 = E.createWorld(P);
  const w2 = E.createWorld(P);
  check('相同 seed 城市数一致', w1.cities.length === w2.cities.length,
    w1.cities.length + ' vs ' + w2.cities.length);
  check('相同 seed 道路数一致', w1.roads.length === w2.roads.length);
  check('城市坐标逐点一致', w1.cities.every((c, i) =>
    c.x === w2.cities[i].x && c.y === w2.cities[i].y && c.name === w2.cities[i].name));

  const cam = E.createCamera({ zoom: 3.4, rotation: 0.3 });
  const d1 = E.sceneDigest(w1, cam, LAYERS, 800, 600);
  const d2 = E.sceneDigest(w2, E.createCamera({ zoom: 3.4, rotation: 0.3 }), LAYERS, 800, 600);
  check('重算前后场景哈希一致', d1.hash === d2.hash, d1.hash + ' vs ' + d2.hash);
  check('重算前后对象数量一致',
    d1.tileCount === d2.tileCount && d1.cityCount === d2.cityCount && d1.roadCount === d2.roadCount);

  const w3 = E.createWorld({ ...P, seed: P.seed + 1 });
  check('不同 seed 产生不同世界', w3.cities.length !== w1.cities.length ||
    w3.cities.some((c, i) => !w1.cities[i] || c.x !== w1.cities[i].x));

  check('地形类型 ≥ 3 种实际出现', (() => {
    const seen = new Set();
    for (let y = 0; y < E.WORLD_SIZE; y += 64)
      for (let x = 0; x < E.WORLD_SIZE; x += 64) seen.add(w1.terrainAt(x, y));
    return seen.size >= 3;
  })());
}

section('普通场景：投影与导出一致性');
{
  const cam = E.createCamera({ x: 2000, y: 1500, zoom: 4.2, rotation: 0.7 });
  const p = E.worldToScreen(cam, 2100, 1600, 800, 600);
  const q = E.screenToWorld(cam, p.x, p.y, 800, 600);
  check('世界→屏幕→世界往返误差 < 1e-9',
    Math.abs(q.x - 2100) < 1e-9 && Math.abs(q.y - 1600) < 1e-9);
  // 导出 2x 模型：zoom + log2(k)、画布 k 倍 → 同一世界点屏幕坐标严格 ×k
  const k = 2;
  const camX = E.createCamera({ ...cam, zoom: cam.zoom + Math.log2(k) });
  const p1 = E.worldToScreen(cam, 2100, 1600, 800, 600);
  const p2 = E.worldToScreen(camX, 2100, 1600, 800 * k, 600 * k);
  check('高分辨率导出坐标按比例一致',
    Math.abs(p2.x - k * p1.x) < 1e-9 && Math.abs(p2.y - k * p1.y) < 1e-9);
}

section('边界场景：瓦片缝、缩放边界、旋转周期');
{
  const w = E.createWorld(P);
  // 瓦片缝：z=3 时瓦片世界边长 32，跨越 x=32k 边界采样应连续
  let maxDelta = 0;
  for (let k = 1; k < 20; k++) {
    for (const y of [10, 500, 2048]) {
      const x = k * 32;
      maxDelta = Math.max(maxDelta,
        Math.abs(w.elevation(x - 1e-6, y) - w.elevation(x + 1e-6, y)));
    }
  }
  check('跨瓦片边界高程连续 (Δ<1e-4)', maxDelta < 1e-4, 'maxDelta=' + maxDelta);

  // 缩放边界：zoom 跨越整数层不抛错且瓦片数连续变化
  const camA = E.createCamera({ zoom: 3.9999 });
  const camB = E.createCamera({ zoom: 4.0001 });
  const dA = E.sceneDigest(w, camA, LAYERS, 800, 600);
  const dB = E.sceneDigest(w, camB, LAYERS, 800, 600);
  check('连续缩放跨整数层不中断', dA.tileCount > 0 && dB.tileCount > 0);

  // 旋转周期：rotation 0 与 2π 投影一致
  const c0 = E.createCamera({ zoom: 3, rotation: 0 });
  const c1 = E.createCamera({ zoom: 3, rotation: Math.PI * 2 });
  const a = E.worldToScreen(c0, 1234, 987, 800, 600);
  const b = E.worldToScreen(c1, 1234, 987, 800, 600);
  check('旋转 2π 后屏幕位置一致', Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6);

  // 标注避让：高优先级挤走低优先级
  const placed = E.layoutLabels(
    [{ x: 100, y: 100, text: '低', priority: 1 },
     { x: 102, y: 101, text: '高', priority: 9 }],
    t => ({ width: t.length * 12, height: 14 }), 800, 600);
  check('标注避让保留高优先级', placed.length === 1 && placed[0].text === '高');
  // 视口外标注被剔除
  const placed2 = E.layoutLabels(
    [{ x: -500, y: 100, text: '屏外', priority: 9 }],
    t => ({ width: 24, height: 14 }), 800, 600);
  check('视口外标注被剔除', placed2.length === 0);
}

section('边界场景：增量失效');
{
  check('改 labelDensity 只影响 labels',
    JSON.stringify(E.affectedLayers(['labelDensity'])) === JSON.stringify(['labels']));
  check('改 waterLevel 影响 terrain+water',
    E.affectedLayers(['waterLevel']).sort().join(',') === 'terrain,water');
  check('改 seed 影响全部图层', E.affectedLayers(['seed']).length === 4);
  check('未知参数不影响任何图层', E.affectedLayers(['nope']).length === 0);
}

section('失败场景：非法输入被拒绝且不破坏状态');
{
  let threw = 0;
  try { E.createWorld({ ...P, seed: NaN }); } catch (e) { threw++; }
  try { E.createWorld({ ...P, waterLevel: 1.5 }); } catch (e) { threw++; }
  try { E.createWorld({ ...P, cityCount: -3 }); } catch (e) { threw++; }
  check('非法参数世界生成被拒绝 ×3', threw === 3);

  check('非法相机被检出', E.validateCamera({ x: 0, y: 0, zoom: -1, rotation: 0 }).length > 0);
  check('NaN 旋转被检出', E.validateCamera({ x: 0, y: 0, zoom: 3, rotation: NaN }).length > 0);

  let snapErr = 0;
  try { E.restoreSnapshot(null); } catch (e) { snapErr++; }
  try { E.restoreSnapshot({ version: 99 }); } catch (e) { snapErr++; }
  try { E.restoreSnapshot({ version: 1, params: { seed: NaN } }); } catch (e) { snapErr++; }
  check('损坏快照被拒绝 ×3', snapErr === 3);

  const good = E.createSnapshot(P, E.createCamera(), LAYERS);
  const restored = E.restoreSnapshot(JSON.parse(JSON.stringify(good)));
  check('合法快照恢复成功', restored.params.seed === P.seed);
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
if (fail) { console.log('失败项: ' + failures.join('; ')); process.exit(1); }
