import {
  multiply4,
  rotationX4,
  rotationZ4,
  translation4
} from "./math.mjs";
import {
  hashMesh,
  hashString,
  hashToHex,
  makeBox,
  makeCylinder,
  makeExtrusion,
  makeHemisphere,
  makeTorus,
  mergeMeshes,
  meshBounds,
  transformMesh
} from "./geometry.mjs";

export const MATERIALS = {
  steel: {
    id: "steel",
    label: "Steel",
    baseColor: [0.52, 0.64, 0.75],
    metallic: 0.82,
    roughness: 0.28,
    swatch: "#a9bfd2"
  },
  painted: {
    id: "painted",
    label: "Painted",
    baseColor: [0.78, 0.19, 0.09],
    metallic: 0.12,
    roughness: 0.54,
    swatch: "#e96540"
  }
};

function at(mesh, x, y, z) {
  return transformMesh(mesh, translation4(x, y, z));
}

function rotatedAt(mesh, rotation, x, y, z) {
  return transformMesh(mesh, multiply4(translation4(x, y, z), rotation));
}

function makeMountingPlate() {
  const pieces = [at(makeBox(2.45, 0.22, 1.72), -2.05, 0.12, 0.12)];
  for (const x of [-0.86, 0.86]) {
    for (const z of [-0.56, 0.56]) {
      pieces.push(at(makeCylinder(0.16, 0.16, 28), -2.05 + x, 0.31, 0.12 + z));
      pieces.push(at(makeCylinder(0.075, 0.045, 20), -2.05 + x, 0.412, 0.12 + z));
    }
  }
  return mergeMeshes(pieces);
}

function makeDriveShaft() {
  const zRotation = rotationZ4(Math.PI / 2);
  const pieces = [rotatedAt(makeCylinder(0.22, 1.98, 42), zRotation, -0.28, 0.8, 0.54)];
  for (const x of [-0.78, 0, 0.78]) {
    pieces.push(rotatedAt(makeCylinder(0.31, 0.12, 36), zRotation, -0.28 + x, 0.8, 0.54));
  }
  return mergeMeshes(pieces);
}

function makeBearingRing() {
  const ring = rotatedAt(makeTorus(0.48, 0.145, 42, 14), rotationX4(Math.PI / 2), -2.03, 0.9, -0.55);
  const axle = rotatedAt(makeCylinder(0.12, 0.46, 28), rotationX4(Math.PI / 2), -2.03, 0.9, -0.55);
  return mergeMeshes([ring, axle]);
}

function makeHousing() {
  const outline = [
    [-1.02, -0.45],
    [0.9, -0.45],
    [1.02, -0.27],
    [1.02, 0.34],
    [0.58, 0.59],
    [-0.63, 0.59],
    [-1.02, 0.28]
  ];
  const body = at(makeExtrusion(outline, 1.36), 1.62, 0.58, -0.08);
  const boss = at(makeCylinder(0.4, 0.25, 36), 1.99, 0.98, -0.08);
  const seat = at(makeCylinder(0.51, 0.08, 36), 1.99, 0.79, -0.08);
  return mergeMeshes([body, seat, boss]);
}

function makeDomeCover() {
  const pieces = [
    at(makeHemisphere(0.59, 12, 38), 1.48, 0.64, 1.12),
    at(makeCylinder(0.65, 0.14, 40), 1.48, 0.58, 1.12)
  ];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    pieces.push(at(
      makeCylinder(0.055, 0.06, 16),
      1.48 + Math.cos(angle) * 0.47,
      0.83,
      1.12 + Math.sin(angle) * 0.47
    ));
  }
  return mergeMeshes(pieces);
}

function makePaintedFlange() {
  const pieces = [at(makeCylinder(0.56, 0.18, 44), 0.12, 0.22, 1.4)];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
    pieces.push(at(
      makeCylinder(0.085, 0.26, 18),
      0.12 + Math.cos(angle) * 0.36,
      0.255,
      1.4 + Math.sin(angle) * 0.36
    ));
  }
  pieces.push(at(makeCylinder(0.19, 0.3, 28), 0.12, 0.28, 1.4));
  return mergeMeshes(pieces);
}

const BLUEPRINTS = [
  { id: "P-01", name: "Mounting Plate", material: "steel", build: makeMountingPlate },
  { id: "P-02", name: "Drive Shaft", material: "steel", build: makeDriveShaft },
  { id: "P-03", name: "Bearing Ring", material: "steel", build: makeBearingRing },
  { id: "P-04", name: "Pump Housing", material: "painted", build: makeHousing },
  { id: "P-05", name: "Dome Cover", material: "painted", build: makeDomeCover },
  { id: "P-06", name: "Painted Flange", material: "painted", build: makePaintedFlange }
];

export function buildSceneParts() {
  return BLUEPRINTS.map((blueprint, index) => {
    const mesh = blueprint.build();
    const bounds = meshBounds(mesh);
    const meshHash = hashMesh(mesh);
    return {
      ...blueprint,
      slot: index,
      mesh,
      bounds,
      meshHash,
      hash: hashToHex(meshHash),
      triangleCount: mesh.triangleCount,
      vertexCount: mesh.positions.length / 3
    };
  });
}

export function sceneHash(parts) {
  const descriptor = parts
    .map((part) => `${part.id}|${part.material}|${part.hash}|${part.triangleCount}`)
    .join(";");
  return hashToHex(hashString(descriptor));
}

export function sceneCounts(parts) {
  let vertices = 0;
  let triangles = 0;
  for (const part of parts) {
    vertices += part.vertexCount;
    triangles += part.triangleCount;
  }
  return {
    objects: parts.length,
    vertices,
    triangles,
    materials: new Set(parts.map((part) => part.material)).size
  };
}

export function fullyClipped(part, clip) {
  if (!clip.enabled) return false;
  const axisIndex = clip.axis === "x" ? 0 : clip.axis === "z" ? 2 : 1;
  if (clip.direction >= 0) return part.bounds.max[axisIndex] < clip.offset - 1e-6;
  return part.bounds.min[axisIndex] > clip.offset + 1e-6;
}
