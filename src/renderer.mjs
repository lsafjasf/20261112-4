import {
  identity4,
  multiply4,
  rotationX4,
  rotationZ4,
  scale4,
  translation4
} from "./math.mjs";
import { makeGridLines, makePlaneGrid } from "./geometry.mjs";

const PART_VERTEX = `#version 300 es
precision highp float;
in vec3 aPosition;
in vec3 aNormal;
uniform mat4 uViewProjection;
out vec3 vWorldPosition;
out vec3 vNormal;
void main() {
  vWorldPosition = aPosition;
  vNormal = aNormal;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;

const PART_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vWorldPosition;
in vec3 vNormal;
uniform vec3 uCameraPosition;
uniform vec3 uBaseColor;
uniform vec3 uClipAxis;
uniform float uClipOffset;
uniform float uClipEnabled;
uniform float uClipDirection;
uniform float uMetallic;
uniform float uRoughness;
out vec4 outColor;
void main() {
  float axisValue = dot(vWorldPosition, uClipAxis);
  float signedDistance = axisValue - uClipOffset;
  if (uClipEnabled > 0.5 &&
      ((uClipDirection > 0.0 && signedDistance < 0.0) ||
       (uClipDirection < 0.0 && signedDistance > 0.0))) discard;

  vec3 viewDirection = normalize(uCameraPosition - vWorldPosition);
  vec3 normal = normalize(vNormal);
  if (!gl_FrontFacing) normal = -normal;
  if (dot(normal, viewDirection) < 0.0) normal = -normal;

  vec3 keyDirection = normalize(vec3(-0.42, 0.86, 0.52));
  vec3 fillDirection = normalize(vec3(0.7, 0.22, -0.55));
  float key = max(dot(normal, keyDirection), 0.0);
  float fill = max(dot(normal, fillDirection), 0.0);
  float hemi = normal.y * 0.5 + 0.5;
  vec3 halfVector = normalize(keyDirection + viewDirection);
  float specularPower = mix(72.0, 10.0, uRoughness);
  float specular = pow(max(dot(normal, halfVector), 0.0), specularPower);
  specular *= mix(0.16, 0.62, uMetallic) * (1.0 - uRoughness * 0.55);
  float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.0);

  vec3 ambient = mix(vec3(0.11, 0.15, 0.19), uBaseColor * 0.34, 0.52);
  vec3 color = ambient + uBaseColor * (key * 0.76 + fill * 0.2 + hemi * 0.12);
  color += vec3(0.9, 0.95, 1.0) * specular;
  color += uBaseColor * rim * 0.16;
  float depthFade = smoothstep(0.32, 0.9, gl_FragCoord.z);
  color = mix(color, vec3(0.035, 0.06, 0.08), depthFade * 0.16);
  outColor = vec4(pow(max(color, 0.0), vec3(0.4545)), 1.0);
}`;

const LINE_VERTEX = `#version 300 es
precision highp float;
in vec3 aPosition;
uniform mat4 uViewProjection;
uniform mat4 uModel;
void main() {
  gl_Position = uViewProjection * uModel * vec4(aPosition, 1.0);
}`;

