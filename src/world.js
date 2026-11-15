import { SeededRandom, hashString, round } from "./rng.js";

export const WORLD = Object.freeze({
  width: 1600,
  height: 1000,
  margin: 38,
  cell: 20,
  navClearance: 30,
});

export const HOME = Object.freeze({ x: 158, y: 842, radius: 62 });

const ARTIFACT_BASES = [
  { id: "A", name: "沉船罗经", code: "ART-01", x: 620, y: 486, mass: 4.8, color: "#72e7e1" },
  { id: "B", name: "封存航海钟", code: "ART-02", x: 926, y: 505, mass: 6.2, color: "#f1b966" },
  { id: "C", name: "青瓷货箱", code: "ART-03", x: 1192, y: 624, mass: 5.4, color: "#8d9cff" },
];

const HULL_BASE = [
  { x: 445, y: 606 },
  { x: 505, y: 462 },
  { x: 676, y: 345 },
  { x: 896, y: 318 },
  { x: 1118, y: 361 },
  { x: 1314, y: 463 },
  { x: 1404, y: 586 },
  { x: 1346, y: 706 },
  { x: 1158, y: 767 },
  { x: 900, y: 742 },
  { x: 690, y: 714 },
  { x: 504, y: 673 },
];

const OBSTACLE_BASES = [
  { x: 350, y: 690, r: 34, kind: "rock", fixed: true, drill: true },
  { x: 520, y: 356, r: 39, kind: "mast" },
  { x: 778, y: 329, r: 32, kind: "debris" },
  { x: 1042, y: 368, r: 45, kind: "rock" },
  { x: 1278, y: 419, r: 36, kind: "vent" },
  { x: 700, y: 570, r: 25, kind: "debris" },
  { x: 1070, y: 559, r: 23, kind: "mast" },
  { x: 900, y: 696, r: 33, kind: "rock" },
  { x: 1360, y: 648, r: 40, kind: "debris" },
];

const SAFE_ROUTE_BASE = [
  { x: 1192, y: 624 },
  { x: 1238, y: 744 },
  { x: 1220, y: 826 },
  { x: 960, y: 854 },
  { x: 700, y: 852 },
  { x: 450, y: 830 },
  { x: 260, y: 805 },
  { x: HOME.x, y: HOME.y },
];

const ROUTE_NODE_BASES = [
  { id: "R1", label: "南侧航道", x: 450, y: 830 },
  { id: "R2", label: "断层绕行点", x: 960, y: 854 },
  { id: "R3", label: "货舱出口", x: 1220, y: 826 },
];

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function segmentMetal(id, a, b) {
  return {
    id,
    a: { x: round(a.x, 2), y: round(a.y, 2) },
    b: { x: round(b.x, 2), y: round(b.y, 2) },
    midpoint: { x: round((a.x + b.x) / 2, 2), y: round((a.y + b.y) / 2, 2) },
  };
}

function segmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return pointDistance(point, a);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function routeClearance(point, route) {
  let best = Infinity;
  for (let i = 0; i < route.length - 1; i += 1) {
    best = Math.min(best, segmentDistance(point, route[i], route[i + 1]));
  }
  return best;
}

function generateObstacles(rng) {
  const obstacles = OBSTACLE_BASES.map((item, index) => {
    const wobble = item.fixed ? 0 : 4;
    return {
      id: `O${String(index + 1).padStart(2, "0")}`,
      x: round(item.x + rng.range(-wobble, wobble), 2),
      y: round(item.y + rng.range(-wobble, wobble), 2),
      radius: round(item.r + rng.range(-1.5, 1.5), 2),
      kind: item.kind,
      drill: Boolean(item.drill),
    };
  });

  let attempts = 0;
  while (obstacles.length < 16 && attempts < 160) {
    attempts += 1;
    const candidate = {
      x: round(rng.range(280, 1430), 2),
      y: round(rng.range(270, 760), 2),
      radius: round(rng.range(18, 38), 2),
      kind: rng.pick(["debris", "rock", "vent", "mast"]),
    };
    const clearOfArtifacts = ARTIFACT_BASES.every((artifact) => pointDistance(candidate, artifact) > candidate.radius + 72);
    const clearOfRoute = routeClearance(candidate, SAFE_ROUTE_BASE) > candidate.radius + 54;
    const clearOfHome = pointDistance(candidate, HOME) > candidate.radius + 120;
    const clearOfDrill = pointDistance(candidate, OBSTACLE_BASES[0]) > candidate.radius + 82;
    const clearOfOthers = obstacles.every((item) => pointDistance(candidate, item) > candidate.radius + item.radius + 44);
    if (clearOfArtifacts && clearOfRoute && clearOfHome && clearOfDrill && clearOfOthers) {
      obstacles.push({ id: `O${String(obstacles.length + 1).padStart(2, "0")}`, ...candidate });
    }
  }
  return obstacles;
}

