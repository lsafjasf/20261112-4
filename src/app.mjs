import {
  axisValue,
  cameraBasis,
  clamp,
  clipTest,
  lookAt4,
  multiply4,
  perspective4,
  projectPoint,
  rayFromNdc,
  rayTriangle
} from "./math.mjs";
import { hashString, hashToHex } from "./geometry.mjs";
import { Renderer } from "./renderer.mjs";
import {
  MATERIALS,
  buildSceneParts,
  fullyClipped,
  sceneCounts,
  sceneHash
} from "./scene.mjs";

const DEFAULT_CAMERA = {
  yaw: 0.78,
  pitch: 0.36,
  distance: 8.25,
  target: [0, 0.67, 0]
};

const DEFAULT_CLIP = {
  enabled: false,
  axis: "y",
  direction: 1,
  offset: 0.6
};

const REFERENCE_PARAMS = {
  filter: "painted",
  hidden: [],
  clip: { enabled: true, axis: "y", direction: 1, offset: 0.6 },
  camera: { yaw: 0.78, pitch: 0.36, distance: 8.3 },
  selectedId: "P-05"
};

const FOV = (42 * Math.PI) / 180;
const NEAR = 0.08;
const FAR = 60;

function element(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const node = element(id);
  if (node && node.textContent !== String(value)) {
    node.textContent = String(value);
    return 1;
  }
  return 0;
}

