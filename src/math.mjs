export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const lerp = (a, b, t) => a + (b - a) * t;

export function vec3(x = 0, y = 0, z = 0) {
  return [x, y, z];
}

export function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale3(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

export function length3(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize3(a) {
  const length = length3(a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}

export function identity4() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function multiply4(a, b) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let k = 0; k < 4; k += 1) {
        value += a[k * 4 + row] * b[column * 4 + k];
      }
      out[column * 4 + row] = value;
    }
  }
  return out;
}

export function translation4(x, y, z) {
  const out = identity4();
  out[12] = x;
  out[13] = y;
  out[14] = z;
  return out;
}

export function scale4(x, y = x, z = x) {
  const out = identity4();
  out[0] = x;
  out[5] = y;
  out[10] = z;
  return out;
}

export function rotationX4(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

export function rotationY4(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

export function rotationZ4(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function perspective4(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const rangeInv = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * rangeInv, -1,
    0, 0, near * far * 2 * rangeInv, 0
  ]);
}

export function lookAt4(eye, target, up) {
  const z = normalize3(sub3(eye, target));
  const x = normalize3(cross3(up, z));
  const y = cross3(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1
  ]);
}

export function transformPoint4(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
  ];
}

export function transformDirection4(m, p) {
  return normalize3([
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2]
  ]);
}

export function inverse3(m) {
  const a = m[0];
  const b = m[1];
  const c = m[2];
  const d = m[3];
  const e = m[4];
  const f = m[5];
  const g = m[6];
  const h = m[7];
  const i = m[8];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const inv = 1 / det;
  return [
    (e * i - f * h) * inv, (c * h - b * i) * inv, (b * f - c * e) * inv,
    (f * g - d * i) * inv, (a * i - c * g) * inv, (c * d - a * f) * inv,
    (d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv
  ];
}

export function normalMatrix3(m) {
  const upper = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const inv = inverse3(upper);
  return new Float32Array([
    inv[0], inv[3], inv[6],
    inv[1], inv[4], inv[7],
    inv[2], inv[5], inv[8]
  ]);
}

export function aabbFromPositions(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[i + axis]);
      max[axis] = Math.max(max[axis], positions[i + axis]);
    }
  }
  return { min, max, size: sub3(max, min), center: scale3(add3(min, max), 0.5) };
}

export function projectPoint(viewProjection, point, width, height) {
  const x = viewProjection[0] * point[0] + viewProjection[4] * point[1] + viewProjection[8] * point[2] + viewProjection[12];
  const y = viewProjection[1] * point[0] + viewProjection[5] * point[1] + viewProjection[9] * point[2] + viewProjection[13];
  const z = viewProjection[2] * point[0] + viewProjection[6] * point[1] + viewProjection[10] * point[2] + viewProjection[14];
  const w = viewProjection[3] * point[0] + viewProjection[7] * point[1] + viewProjection[11] * point[2] + viewProjection[15];
  const invW = Math.abs(w) > 1e-8 ? 1 / w : 1;
  return {
    x: (x * invW * 0.5 + 0.5) * width,
    y: (1 - (y * invW * 0.5 + 0.5)) * height,
    depth: z * invW
  };
}

export function cameraBasis(camera) {
  const target = camera.target;
  const cp = Math.cos(camera.pitch);
  const eye = [
    target[0] + camera.distance * cp * Math.sin(camera.yaw),
    target[1] + camera.distance * Math.sin(camera.pitch),
    target[2] + camera.distance * cp * Math.cos(camera.yaw)
  ];
  const forward = normalize3(sub3(target, eye));
  const right = normalize3(cross3(forward, [0, 1, 0]));
  const up = normalize3(cross3(right, forward));
  return { eye, forward, right, up, target };
}

export function rayFromNdc(camera, ndcX, ndcY, aspect, fovY) {
  const basis = cameraBasis(camera);
  const tanHalf = Math.tan(fovY / 2);
  const direction = normalize3(add3(
    basis.forward,
    add3(scale3(basis.right, ndcX * tanHalf * aspect), scale3(basis.up, ndcY * tanHalf))
  ));
  return { origin: basis.eye, direction };
}

export function rayTriangle(origin, direction, a, b, c) {
  const edge1 = sub3(b, a);
  const edge2 = sub3(c, a);
  const p = cross3(direction, edge2);
  const determinant = dot3(edge1, p);
  if (Math.abs(determinant) < 1e-9) return null;
  const invDet = 1 / determinant;
  const t = sub3(origin, a);
  const u = dot3(t, p) * invDet;
  if (u < 0 || u > 1) return null;
  const q = cross3(t, edge1);
  const v = dot3(direction, q) * invDet;
  if (v < 0 || u + v > 1) return null;
  const distance = dot3(edge2, q) * invDet;
  return distance > 1e-5 ? distance : null;
}

export function axisValue(vector, axis) {
  if (axis === "x") return vector[0];
  if (axis === "z") return vector[2];
  return vector[1];
}

export function clipTest(point, clip) {
  if (!clip.enabled) return true;
  const d = axisValue(point, clip.axis) - clip.offset;
  return clip.direction >= 0 ? d >= 0 : d <= 0;
}