const LINE_FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  outColor = uColor;
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${message}`);
  }
  return shader;
}

function program(gl, vertexSource, fragmentSource) {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const result = gl.createProgram();
  gl.attachShader(result, vertex);
  gl.attachShader(result, fragment);
  gl.linkProgram(result);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(result);
    gl.deleteProgram(result);
    throw new Error(`Program link failed: ${message}`);
  }
  return result;
}

function locations(gl, result, names) {
  return Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(result, name)]));
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      depth: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance"
    });
    if (!this.gl) {
      const error = new Error("WebGL2 is not available in this browser.");
      error.code = "WEBGL2_UNAVAILABLE";
      throw error;
    }
    this.stats = {
      bufferUploads: 0,
      bufferBytes: 0,
      uploadOperations: 0,
      drawCalls: 0,
      renderedTriangles: 0,
      frames: 0,
      passes: 0,
      contextRestores: 0,
      gpuObjectCount: 0
    };
    this.gpuParts = new Map();
    this.dpr = 1;
    this.width = 1;
    this.height = 1;
    this.initPrograms();
    this.initState();
  }

  initPrograms() {
    const gl = this.gl;
    this.partProgram = program(gl, PART_VERTEX, PART_FRAGMENT);
    this.partAttribs = {
      position: gl.getAttribLocation(this.partProgram, "aPosition"),
      normal: gl.getAttribLocation(this.partProgram, "aNormal")
    };
    this.partUniforms = locations(gl, this.partProgram, [
      "uViewProjection", "uCameraPosition", "uBaseColor", "uClipAxis",
      "uClipOffset", "uClipEnabled", "uClipDirection", "uMetallic", "uRoughness"
    ]);
    this.lineProgram = program(gl, LINE_VERTEX, LINE_FRAGMENT);
    this.lineAttrib = gl.getAttribLocation(this.lineProgram, "aPosition");
    this.lineUniforms = locations(gl, this.lineProgram, ["uViewProjection", "uModel", "uColor"]);
  }

  initState() {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0.025, 0.043, 0.061, 1);
    this.selectionBox = this.createLineMesh(this.unitBoxLines());
    this.clipGrid = this.createLineMesh(makePlaneGrid(5.2, 10));
    this.groundGrid = this.createLineMesh(makeGridLines(15, 15, -0.004));
  }

  unitBoxLines() {
    const positions = [];
    const corners = [];
    for (const x of [-0.5, 0.5]) {
      for (const y of [-0.5, 0.5]) {
        for (const z of [-0.5, 0.5]) corners.push([x, y, z]);
      }
    }
    const edges = [
      [0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3],
      [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]
    ];
    for (const [a, b] of edges) positions.push(...corners[a], ...corners[b]);
    return new Float32Array(positions);
  }

  createLineMesh(positions) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.lineAttrib);
    gl.vertexAttribPointer(this.lineAttrib, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return { vao, buffer, count: positions.length / 3 };
  }

  initStateAfterRestore() {
    this.initPrograms();
    this.initState();
    this.stats.contextRestores += 1;
  }

  resize(cssWidth, cssHeight) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (width === this.canvas.width && height === this.canvas.height) return false;
    this.dpr = dpr;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.viewport(0, 0, width, height);
    return true;
  }

  uploadPart(part) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const positionBuffer = gl.createBuffer();
    const normalBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, part.mesh.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.partAttribs.position);
    gl.vertexAttribPointer(this.partAttribs.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, part.mesh.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.partAttribs.normal);
    gl.vertexAttribPointer(this.partAttribs.normal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, part.mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const bytes = part.mesh.positions.byteLength + part.mesh.normals.byteLength + part.mesh.indices.byteLength;
    this.gpuParts.set(part.id, { vao, positionBuffer, normalBuffer, indexBuffer, count: part.mesh.indexCount });
    this.stats.bufferUploads += 3;
    this.stats.uploadOperations += 1;
    this.stats.bufferBytes += bytes;
    return bytes;
  }

  uploadParts(parts) {
    for (const gpu of this.gpuParts.values()) this.deleteGpuPart(gpu);
    this.gpuParts.clear();
    for (const part of parts) this.uploadPart(part);
    this.stats.gpuObjectCount = this.gpuParts.size;
  }

  deleteGpuPart(gpu) {
    const gl = this.gl;
    gl.deleteVertexArray(gpu.vao);
    gl.deleteBuffer(gpu.positionBuffer);
    gl.deleteBuffer(gpu.normalBuffer);
    gl.deleteBuffer(gpu.indexBuffer);
  }

  axisVector(axis) {
    if (axis === "x") return new Float32Array([1, 0, 0]);
    if (axis === "z") return new Float32Array([0, 0, 1]);
    return new Float32Array([0, 1, 0]);
  }

  draw(clip, camera, visibleParts, selectedPart, showSelection = true) {
    const gl = this.gl;
    gl.viewport(0, 0, this.width, this.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.useProgram(this.partProgram);
    gl.uniformMatrix4fv(this.partUniforms.uViewProjection, false, camera.viewProjection);
    gl.uniform3fv(this.partUniforms.uCameraPosition, new Float32Array(camera.eye));
    gl.uniform3fv(this.partUniforms.uClipAxis, this.axisVector(clip.axis));
    gl.uniform1f(this.partUniforms.uClipOffset, clip.offset);
    gl.uniform1f(this.partUniforms.uClipEnabled, clip.enabled ? 1 : 0);
    gl.uniform1f(this.partUniforms.uClipDirection, clip.direction);

    this.drawGround(camera);
    gl.useProgram(this.partProgram);
    gl.uniformMatrix4fv(this.partUniforms.uViewProjection, false, camera.viewProjection);
    gl.uniform3fv(this.partUniforms.uCameraPosition, new Float32Array(camera.eye));
    gl.uniform3fv(this.partUniforms.uClipAxis, this.axisVector(clip.axis));
    gl.uniform1f(this.partUniforms.uClipOffset, clip.offset);
    gl.uniform1f(this.partUniforms.uClipEnabled, clip.enabled ? 1 : 0);
    gl.uniform1f(this.partUniforms.uClipDirection, clip.direction);

    let draws = 0;
    let triangles = 0;
    for (const part of visibleParts) {
      const gpu = this.gpuParts.get(part.id);
      if (!gpu) continue;
      const material = part.materialData;
      gl.uniform3fv(this.partUniforms.uBaseColor, new Float32Array(material.baseColor));
      gl.uniform1f(this.partUniforms.uMetallic, material.metallic);
      gl.uniform1f(this.partUniforms.uRoughness, material.roughness);
      gl.bindVertexArray(gpu.vao);
      gl.drawElements(gl.TRIANGLES, gpu.count, gl.UNSIGNED_INT, 0);
      draws += 1;
      triangles += gpu.count / 3;
    }
    gl.bindVertexArray(null);

    if (showSelection && selectedPart) this.drawSelection(selectedPart, camera);
    if (clip.enabled) this.drawClipPlane(clip, camera);
    this.stats.drawCalls = draws;
    this.stats.renderedTriangles = triangles;
    this.stats.frames += 1;
    this.stats.passes += 1;
    return { draws, triangles };
  }

  drawGround(camera) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(true);
    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(this.lineUniforms.uViewProjection, false, camera.viewProjection);
    gl.uniformMatrix4fv(this.lineUniforms.uModel, false, identity4());
    gl.uniform4fv(this.lineUniforms.uColor, new Float32Array([0.18, 0.28, 0.35, 0.28]));
    gl.bindVertexArray(this.groundGrid.vao);
    gl.drawArrays(gl.LINES, 0, this.groundGrid.count);
    gl.disable(gl.BLEND);
  }

  drawSelection(part, camera) {
    const gl = this.gl;
    const bounds = part.bounds;
    const model = multiply4(
      translation4(...bounds.center),
      scale4(bounds.size[0] + 0.06, bounds.size[1] + 0.06, bounds.size[2] + 0.06)
    );
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(this.lineUniforms.uViewProjection, false, camera.viewProjection);
    gl.uniformMatrix4fv(this.lineUniforms.uModel, false, model);
    gl.uniform4fv(this.lineUniforms.uColor, new Float32Array([0.34, 0.96, 0.88, 0.92]));
    gl.bindVertexArray(this.selectionBox.vao);
    gl.drawArrays(gl.LINES, 0, this.selectionBox.count);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  drawClipPlane(clip, camera) {
    const gl = this.gl;
    let model;
    if (clip.axis === "y") {
      model = translation4(0, clip.offset, 0);
    } else if (clip.axis === "x") {
      model = multiply4(translation4(clip.offset, 0.82, 0), rotationZ4(-Math.PI / 2));
    } else {
      model = multiply4(translation4(0, 0.82, clip.offset), rotationX4(Math.PI / 2));
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(this.lineUniforms.uViewProjection, false, camera.viewProjection);
    gl.uniformMatrix4fv(this.lineUniforms.uModel, false, model);
    gl.uniform4fv(this.lineUniforms.uColor, new Float32Array([0.36, 0.92, 0.84, 0.52]));
    gl.bindVertexArray(this.clipGrid.vao);
    gl.drawArrays(gl.LINES, 0, this.clipGrid.count);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  shaderAudit() {
    return {
      clipDiscard: PART_FRAGMENT.includes("signedDistance < 0.0") &&
        PART_FRAGMENT.includes("signedDistance > 0.0"),
      frontFacingFlip: PART_FRAGMENT.includes("if (!gl_FrontFacing) normal = -normal;"),
      cameraFacingFlip: PART_FRAGMENT.includes("if (dot(normal, viewDirection) < 0.0) normal = -normal;"),
      cullingDisabled: true
    };
  }
}