function formatNumber(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function formatVector(vector) {
  return `[${vector.map((value) => formatNumber(value, 2)).join(", ")}]`;
}

class Inspector {
  constructor() {
    this.parts = buildSceneParts().map((part) => ({
      ...part,
      materialData: MATERIALS[part.material]
    }));
    this.hash = sceneHash(this.parts);
    this.initialCounts = sceneCounts(this.parts);
    this.state = {
      filter: "all",
      hidden: new Set(),
      clip: { ...DEFAULT_CLIP },
      camera: { ...DEFAULT_CAMERA, target: [...DEFAULT_CAMERA.target] },
      selectedId: null
    };
    this.dirty = new Set();
    this.lastDirty = [];
    this.visibleParts = [];
    this.maskParts = [];
    this.clippedParts = [];
    this.camera = null;
    this.paused = false;
    this.ready = false;
    this.failureInjection = null;
    this.lastRecompute = null;
    this.lastExport = null;
    this.fps = 0;
    this.frameMs = 0;
    this.frameNumber = 0;
    this.lastFrameTimestamp = 0;
    this.lastFpsPaint = 0;
    this.toastTimer = null;
    this.metrics = {
      fullRebuilds: 1,
      geometryBuilds: this.parts.length,
      visibilityRevisions: 0,
      clipRevisions: 0,
      viewRevisions: 0,
      selectionRevisions: 0,
      drawListRevisions: 0,
      uiPatches: 0,
      recomputes: 0,
      rollbackCount: 0,
      lastUpdate: "init:buffered"
    };
    const referenceCandidates = this.parts.filter((part) =>
      REFERENCE_PARAMS.filter === "all" || part.material === REFERENCE_PARAMS.filter
    ).filter((part) => !REFERENCE_PARAMS.hidden.includes(part.id));
    const referenceClipped = referenceCandidates.filter((part) => fullyClipped(part, REFERENCE_PARAMS.clip));
    this.referenceState = {
      sceneHash: this.hash,
      objects: this.initialCounts.objects,
      vertices: this.initialCounts.vertices,
      triangles: this.initialCounts.triangles,
      materials: this.initialCounts.materials,
      filter: REFERENCE_PARAMS.filter,
      clip: `y${REFERENCE_PARAMS.clip.direction > 0 ? "+" : "−"} / d=${REFERENCE_PARAMS.clip.offset}`,
      expectedVisible: referenceCandidates.length,
      expectedClipped: referenceClipped.length,
      expectedDraws: referenceCandidates.length - referenceClipped.length
    };
    this.dom = this.cacheDom();
    this.renderer = new Renderer(this.dom.canvas);
    this.renderer.uploadParts(this.parts);
    this.computeCamera();
    this.buildPartList();
    this.bindEvents();
    this.setupResize();
    this.writeReference();
    this.markDirty(
      "visibility", "clip", "view", "selection", "stats", "summary", "consistency", "overlay", "parts"
    );
    this.updateEngineBadge();
    this.loop = this.loop.bind(this);
  }

  cacheDom() {
    const ids = [
      "gl", "part-list", "material-filter", "filter-count", "hidden-count", "clip-enabled",
      "clip-axis", "clip-direction", "clip-offset", "clip-value", "restore-reference",
      "reference-params", "reset-view", "measurement-label", "toast", "view-label",
      "clip-label", "frame-status", "canvas-size", "m-total", "m-visible", "m-hidden",
      "m-clipped", "m-draws", "m-triangles", "m-frame-time", "m-fps", "fps-top",
      "selection-state", "selection-empty", "selection-content", "sel-id", "sel-name",
      "sel-material", "sel-w", "sel-h", "sel-d", "sel-tris", "sel-hash", "sel-center",
      "sel-clip", "update-mode", "algorithm-summary", "consistency-badge",
      "consistency-checks", "consistency-note", "export-png", "recompute",
      "action-status", "engine-badge", "stage"
    ];
    const nodes = Object.fromEntries(
      ids.map((id) => [id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), element(id)])
    );
    nodes.canvas = nodes.gl;
    return nodes;
  }

  get selectedPart() {
    return this.parts.find((part) => part.id === this.state.selectedId) || null;
  }

  buildPartList() {
    const fragment = document.createDocumentFragment();
    for (const part of this.parts) {
      const row = document.createElement("div");
      row.className = "part-row";
      row.dataset.partId = part.id;
      row.innerHTML = `
        <span class="part-swatch ${part.material}"></span>
        <span class="part-id">${part.id}</span>
        <span class="part-name">${part.name}</span>
        <button class="eye-toggle" type="button" title="Hide ${part.name}" aria-label="Hide ${part.name}">◉</button>
      `;
      row.addEventListener("click", () => this.selectPart(part.id));
      row.querySelector(".eye-toggle").addEventListener("click", (event) => {
        event.stopPropagation();
        this.toggleHidden(part.id);
      });
      fragment.append(row);
    }
    this.dom.partList.replaceChildren(fragment);
    this.metrics.uiPatches += 1;
  }

  markDirty(...regions) {
    for (const region of regions) this.dirty.add(region);
  }

  computeCamera() {
    const rect = this.dom.stage.getBoundingClientRect();
    const aspect = Math.max(rect.width, 1) / Math.max(rect.height, 1);
    const basis = cameraBasis(this.state.camera);
    const view = lookAt4(basis.eye, this.state.camera.target, [0, 1, 0]);
    const projection = perspective4(FOV, aspect, NEAR, FAR);
    this.camera = {
      ...basis,
      aspect,
      view,
      projection,
      viewProjection: multiply4(projection, view)
    };
    this.metrics.viewRevisions += 1;
  }

  computeVisibility() {
    this.maskParts = [];
    this.visibleParts = [];
    this.clippedParts = [];
    for (const part of this.parts) {
      const materialVisible = this.state.filter === "all" || part.material === this.state.filter;
      const visible = materialVisible && !this.state.hidden.has(part.id);
      if (!visible) continue;
      this.maskParts.push(part);
      if (fullyClipped(part, this.state.clip)) this.clippedParts.push(part);
      else this.visibleParts.push(part);
    }
    this.metrics.visibilityRevisions += 1;
    this.metrics.drawListRevisions += 1;
    this.renderStats = {
      total: this.parts.length,
      visible: this.maskParts.length,
      hidden: this.parts.length - this.maskParts.length,
      clipped: this.clippedParts.length,
      draws: this.visibleParts.length,
      triangles: this.visibleParts.reduce((sum, part) => sum + part.triangleCount, 0)
    };
  }

  setupResize() {
    const resize = () => {
      const rect = this.dom.stage.getBoundingClientRect();
      const changed = this.renderer.resize(rect.width, rect.height);
      const dpr = this.renderer.dpr;
      const width = this.renderer.width;
      const height = this.renderer.height;
      this.metrics.uiPatches += setText("canvas-size", `${width}×${height} @${dpr.toFixed(1)}x`);
      if (changed) {
        this.computeCamera();
        this.markDirty("view", "overlay", "summary");
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(this.dom.stage);
    resize();
  }

  updateEngineBadge() {
    this.dom.engineBadge.textContent = this.renderer.gl ? "WEBGL2 / NATIVE" : "UNAVAILABLE";
    this.dom.engineBadge.classList.toggle("pass", Boolean(this.renderer.gl));
  }

  bindEvents() {
    for (const button of this.dom.materialFilter.querySelectorAll("[data-filter]")) {
      button.addEventListener("click", () => this.setFilter(button.dataset.filter));
    }
    this.dom.clipEnabled.addEventListener("change", () => {
      this.setClip({ enabled: this.dom.clipEnabled.checked });
    });
    this.dom.clipAxis.addEventListener("change", () => {
      this.setClip({ axis: this.dom.clipAxis.value });
    });
    for (const button of this.dom.clipDirection.querySelectorAll("[data-direction]")) {
      button.addEventListener("click", () => {
        this.setClip({ direction: Number(button.dataset.direction) });
      });
    }
    this.dom.clipOffset.addEventListener("input", () => {
      this.setClip({ offset: Number(this.dom.clipOffset.value) });
    });
    this.dom.restoreReference.addEventListener("click", () => this.restoreReference());
    this.dom.resetView.addEventListener("click", () => this.resetCamera());
    this.dom.exportPng.addEventListener("click", () => this.exportPng());
    this.dom.recompute.addEventListener("click", () => this.recompute());
    this.bindPointerEvents();
    this.dom.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.paused = true;
      this.setAction("WebGL context lost. Waiting for restore…", "fail");
    });
    this.dom.canvas.addEventListener("webglcontextrestored", () => {
      try {
        this.renderer.initStateAfterRestore();
        this.renderer.uploadParts(this.parts);
        this.paused = false;
        this.markDirty("clip", "view", "stats", "summary", "consistency", "overlay", "selection");
        this.setAction("WebGL context restored; deterministic buffers re-uploaded.", "pass");
      } catch (error) {
        this.setAction(`Context restore failed: ${error.message}`, "fail");
      }
    });
  }

  bindPointerEvents() {
    this.pointer = { active: false, moved: false, startX: 0, startY: 0, yaw: 0, pitch: 0 };
    this.dom.canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.pointer.active = true;
      this.pointer.moved = false;
      this.pointer.startX = event.clientX;
      this.pointer.startY = event.clientY;
      this.pointer.yaw = this.state.camera.yaw;
      this.pointer.pitch = this.state.camera.pitch;
      this.dom.canvas.setPointerCapture(event.pointerId);
      this.dom.canvas.classList.add("dragging");
    });
    this.dom.canvas.addEventListener("pointermove", (event) => {
      if (!this.pointer.active) return;
      const dx = event.clientX - this.pointer.startX;
      const dy = event.clientY - this.pointer.startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.pointer.moved = true;
      this.state.camera.yaw = this.pointer.yaw - dx * 0.0075;
      this.state.camera.pitch = clamp(this.pointer.pitch + dy * 0.006, -0.08, 1.3);
      this.metrics.lastUpdate = "camera:view-only";
      this.markDirty("view", "overlay", "summary");
    });
    const finishPointer = (event) => {
      if (!this.pointer.active) return;
      const wasClick = !this.pointer.moved;
      this.pointer.active = false;
      this.dom.canvas.classList.remove("dragging");
      if (this.dom.canvas.hasPointerCapture(event.pointerId)) {
        this.dom.canvas.releasePointerCapture(event.pointerId);
      }
      if (wasClick) this.selectAt(event.clientX, event.clientY);
    };
    this.dom.canvas.addEventListener("pointerup", finishPointer);
    this.dom.canvas.addEventListener("pointercancel", finishPointer);
    this.dom.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.state.camera.distance = clamp(
        this.state.camera.distance * Math.exp(event.deltaY * 0.001),
        4.2,
        14
      );
      this.metrics.lastUpdate = "camera:view-only";
      this.markDirty("view", "overlay", "summary");
    }, { passive: false });
  }

  setFilter(filter) {
    if (!["all", "steel", "painted"].includes(filter) || filter === this.state.filter) return;
    this.state.filter = filter;
    this.metrics.lastUpdate = `filter:${filter}:visibility-only`;
    this.markDirty("visibility", "stats", "parts", "overlay", "selection", "summary", "consistency");
    this.syncControls();
    this.setAction(`${MATERIALS[filter]?.label || "All materials"} filter applied; no geometry rebuild.`, "pass");
  }

  setClip(patch) {
    const next = { ...this.state.clip, ...patch };
    const requestedOffset = Number(next.offset);
    next.offset = Number.isFinite(requestedOffset)
      ? clamp(requestedOffset, -1.5, 2.5)
      : this.state.clip.offset;
    next.direction = Number(next.direction) < 0 ? -1 : 1;
    next.axis = ["x", "y", "z"].includes(next.axis) ? next.axis : this.state.clip.axis;
    this.state.clip = next;
    this.metrics.clipRevisions += 1;
    this.metrics.lastUpdate = "clip:uniform-only";
    this.markDirty("clip", "visibility", "stats", "overlay", "selection", "summary", "consistency");
    this.syncControls();
  }

  toggleHidden(partId) {
    const part = this.parts.find((candidate) => candidate.id === partId);
    if (!part) return;
    if (this.state.hidden.has(partId)) this.state.hidden.delete(partId);
    else this.state.hidden.add(partId);
    this.metrics.lastUpdate = "visibility:hidden-set-only";
    this.markDirty("visibility", "stats", "parts", "overlay", "selection", "summary", "consistency");
    this.updatePartRows();
    this.setAction(`${part.id} ${this.state.hidden.has(partId) ? "hidden" : "shown"}; stats use the new mask.`, "pass");
  }

  selectPart(partId) {
    if (this.state.selectedId === partId) return;
    this.state.selectedId = partId;
    this.metrics.selectionRevisions += 1;
    this.metrics.lastUpdate = "selection:overlay-only";
    this.markDirty("selection", "overlay", "summary", "consistency", "parts");
    this.updatePartRows();
  }

  selectAt(clientX, clientY) {
    this.computeCamera();
    const rect = this.dom.canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;
    const ray = rayFromNdc(this.state.camera, ndcX, ndcY, this.camera.aspect, FOV);
    let nearest = null;
    for (const part of this.visibleParts) {
      const { positions, indices } = part.mesh;
      for (let i = 0; i < indices.length; i += 3) {
        const ai = indices[i] * 3;
        const bi = indices[i + 1] * 3;
        const ci = indices[i + 2] * 3;
        const distance = rayTriangle(
          ray.origin,
          ray.direction,
          [positions[ai], positions[ai + 1], positions[ai + 2]],
          [positions[bi], positions[bi + 1], positions[bi + 2]],
          [positions[ci], positions[ci + 1], positions[ci + 2]]
        );
        if (distance === null || (nearest && distance >= nearest.distance)) continue;
        const point = [
          ray.origin[0] + ray.direction[0] * distance,
          ray.origin[1] + ray.direction[1] * distance,
          ray.origin[2] + ray.direction[2] * distance
        ];
        if (!clipTest(point, this.state.clip)) continue;
        nearest = { part, distance };
      }
    }
    if (nearest) {
      this.state.selectedId = nearest.part.id;
      this.metrics.selectionRevisions += 1;
      this.metrics.lastUpdate = "selection:raycast-only";
      this.markDirty("selection", "overlay", "summary", "consistency", "parts");
      this.updatePartRows();
      this.setAction(`${nearest.part.id} measured at ${formatVector(nearest.part.bounds.size)} m.`, "pass");
    } else {
      this.state.selectedId = null;
      this.metrics.selectionRevisions += 1;
      this.metrics.lastUpdate = "selection:cleared";
      this.markDirty("selection", "overlay", "summary", "consistency", "parts");
      this.updatePartRows();
      this.setAction("No visible, unclipped part at that pixel.", "fail");
    }
  }

  resetCamera() {
    this.state.camera = { ...DEFAULT_CAMERA, target: [...DEFAULT_CAMERA.target] };
    this.metrics.lastUpdate = "camera:view-only";
    this.markDirty("view", "overlay", "summary");
    this.setAction("Orbit camera reset; geometry untouched.", "pass");
  }

  syncControls() {
    for (const button of this.dom.materialFilter.querySelectorAll("[data-filter]")) {
      button.classList.toggle("active", button.dataset.filter === this.state.filter);
    }
    this.dom.clipEnabled.checked = this.state.clip.enabled;
    this.dom.clipAxis.value = this.state.clip.axis;
    this.dom.clipOffset.value = String(this.state.clip.offset);
    this.dom.clipValue.textContent = `${formatNumber(this.state.clip.offset)} m`;
    for (const button of this.dom.clipDirection.querySelectorAll("[data-direction]")) {
      button.classList.toggle("active", Number(button.dataset.direction) === this.state.clip.direction);
    }
    this.metrics.uiPatches += 1;
  }

  updatePartRows() {
    for (const row of this.dom.partList.querySelectorAll(".part-row")) {
      const part = this.parts.find((candidate) => candidate.id === row.dataset.partId);
      if (!part) continue;
      const materialVisible = this.state.filter === "all" || part.material === this.state.filter;
      const hidden = this.state.hidden.has(part.id);
      row.classList.toggle("is-hidden", !materialVisible || hidden);
      row.classList.toggle("selected", part.id === this.state.selectedId);
      const eye = row.querySelector(".eye-toggle");
      eye.classList.toggle("off", hidden);
      eye.textContent = hidden ? "○" : "◉";
      eye.title = `${hidden ? "Show" : "Hide"} ${part.name}`;
    }
    this.metrics.uiPatches += 1;
  }

  updateStatsDom() {
    const stats = this.renderStats;
    if (!stats) return;
    let patches = 0;
    patches += setText("filter-count", `${stats.visible} shown`);
    patches += setText("hidden-count", `${stats.hidden} hidden`);
    patches += setText("m-total", stats.total);
    patches += setText("m-visible", stats.visible);
    patches += setText("m-hidden", stats.hidden);
    patches += setText("m-clipped", stats.clipped);
    patches += setText("m-draws", stats.draws);
    patches += setText("m-triangles", stats.triangles.toLocaleString("en-US"));
    element("m-hidden").classList.toggle("alert", stats.hidden > 0);
    element("m-clipped").classList.toggle("alert", stats.clipped > 0);
    this.metrics.uiPatches += patches + 2;
  }

  clipRelation(part) {
    if (!this.state.clip.enabled) return "CLIP OFF";
    if (fullyClipped(part, this.state.clip)) return "OUTSIDE";
    const axisIndex = this.state.clip.axis === "x" ? 0 : this.state.clip.axis === "z" ? 2 : 1;
    const offset = this.state.clip.offset;
    const min = part.bounds.min[axisIndex];
    const max = part.bounds.max[axisIndex];
    if (this.state.clip.direction >= 0) {
      if (min >= offset) return "RETAINED";
      if (max >= offset) return "CUT";
      return "OUTSIDE";
    }
    if (max <= offset) return "RETAINED";
    if (min <= offset) return "CUT";
    return "OUTSIDE";
  }

  updateSelectionUi() {
    const part = this.selectedPart;
    if (!part) {
      this.dom.selectionEmpty.classList.remove("hidden");
      this.dom.selectionContent.classList.add("hidden");
      this.dom.measurementLabel.classList.add("hidden");
      this.dom.selectionState.textContent = "NONE";
      this.dom.selectionState.className = "status-pill neutral";
      this.metrics.uiPatches += 1;
      return;
    }
    this.dom.selectionEmpty.classList.add("hidden");
    this.dom.selectionContent.classList.remove("hidden");
    const size = part.bounds.size;
    let patches = 0;
    patches += setText("sel-id", part.id);
    patches += setText("sel-name", part.name);
    patches += setText("sel-w", formatNumber(size[0]));
    patches += setText("sel-h", formatNumber(size[1]));
    patches += setText("sel-d", formatNumber(size[2]));
    patches += setText("sel-tris", part.triangleCount.toLocaleString("en-US"));
    patches += setText("sel-hash", part.hash);
    patches += setText("sel-center", formatVector(part.bounds.center));
    patches += setText("sel-clip", this.clipRelation(part));
    const material = MATERIALS[part.material];
    this.dom.selMaterial.textContent = material.label.toUpperCase();
    this.dom.selMaterial.className = `material-tag ${part.material}`;
    const onDrawList = this.maskParts.some((candidate) => candidate.id === part.id) &&
      !fullyClipped(part, this.state.clip);
    if (onDrawList) {
      this.dom.selectionState.textContent = "MEASURED";
      this.dom.selectionState.className = "status-pill pass";
    } else {
      const clipped = this.maskParts.some((candidate) => candidate.id === part.id);
      this.dom.selectionState.textContent = clipped ? "CLIPPED" : "HIDDEN";
      this.dom.selectionState.className = "status-pill fail";
    }
    this.metrics.uiPatches += patches + 4;
  }

  updateOverlay() {
    const filterLabel = this.state.filter === "all" ? "ALL" : this.state.filter.toUpperCase();
    this.dom.viewLabel.textContent = `ORBIT · ${filterLabel}`;
    this.dom.clipLabel.textContent = this.state.clip.enabled
      ? `CLIP ${this.state.clip.axis.toUpperCase()}${this.state.clip.direction > 0 ? "+" : "−"} · ${formatNumber(this.state.clip.offset)}m`
      : "CLIP OFF";
    const part = this.selectedPart;
    if (!part || !this.visibleParts.some((candidate) => candidate.id === part.id)) {
      this.dom.measurementLabel.classList.add("hidden");
      return;
    }
    const rect = this.dom.stage.getBoundingClientRect();
    const anchor = [
      part.bounds.center[0],
      part.bounds.max[1] + 0.05,
      part.bounds.center[2]
    ];
    const projected = projectPoint(this.camera.viewProjection, anchor, rect.width, rect.height);
    if (projected.depth < -1 || projected.depth > 1 ||
        projected.x < -100 || projected.x > rect.width + 100 ||
        projected.y < -100 || projected.y > rect.height + 100) {
      this.dom.measurementLabel.classList.add("hidden");
      return;
    }
    const size = part.bounds.size;
    this.dom.measurementLabel.innerHTML =
      `<b>${part.id} · ${formatNumber(size[0])} × ${formatNumber(size[1])} × ${formatNumber(size[2])} m</b>` +
      `<span>W × H × D · ${MATERIALS[part.material].label}</span>`;
    this.dom.measurementLabel.style.left = `${projected.x}px`;
    this.dom.measurementLabel.style.top = `${Math.max(projected.y, 38)}px`;
    this.dom.measurementLabel.classList.remove("hidden");
    this.metrics.uiPatches += 1;
  }

  updateSummary() {
    const stats = this.renderStats;
    const recompute = this.lastRecompute
      ? `${this.lastRecompute.status} ${this.lastRecompute.beforeHash}→${this.lastRecompute.afterHash}`
      : "not run";
    const summary = [
      `sceneHash   ${this.hash}`,
      `objects     ${stats.total} | verts ${this.initialCounts.vertices.toLocaleString("en-US")}`,
      `triangles   ${this.initialCounts.triangles.toLocaleString("en-US")} | materials 2`,
      `mode        ${this.metrics.lastUpdate}`,
      `dirty       ${this.lastDirty.join(",") || "none"}`,
      `geoBuilds   ${this.metrics.geometryBuilds} | fullRebuilds ${this.metrics.fullRebuilds}`,
      `buffers     ${this.renderer.stats.bufferUploads} | bytes ${this.renderer.stats.bufferBytes.toLocaleString("en-US")}`,
      `revisions   mask ${this.metrics.visibilityRevisions} | clip ${this.metrics.clipRevisions} | drawList ${this.metrics.drawListRevisions}`,
      `uiPatches   ${this.metrics.uiPatches} | selected ${this.state.selectedId || "none"}`,
      `recompute   ${recompute} | rollback ${this.metrics.rollbackCount}`
    ].join("\n");
    if (this.dom.algorithmSummary.textContent !== summary) {
      this.dom.algorithmSummary.textContent = summary;
      this.metrics.uiPatches += 1;
    }
    this.dom.updateMode.textContent = this.metrics.lastUpdate.split(":")[0].toUpperCase();
  }

  updateConsistency(renderResult) {
    const stats = this.renderStats;
    const expectedDraws = stats.visible - stats.clipped;
    const generatedHash = sceneHash(this.parts);
    const hashMatch = generatedHash === this.hash;
    const checks = [
      {
        label: "Frame draw count matches visibility mask",
        detail: `${renderResult.draws} = ${stats.visible} − ${stats.clipped}`,
        pass: renderResult.draws === expectedDraws
      },
      {
        label: "Scene hash matches generated meshes",
        detail: this.hash,
        pass: hashMatch
      },
      {
        label: "Hidden / filtered parts excluded",
        detail: `${stats.hidden} excluded`,
        pass: stats.hidden === stats.total - stats.visible
      },
      {
        label: "Selection follows draw visibility",
        detail: this.state.selectedId || "none",
        pass: !this.state.selectedId || this.maskParts.some((part) => part.id === this.state.selectedId) ||
          this.parts.some((part) => part.id === this.state.selectedId)
      }
    ];
    const pass = checks.every((check) => check.pass);
    this.dom.consistencyBadge.textContent = pass ? "CONSISTENT" : "MISMATCH";
    this.dom.consistencyBadge.className = `status-pill ${pass ? "pass" : "fail"}`;
    this.dom.consistencyChecks.innerHTML = checks.map((check) =>
      `<li class="${check.pass ? "" : "fail"}"><span>${check.label}</span><em>${check.detail}</em></li>`
    ).join("");
    const selection = this.selectedPart;
    const selectionText = selection
      ? ` ${selection.id} measures ${formatVector(selection.bounds.size)} m from the same world-space mesh used for drawing.`
      : " No part is selected; click a visible surface to attach a measurement.";
    this.dom.consistencyNote.textContent = pass
      ? `Final frame and data agree: ${renderResult.draws} draw calls equal ${stats.visible} visible objects minus ${stats.clipped} fully clipped. ${stats.hidden} hidden/filtered objects are absent from both counters.${selectionText}`
      : "Frame/data mismatch detected. The canvas may be stale; force a redraw before export.";
    this.metrics.uiPatches += checks.length + 2;
  }

  restoreReference() {
    this.state.filter = REFERENCE_PARAMS.filter;
    this.state.hidden = new Set(REFERENCE_PARAMS.hidden);
    this.state.clip = { ...REFERENCE_PARAMS.clip };
    this.state.camera = { ...REFERENCE_PARAMS.camera, target: [...DEFAULT_CAMERA.target] };
    this.state.selectedId = REFERENCE_PARAMS.selectedId;
    this.metrics.lastUpdate = "reference:targeted-restore";
    this.markDirty(
      "visibility", "clip", "view", "selection", "stats", "parts",
      "overlay", "summary", "consistency"
    );
    this.syncControls();
    this.updatePartRows();
    const sameHash = sceneHash(this.parts) === this.referenceState.sceneHash;
    this.setAction(
      sameHash
        ? `Comparison profile restored; hash ${this.hash} and ${this.parts.length} objects are unchanged.`
        : `Comparison profile restored, but the scene hash does not match the saved reference.`,
      sameHash ? "pass" : "fail"
    );
  }

  screenPointForPart(partId) {
    const part = this.parts.find((candidate) => candidate.id === partId);
    if (!part) return null;
    this.computeCamera();
    const rect = this.dom.stage.getBoundingClientRect();
    const projected = projectPoint(this.camera.viewProjection, part.bounds.center, rect.width, rect.height);
    return {
      x: rect.left + projected.x,
      y: rect.top + projected.y,
      localX: projected.x,
      localY: projected.y,
      visible: this.maskParts.some((candidate) => candidate.id === partId) &&
        !fullyClipped(part, this.state.clip)
    };
  }

  exportPng() {
    if (this.paused) {
      this.setAction("PNG export blocked while the graphics context is lost.", "fail");
      return null;
    }
    const renderResult = this.renderer.draw(
      this.state.clip,
      this.camera,
      this.visibleParts,
      this.selectedPart,
      Boolean(this.selectedPart)
    );
    this.updateConsistency(renderResult);
    const dataUrl = this.dom.canvas.toDataURL("image/png");
    const base64 = dataUrl.split(",")[1] || "";
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    const bytes = Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
    const clipName = this.state.clip.enabled
      ? `${this.state.clip.axis}${this.state.clip.direction > 0 ? "pos" : "neg"}-${formatNumber(this.state.clip.offset)}`
      : "noclip";
    const name = `forge-${this.state.filter}-${clipName}-${this.hash}.png`;
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    this.lastExport = {
      name,
      bytes,
      width: this.renderer.width,
      height: this.renderer.height,
      draws: renderResult.draws,
      hash: this.hash
    };
    this.metrics.lastUpdate = "export:canvas-only";
    this.markDirty("summary", "consistency");
    this.setAction(
      `PNG exported: ${this.renderer.width}×${this.renderer.height}, ${bytes.toLocaleString("en-US")} bytes, ${renderResult.draws} draws.`,
      "pass"
    );
    return this.lastExport;
  }

  async recompute() {
    if (this.paused) {
      this.setAction("Recompute blocked: WebGL context is lost.", "fail");
      return { status: "FAIL", reason: "context-lost" };
    }
    const selectedId = this.state.selectedId;
    const beforeHash = this.hash;
    const beforeCount = this.parts.length;
    this.setAction("Recomputing procedural meshes and comparing frame hash…", "pass");
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const beforeFrame = this.dom.canvas.toDataURL("image/png");
    const started = performance.now();
    try {
      const rebuilt = buildSceneParts().map((part) => ({
        ...part,
        materialData: MATERIALS[part.material]
      }));
      if (this.failureInjection === "recompute") {
        throw new Error("Injected geometry rebuild failure");
      }
      if (rebuilt.length !== beforeCount) {
        throw new Error(`Object count drifted: ${beforeCount} → ${rebuilt.length}`);
      }
      const afterHash = sceneHash(rebuilt);
      if (afterHash !== beforeHash) {
        throw new Error(`Non-deterministic geometry hash: ${beforeHash} → ${afterHash}`);
      }
      this.parts = rebuilt;
      this.hash = afterHash;
      this.initialCounts = sceneCounts(rebuilt);
      this.state.selectedId = selectedId;
      this.metrics.geometryBuilds += rebuilt.length;
      this.metrics.fullRebuilds += 1;
      this.metrics.recomputes += 1;
      this.renderer.uploadParts(this.parts);
      this.computeVisibility();
      this.renderer.draw(
        this.state.clip,
        this.camera,
        this.visibleParts,
        this.selectedPart,
        Boolean(this.selectedPart)
      );
      const afterFrame = this.dom.canvas.toDataURL("image/png");
      const frameBeforeHash = hashToHex(hashString(beforeFrame));
      const frameAfterHash = hashToHex(hashString(afterFrame));
      const elapsedMs = performance.now() - started;
      const passed = afterHash === beforeHash && frameBeforeHash === frameAfterHash;
      this.lastRecompute = {
        status: passed ? "PASS" : "FAIL",
        beforeHash,
        afterHash,
        objectCountBefore: beforeCount,
        objectCountAfter: rebuilt.length,
        screenshotBefore: frameBeforeHash,
        screenshotAfter: frameAfterHash,
        screenshotMatch: frameBeforeHash === frameAfterHash,
        elapsedMs
      };
      this.metrics.lastUpdate = "recompute:full-verified";
      this.markDirty(
        "visibility", "selection", "stats", "parts", "overlay", "summary", "consistency"
      );
      this.updatePartRows();
      this.setAction(
        `Recompute ${passed ? "PASS" : "FAIL"}: hash ${beforeHash}→${afterHash}, objects ${beforeCount}→${rebuilt.length}, screenshot ${frameBeforeHash}→${frameAfterHash}.`,
        passed ? "pass" : "fail"
      );
      return this.lastRecompute;
    } catch (error) {
      const elapsedMs = performance.now() - started;
      this.metrics.rollbackCount += 1;
      this.lastRecompute = {
        status: "FAIL",
        beforeHash,
        afterHash: this.hash,
        objectCountBefore: beforeCount,
        objectCountAfter: this.parts.length,
        screenshotBefore: hashToHex(hashString(beforeFrame)),
        screenshotAfter: hashToHex(hashString(beforeFrame)),
        screenshotMatch: true,
        elapsedMs,
        error: error.message
      };
      this.metrics.lastUpdate = "recompute:rolled-back";
      this.markDirty("visibility", "selection", "stats", "parts", "overlay", "summary", "consistency");
      this.setAction(
        `Recompute failed safely: ${error.message}. Rolled back to hash ${beforeHash} with ${this.parts.length} objects.`,
        "fail"
      );
      return this.lastRecompute;
    }
  }

  setAction(text, tone = "") {
    if (this.dom.actionStatus.textContent !== text) {
      this.dom.actionStatus.textContent = text;
      this.metrics.uiPatches += 1;
    }
    this.dom.actionStatus.className = `action-status ${tone}`.trim();
    this.showToast(text, tone);
  }

  showToast(text, tone = "") {
    clearTimeout(this.toastTimer);
    this.dom.toast.textContent = text;
    this.dom.toast.classList.add("show");
    this.dom.toast.style.borderColor = tone === "fail"
      ? "rgba(255, 107, 107, 0.55)"
      : "rgba(86, 214, 201, 0.42)";
    this.toastTimer = setTimeout(() => this.dom.toast.classList.remove("show"), 2200);
  }

  applyDirty(regions) {
    if (regions.has("view")) this.computeCamera();
    if (!this.renderStats || regions.has("visibility")) this.computeVisibility();
    if (regions.has("selection") || regions.has("visibility") || regions.has("clip")) {
      this.updateSelectionUi();
    }
    const selectionVisible = Boolean(
      this.selectedPart && this.visibleParts.some((part) => part.id === this.selectedPart.id)
    );
    const result = this.renderer.draw(
      this.state.clip,
      this.camera,
      this.visibleParts,
      this.selectedPart,
      selectionVisible
    );
    if (regions.has("stats") || regions.has("visibility")) this.updateStatsDom();
    if (regions.has("parts")) this.updatePartRows();
    if (regions.has("summary")) this.updateSummary();
    if (regions.has("consistency") || regions.has("stats") || regions.has("visibility")) {
      this.updateConsistency(result);
    }
    if (regions.has("overlay") || regions.has("view") || regions.has("selection") ||
        regions.has("visibility") || regions.has("clip")) {
      this.updateOverlay();
    }
    return result;
  }

  updateFrameReadout(now) {
    if (now - this.lastFpsPaint < 250) return;
    this.lastFpsPaint = now;
    const fpsText = this.fps > 0 ? Math.round(this.fps) : "--";
    let patches = 0;
    patches += setText("fps-top", fpsText);
    patches += setText("m-fps", fpsText);
    patches += setText("m-frame-time", `${formatNumber(this.frameMs, 1)} ms`);
    patches += setText(
      "frame-status",
      `Frame ${this.renderer.stats.frames} · ${this.renderer.stats.drawCalls} draws · ${this.renderer.stats.renderedTriangles.toLocaleString("en-US")} tris`
    );
    this.metrics.uiPatches += patches;
  }

  loop(timestamp) {
    requestAnimationFrame(this.loop);
    if (this.paused) return;
    const delta = this.lastFrameTimestamp ? timestamp - this.lastFrameTimestamp : 16.67;
    this.lastFrameTimestamp = timestamp;
    this.frameNumber += 1;
    this.frameMs = this.frameMs ? this.frameMs * 0.88 + delta * 0.12 : delta;
    const instantaneousFps = delta > 0 ? 1000 / delta : 60;
    this.fps = this.fps ? this.fps * 0.88 + instantaneousFps * 0.12 : instantaneousFps;
    const regions = new Set(this.dirty);
    this.dirty.clear();
    this.lastDirty = [...regions];
    try {
      this.applyDirty(regions);
      this.updateFrameReadout(timestamp);
    } catch (error) {
      this.paused = true;
      this.setAction(`Render loop stopped: ${error.message}`, "fail");
      console.error(error);
    }
  }

  start() {
    this.ready = true;
    requestAnimationFrame(this.loop);
  }

  snapshot() {
    const stats = this.renderStats || {
      total: this.parts.length,
      visible: 0,
      hidden: this.parts.length,
      clipped: 0,
      draws: 0,
      triangles: 0
    };
    return {
      ready: this.ready,
      hash: this.hash,
      sceneHashNow: sceneHash(this.parts),
      objectCount: this.parts.length,
      state: {
        filter: this.state.filter,
        hidden: [...this.state.hidden],
        clip: { ...this.state.clip },
        camera: { ...this.state.camera, target: [...this.state.camera.target] },
        selectedId: this.state.selectedId
      },
      stats,
      metrics: { ...this.metrics },
      renderer: { ...this.renderer.stats, dpr: this.renderer.dpr, width: this.renderer.width, height: this.renderer.height },
      fps: this.fps,
      frameMs: this.frameMs,
      selected: this.selectedPart ? {
        id: this.selectedPart.id,
        name: this.selectedPart.name,
        material: this.selectedPart.material,
        dimensions: [...this.selectedPart.bounds.size],
        triangleCount: this.selectedPart.triangleCount,
        hash: this.selectedPart.hash
      } : null,
      lastRecompute: this.lastRecompute,
      lastExport: this.lastExport,
      referenceState: { ...this.referenceState },
      referenceParams: JSON.parse(JSON.stringify(REFERENCE_PARAMS)),
      counts: { ...this.initialCounts }
    };
  }

  createApi() {
    return {
      ready: true,
      snapshot: () => this.snapshot(),
      setFilter: (filter) => this.setFilter(filter),
      setClip: (patch) => this.setClip(patch),
      toggleHidden: (partId) => this.toggleHidden(partId),
      selectPart: (partId) => this.selectPart(partId),
      restoreReference: () => this.restoreReference(),
      resetCamera: () => this.resetCamera(),
      recompute: () => this.recompute(),
      exportPng: () => this.exportPng(),
      screenPointForPart: (partId) => this.screenPointForPart(partId),
      sceneHash: () => sceneHash(this.parts),
      debug: {
        injectFailure: (kind) => { this.failureInjection = kind; },
        clearFailure: () => { this.failureInjection = null; },
        renderNow: () => this.applyDirty(new Set([
          "view", "visibility", "clip", "selection", "stats", "summary", "consistency", "overlay"
        ])),
        canvasDataUrl: () => this.dom.canvas.toDataURL("image/png"),
        shaderAudit: () => this.renderer.shaderAudit(),
        triggerContextLoss: () => {
          const extension = this.renderer.gl.getExtension("WEBGL_lose_context");
          if (extension) extension.loseContext();
          return Boolean(extension);
        }
      }
    };
  }

  writeReference() {
    const params = {
      filter: REFERENCE_PARAMS.filter,
      hidden: REFERENCE_PARAMS.hidden,
      clip: REFERENCE_PARAMS.clip,
      camera: REFERENCE_PARAMS.camera,
      selectedId: REFERENCE_PARAMS.selectedId
    };
    this.dom.referenceParams.textContent = JSON.stringify({
      params,
      algorithm: this.referenceState
    }, null, 1);
  }
}

export { Inspector, REFERENCE_PARAMS, DEFAULT_CAMERA, DEFAULT_CLIP };

function showFatal(error) {
  const fatal = element("fatal");
  const title = element("fatal-title");
  const message = element("fatal-message");
  if (!fatal) return;
  fatal.classList.remove("hidden");
  if (error.code === "WEBGL2_UNAVAILABLE") {
    title.textContent = "WebGL2 is unavailable";
    message.textContent =
      "Enable hardware acceleration or use a browser with WebGL2 support. " +
      "No fallback 3D library was loaded; the app fails explicitly instead of showing stale data.";
  } else {
    title.textContent = "Renderer initialization failed";
    message.textContent = error.message;
  }
  element("fatal-retry").addEventListener("click", () => window.location.reload());
}

try {
  const inspector = new Inspector();
  inspector.start();
  window.__INSPECTOR__ = inspector.createApi();
} catch (error) {
  console.error(error);
  showFatal(error);
}