function generateHull(rng) {
  const points = HULL_BASE.map((point) => ({
    x: round(point.x + rng.range(-6, 6), 2),
    y: round(point.y + rng.range(-5, 5), 2),
  }));
  return points.map((point, index) => segmentMetal(`H${String(index + 1).padStart(2, "0")}`, point, points[(index + 1) % points.length]));
}

export function makeWorld(seed) {
  const normalizedSeed = String(seed);
  const rng = new SeededRandom(normalizedSeed);
  const hull = generateHull(rng.fork("hull"));
  const obstacles = generateObstacles(rng.fork("obstacles"));
  const artifacts = ARTIFACT_BASES.map((artifact, index) => {
    const local = rng.fork(`artifact-${artifact.id}`);
    return {
      ...artifact,
      x: round(artifact.x + local.range(-5, 5), 2),
      y: round(artifact.y + local.range(-4, 4), 2),
      nodeIndex: index,
    };
  });
  const routeNodes = ROUTE_NODE_BASES.map((node, index) => {
    const local = rng.fork(`route-${node.id}`);
    return { ...node, x: round(node.x + local.range(-4, 4), 2), y: round(node.y + local.range(-4, 4), 2), index };
  });
  const safeRoute = SAFE_ROUTE_BASE.map((point, index) => {
    if (index === 1) return { x: routeNodes[2].x, y: routeNodes[2].y - 68 };
    if (index === 2) return { x: routeNodes[2].x, y: routeNodes[2].y };
    if (index === 3) return { x: routeNodes[1].x, y: routeNodes[1].y };
    if (index === 4) return { x: 700, y: routeNodes[1].y - 2 };
    if (index === 5) return { x: routeNodes[0].x, y: routeNodes[0].y };
    return point;
  });

  const canonical = {
    seed: normalizedSeed,
    hull: hull.map((segment) => [segment.a.x, segment.a.y, segment.b.x, segment.b.y]),
    obstacles: obstacles.map((item) => [item.x, item.y, item.radius, item.kind]),
    artifacts: artifacts.map((item) => [item.id, item.x, item.y]),
    routeNodes: routeNodes.map((item) => [item.id, item.x, item.y]),
  };

  const world = {
    seed: normalizedSeed,
    width: WORLD.width,
    height: WORLD.height,
    home: { ...HOME },
    hull,
    obstacles,
    artifacts,
    routeNodes,
    safeRoute,
    riskShortcut: [
      { x: artifacts[2].x, y: artifacts[2].y },
      { x: 930, y: 690 },
      { x: 540, y: 760 },
      { x: HOME.x, y: HOME.y },
    ],
    layoutHash: hashString(JSON.stringify(canonical)),
    nav: null,
  };
  world.nav = buildNavGrid(world);
  return world;
}

export function collisionAt(world, x, y, clearance = 13) {
  for (const obstacle of world.obstacles) {
    const distance = Math.hypot(x - obstacle.x, y - obstacle.y);
    if (distance < obstacle.radius + clearance) {
      return obstacle;
    }
  }
  return null;
}

export function pointBlocked(world, x, y, clearance = WORLD.navClearance) {
  if (x < WORLD.margin || y < WORLD.margin || x > world.width - WORLD.margin || y > world.height - WORLD.margin) {
    return true;
  }
  return Boolean(collisionAt(world, x, y, clearance));
}

