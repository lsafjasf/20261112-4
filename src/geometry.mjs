import {
  normalMatrix3,
  transformDirection4,
  transformPoint4,
  aabbFromPositions
} from "./math.mjs";

export function createMesh(positions, normals, indices) {
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    indexCount: indices.length,
    triangleCount: indices.length / 3
  };
}

export function mergeMeshes(meshes) {
  let positionLength = 0;
  let indexLength = 0;
  for (const mesh of meshes) {
    positionLength += mesh.positions.length;
    indexLength += mesh.indices.length;
  }
  const positions = new Float32Array(positionLength);
  const normals = new Float32Array(positionLength);
  const indices = new Uint32Array(indexLength);
  let positionOffset = 0;
  let indexOffset = 0;
  for (const mesh of meshes) {
    positions.set(mesh.positions, positionOffset);
    normals.set(mesh.normals, positionOffset);
    for (let i = 0; i < mesh.indices.length; i += 1) {
      indices[indexOffset + i] = mesh.indices[i] + positionOffset / 3;
    }
    positionOffset += mesh.positions.length;
    indexOffset += mesh.indices.length;
  }
  return createMesh(positions, normals, indices);
}

export function transformMesh(mesh, matrix) {
  const positions = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);
  const nMatrix = normalMatrix3(matrix);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const p = transformPoint4(matrix, [
      mesh.positions[i],
      mesh.positions[i + 1],
      mesh.positions[i + 2]
    ]);
    positions[i] = p[0];
    positions[i + 1] = p[1];
    positions[i + 2] = p[2];

    const rawNormal = [
      mesh.normals[i],
      mesh.normals[i + 1],
      mesh.normals[i + 2]
    ];
    const n = [
      nMatrix[0] * rawNormal[0] + nMatrix[3] * rawNormal[1] + nMatrix[6] * rawNormal[2],
      nMatrix[1] * rawNormal[0] + nMatrix[4] * rawNormal[1] + nMatrix[7] * rawNormal[2],
      nMatrix[2] * rawNormal[0] + nMatrix[5] * rawNormal[1] + nMatrix[8] * rawNormal[2]
    ];
    const length = Math.hypot(n[0], n[1], n[2]) || 1;
    normals[i] = n[0] / length;
    normals[i + 1] = n[1] / length;
    normals[i + 2] = n[2] / length;
  }
  return createMesh(positions, normals, mesh.indices);
}