function buildNavGrid(world) {
  const cell = WORLD.cell;
  const cols = Math.floor(world.width / cell);
  const rows = Math.floor(world.height / cell);
  const blocked = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = (col + 0.5) * cell;
      const y = (row + 0.5) * cell;
      blocked[row * cols + col] = pointBlocked(world, x, y) ? 1 : 0;
    }
  }
  return { cell, cols, rows, blocked };
}

function nearestFreeCell(nav, x, y) {
  const baseCol = Math.max(0, Math.min(nav.cols - 1, Math.floor(x / nav.cell)));
  const baseRow = Math.max(0, Math.min(nav.rows - 1, Math.floor(y / nav.cell)));
  for (let radius = 0; radius < 8; radius += 1) {
    for (let row = baseRow - radius; row <= baseRow + radius; row += 1) {
      for (let col = baseCol - radius; col <= baseCol + radius; col += 1) {
        if (col < 0 || row < 0 || col >= nav.cols || row >= nav.rows) continue;
        if (!nav.blocked[row * nav.cols + col]) return { col, row };
      }
    }
  }
  return null;
}

function bfsPath(nav, start, goal) {
  const startCell = nearestFreeCell(nav, start.x, start.y);
  const goalCell = nearestFreeCell(nav, goal.x, goal.y);
  if (!startCell || !goalCell) return [];
  const total = nav.cols * nav.rows;
  const startIndex = startCell.row * nav.cols + startCell.col;
  const goalIndex = goalCell.row * nav.cols + goalCell.col;
  const parent = new Int32Array(total);
  parent.fill(-2);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  queue[tail++] = startIndex;
  parent[startIndex] = -1;
  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (head < tail) {
    const index = queue[head++];
    if (index === goalIndex) break;
    const col = index % nav.cols;
    const row = Math.floor(index / nav.cols);
    for (const [dc, dr] of neighbors) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= nav.cols || nr >= nav.rows) continue;
      const next = nr * nav.cols + nc;
      if (nav.blocked[next] || parent[next] !== -2) continue;
      parent[next] = index;
      queue[tail++] = next;
    }
  }
  if (parent[goalIndex] === -2) return [];
  const reversed = [];
  let cursor = goalIndex;
  while (cursor !== -1) {
    const col = cursor % nav.cols;
    const row = Math.floor(cursor / nav.cols);
    reversed.push({ x: (col + 0.5) * nav.cell, y: (row + 0.5) * nav.cell });
    cursor = parent[cursor];
  }
  reversed.reverse();
  return [{ x: start.x, y: start.y }, ...reversed.slice(1), { x: goal.x, y: goal.y }];
}

function segmentClear(world, a, b) {
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(distance / 12));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    if (pointBlocked(world, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  }
  return true;
}

function smoothPath(world, points) {
  if (points.length < 3) return points;
  const output = [points[0]];
  let index = 0;
  while (index < points.length - 1) {
    let next = index + 1;
    for (let candidate = points.length - 1; candidate > index + 1; candidate -= 1) {
      if (segmentClear(world, points[index], points[candidate])) {
        next = candidate;
        break;
      }
    }
    output.push(points[next]);
    index = next;
  }
  return output;
}

export function planPath(world, start, goal) {
  return smoothPath(world, bfsPath(world.nav, start, goal));
}

export function checkReachability(world) {
  const targets = [
    { id: "HOME", ...world.home },
    ...world.artifacts.map((artifact) => ({ id: artifact.id, x: artifact.x, y: artifact.y })),
    ...world.routeNodes.map((node) => ({ id: node.id, x: node.x, y: node.y })),
  ];
  const checks = targets.map((target) => {
    const path = planPath(world, world.home, target);
    return { id: target.id, ok: path.length > 1, points: path.length };
  });
  return {
    ok: checks.every((check) => check.ok),
    passed: checks.filter((check) => check.ok).length,
    total: checks.length,
    checks,
  };
}