export function makeBox(width, height, depth) {
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;
  const faces = [
    { n: [1, 0, 0], p: [[x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z]] },
    { n: [-1, 0, 0], p: [[-x, -y, z], [-x, y, z], [-x, y, -z], [-x, -y, -z]] },
    { n: [0, 1, 0], p: [[-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z]] },
    { n: [0, -1, 0], p: [[-x, -y, z], [-x, -y, -z], [x, -y, -z], [x, -y, z]] },
    { n: [0, 0, 1], p: [[x, -y, z], [x, y, z], [-x, y, z], [-x, -y, z]] },
    { n: [0, 0, -1], p: [[-x, -y, -z], [-x, y, -z], [x, y, -z], [x, -y, -z]] }
  ];
  const positions = [];
  const normals = [];
  const indices = [];
  for (const face of faces) {
    const base = positions.length / 3;
    for (const point of face.p) {
      positions.push(...point);
      normals.push(...face.n);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return createMesh(positions, normals, indices);
}

export function makeCylinder(radius, height, segments = 40, caps = true) {
  const positions = [];
  const normals = [];
  const indices = [];
  const half = height / 2;
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const nextAngle = ((i + 1) / segments) * Math.PI * 2;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const cn = Math.cos(nextAngle);
    const sn = Math.sin(nextAngle);
    const base = positions.length / 3;
    positions.push(c * radius, half, s * radius, c * radius, -half, s * radius);
    positions.push(cn * radius, half, sn * radius, cn * radius, -half, sn * radius);
    normals.push(c, 0, s, c, 0, s, cn, 0, sn, cn, 0, sn);
    indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
  }
  if (caps) {
    for (const side of [1, -1]) {
      const centerIndex = positions.length / 3;
      positions.push(0, side * half, 0);
      normals.push(0, side, 0);
      for (let i = 0; i < segments; i += 1) {
        const angle = (i / segments) * Math.PI * 2;
        positions.push(Math.cos(angle) * radius, side * half, Math.sin(angle) * radius);
        normals.push(0, side, 0);
      }
      for (let i = 0; i < segments; i += 1) {
        const current = centerIndex + 1 + i;
        const next = centerIndex + 1 + ((i + 1) % segments);
        if (side > 0) indices.push(centerIndex, next, current);
        else indices.push(centerIndex, current, next);
      }
    }
  }
  return createMesh(positions, normals, indices);
}

export function makeTorus(majorRadius, minorRadius, majorSegments = 36, minorSegments = 12) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let i = 0; i <= majorSegments; i += 1) {
    const u = (i / majorSegments) * Math.PI * 2;
    const cu = Math.cos(u);
    const su = Math.sin(u);
    for (let j = 0; j <= minorSegments; j += 1) {
      const v = (j / minorSegments) * Math.PI * 2;
      const cv = Math.cos(v);
      const sv = Math.sin(v);
      positions.push((majorRadius + minorRadius * cv) * cu, minorRadius * sv, (majorRadius + minorRadius * cv) * su);
      normals.push(cv * cu, sv, cv * su);
    }
  }
  const row = minorSegments + 1;
  for (let i = 0; i < majorSegments; i += 1) {
    for (let j = 0; j < minorSegments; j += 1) {
      const a = i * row + j;
      const b = a + row;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return createMesh(positions, normals, indices);
}

export function makeExtrusion(points, depth) {
  const positions = [];
  const normals = [];
  const indices = [];
  const z = depth / 2;
  const count = points.length;
  for (const side of [1, -1]) {
    const base = positions.length / 3;
    for (const point of points) {
      positions.push(point[0], point[1], side * z);
      normals.push(0, 0, side);
    }
    for (let i = 1; i < count - 1; i += 1) {
      if (side > 0) indices.push(base, base + i, base + i + 1);
      else indices.push(base, base + i + 1, base + i);
    }
  }
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    const a = points[i];
    const b = points[next];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const n = [dy, -dx, 0];
    const length = Math.hypot(n[0], n[1]) || 1;
    n[0] /= length;
    n[1] /= length;
    const base = positions.length / 3;
    positions.push(a[0], a[1], z, b[0], b[1], z, a[0], a[1], -z, b[0], b[1], -z);
    normals.push(...n, ...n, ...n, ...n);
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  return createMesh(positions, normals, indices);
}

export function makeHemisphere(radius, latitudeSegments = 12, longitudeSegments = 36) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let lat = 0; lat <= latitudeSegments; lat += 1) {
    const theta = (lat / latitudeSegments) * Math.PI / 2;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    for (let lon = 0; lon <= longitudeSegments; lon += 1) {
      const phi = (lon / longitudeSegments) * Math.PI * 2;
      const x = st * Math.cos(phi);
      const y = ct;
      const z = st * Math.sin(phi);
      positions.push(x * radius, y * radius, z * radius);
      normals.push(x, y, z);
    }
  }
  const row = longitudeSegments + 1;
  for (let lat = 0; lat < latitudeSegments; lat += 1) {
    for (let lon = 0; lon < longitudeSegments; lon += 1) {
      const a = lat * row + lon;
      const b = a + row;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const centerIndex = positions.length / 3;
  positions.push(0, 0, 0);
  normals.push(0, -1, 0);
  for (let lon = 0; lon < longitudeSegments; lon += 1) {
    const angle = (lon / longitudeSegments) * Math.PI * 2;
    positions.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    normals.push(0, -1, 0);
  }
  for (let lon = 0; lon < longitudeSegments; lon += 1) {
    const current = centerIndex + 1 + lon;
    const next = centerIndex + 1 + ((lon + 1) % longitudeSegments);
    indices.push(centerIndex, current, next);
  }
  return createMesh(positions, normals, indices);
}

export function makeGridLines(size, divisions, y = 0) {
  const positions = [];
  const step = size / divisions;
  const half = size / 2;
  for (let i = 0; i <= divisions; i += 1) {
    const value = -half + i * step;
    positions.push(-half, y, value, half, y, value);
    positions.push(value, y, -half, value, y, half);
  }
  return new Float32Array(positions);
}

export function makePlaneGrid(size, divisions) {
  const positions = [];
  const step = size / divisions;
  const half = size / 2;
  for (let i = 0; i <= divisions; i += 1) {
    const value = -half + i * step;
    positions.push(-half, 0, value, half, 0, value);
    positions.push(value, 0, -half, value, 0, half);
  }
  return new Float32Array(positions);
}

export function meshBounds(mesh) {
  return aabbFromPositions(mesh.positions);
}

function mixInt(hash, value) {
  let h = hash ^ (value | 0);
  h = Math.imul(h, 16777619);
  h ^= h >>> 13;
  return h >>> 0;
}

export function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) hash = mixInt(hash, value.charCodeAt(i));
  return hash >>> 0;
}

export function hashMesh(mesh) {
  let hash = 2166136261;
  hash = mixInt(hash, mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i += 1) {
    hash = mixInt(hash, Math.round(mesh.positions[i] * 1e6));
  }
  for (let i = 0; i < mesh.normals.length; i += 1) {
    hash = mixInt(hash, Math.round(mesh.normals[i] * 1e6));
  }
  for (let i = 0; i < mesh.indices.length; i += 1) hash = mixInt(hash, mesh.indices[i]);
  return hash >>> 0;
}

export function hashToHex(hash) {
  return (hash >>> 0).toString(16).padStart(8, "0");
}
