import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const OUT = join(ROOT, "artifacts", "verification");
const report = {
  startedAt: new Date().toISOString(),
  scenario: {},
  assertions: [],
  screenshots: {},
  browser: {}
};

function check(condition, label, detail = "") {
  const pass = Boolean(condition);
  report.assertions.push({ label, pass, detail: String(detail) });
  if (!pass) throw new Error(`${label}${detail ? ` — ${detail}` : ""}`);
}

function readSnapshot(page) {
  return page.evaluate(() => window.__INSPECTOR__.snapshot());
}

async function settle(page, duration = 180) {
  await page.waitForTimeout(duration);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function canvasPng(page) {
  const dataUrl = await page.evaluate(() => window.__INSPECTOR__.debug.canvasDataUrl());
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

async function saveCanvas(page, name) {
  const buffer = await canvasPng(page);
  const path = join(OUT, name);
  await writeFile(path, buffer);
  report.screenshots[name] = { bytes: buffer.length, sha256: sha256(buffer) };
  return { path, buffer, hash: sha256(buffer) };
}

async function savePage(page, name) {
  const path = join(OUT, name);
  const buffer = await page.screenshot({ fullPage: true });
  await writeFile(path, buffer);
  report.screenshots[name] = { bytes: buffer.length, sha256: sha256(buffer) };
  return path;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return { child, url, port };
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error("Local test server did not start");
}

function browserExecutable() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    "/home/hj/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome",
    "/home/hj/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
    "/home/hj/.cache/ms-playwright/chromium-1187/chrome-linux/chrome"
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

async function newInspectorPage(browser, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 920 },
    deviceScaleFactor: 1,
    acceptDownloads: true
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  if (options.initScript) await page.addInitScript(options.initScript);
  await page.goto(options.url, { waitUntil: "networkidle" });
  return { context, page, errors };
}

async function openInspector(browser, url) {
  const result = await newInspectorPage(browser, { url });
  await result.page.waitForFunction(() => window.__INSPECTOR__?.ready, null, { timeout: 10000 });
  await settle(result.page, 500);
  return result;
}

async function normalScenario(browser, url) {
  const { context, page, errors } = await openInspector(browser, url);
  const scenario = { checks: [], screenshots: {}, noRebuildCounters: {} };
  report.scenario.normal = scenario;
  const initial = await readSnapshot(page);
  const uploadBaseline = initial.renderer.bufferUploads;
  const buildBaseline = initial.metrics.geometryBuilds;
  const rebuildBaseline = initial.metrics.fullRebuilds;
  scenario.initial = {
    hash: initial.hash,
    objects: initial.objectCount,
    stats: initial.stats,
    counts: initial.counts
  };

  check(initial.objectCount === 6, "Normal: six procedural parts load", initial.objectCount);
  check(initial.stats.total === 6 && initial.stats.visible === 6, "Normal: initial visibility mask is complete", JSON.stringify(initial.stats));
  check(initial.hash === initial.sceneHashNow, "Normal: scene hash matches generated meshes", initial.hash);
  check(initial.counts.materials === 2, "Normal: two material families exist", initial.counts.materials);
  check(initial.counts.triangles >= 3000, "Normal: procedural mesh has measurable complexity", initial.counts.triangles);

  await page.waitForFunction(() => window.__INSPECTOR__.snapshot().fps > 0, null, { timeout: 5000 });
  const fpsSnapshot = await readSnapshot(page);
  const fpsText = await page.locator("#fps-top").innerText();
  check(fpsSnapshot.fps > 0 && Number(fpsText) > 0, "Normal: FPS display is live", `${fpsText} / ${fpsSnapshot.fps.toFixed(1)}`);
  check(fpsSnapshot.frameMs > 0, "Normal: frame time is measured", fpsSnapshot.frameMs.toFixed(2));

  const audit = await page.evaluate(() => window.__INSPECTOR__.debug.shaderAudit());
  check(audit.frontFacingFlip && audit.cameraFacingFlip && audit.clipDiscard,
    "Normal: two-sided clip shader audit passes", JSON.stringify(audit));

  const beforeOrbit = await readSnapshot(page);
  const stageRect = await page.locator("#stage").boundingBox();
  await page.mouse.move(stageRect.x + stageRect.width * 0.5, stageRect.y + stageRect.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(stageRect.x + stageRect.width * 0.59, stageRect.y + stageRect.height * 0.61, { steps: 8 });
  await page.mouse.up();
  await page.mouse.wheel(0, -180);
  await settle(page);
  const afterOrbit = await readSnapshot(page);
  check(afterOrbit.metrics.viewRevisions > beforeOrbit.metrics.viewRevisions,
    "Normal: orbit and wheel zoom update the camera", `${beforeOrbit.metrics.viewRevisions}→${afterOrbit.metrics.viewRevisions}`);
  check(afterOrbit.metrics.geometryBuilds === buildBaseline && afterOrbit.renderer.bufferUploads === uploadBaseline,
    "Normal: camera changes never rebuild geometry or buffers", `${afterOrbit.metrics.geometryBuilds}/${afterOrbit.renderer.bufferUploads}`);

  await page.click("#reset-view");
  await settle(page);
  const point = await page.evaluate(() => window.__INSPECTOR__.screenPointForPart("P-04"));
  await page.mouse.click(point.x, point.y);
  await settle(page);
  const selected = await readSnapshot(page);
  check(selected.selected?.id === "P-04", "Normal: real canvas click selects and measures a part", selected.selected?.id);
  check(selected.selected.dimensions.every((value) => value > 0), "Normal: selected part exposes positive W/H/D", JSON.stringify(selected.selected.dimensions));
  const measureLabel = await page.locator("#measurement-label").innerText();
  check(measureLabel.includes("P-04") && measureLabel.includes("2.04"), "Normal: dimensions appear directly on the page", measureLabel.replace(/\n/g, " / "));
  scenario.screenshots.selected = await savePage(page, "01-normal-selected.png");

  await page.click('[data-filter="painted"]');
  await settle(page);
  const filtered = await readSnapshot(page);
  check(filtered.stats.visible === 3 && filtered.stats.hidden === 3 && filtered.stats.draws === 3,
    "Normal: painted-only filter hides steel and reduces visible stats", JSON.stringify(filtered.stats));
  check(filtered.hash === initial.hash, "Normal: filter leaves mesh hash unchanged", filtered.hash);
  check(filtered.metrics.geometryBuilds === buildBaseline && filtered.metrics.fullRebuilds === rebuildBaseline &&
    filtered.renderer.bufferUploads === uploadBaseline,
  "Normal: filter performs no geometry rebuild or upload",
  `${filtered.metrics.geometryBuilds}/${filtered.metrics.fullRebuilds}/${filtered.renderer.bufferUploads}`);
  const filterText = await page.locator("#filter-count").innerText();
  check(filterText === "3 shown", "Normal: filter count reflects only visible parts", filterText);
  scenario.screenshots.filtered = await savePage(page, "02-filter-painted.png");

  await page.evaluate(() => window.__INSPECTOR__.toggleHidden("P-05"));
  await settle(page);
  const oneHidden = await readSnapshot(page);
  check(oneHidden.stats.visible === 2 && oneHidden.stats.hidden === 4 && oneHidden.stats.draws === 2,
    "Normal: individually hidden part leaves visible statistics", JSON.stringify(oneHidden.stats));
  await page.evaluate(() => window.__INSPECTOR__.toggleHidden("P-05"));
  await settle(page);

  await page.click(".switch");
  await page.selectOption("#clip-axis", "y");
  await page.click('#clip-direction [data-direction="1"]');
  await page.evaluate(() => {
    const slider = document.getElementById("clip-offset");
    slider.value = "0.6";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(page);
  const clippedPositive = await readSnapshot(page);
  check(clippedPositive.state.clip.enabled && clippedPositive.state.clip.direction === 1 &&
    Math.abs(clippedPositive.state.clip.offset - 0.6) < 1e-6,
  "Normal: clip controls set enabled Y+ plane at d=0.60", JSON.stringify(clippedPositive.state.clip));
  check(clippedPositive.stats.visible === 3 && clippedPositive.stats.clipped === 1 && clippedPositive.stats.draws === 2,
    "Normal: positive clip excludes the fully clipped flange", JSON.stringify(clippedPositive.stats));
  check(clippedPositive.hash === initial.hash && clippedPositive.metrics.geometryBuilds === buildBaseline,
    "Normal: clip changes only uniforms, not geometry", `${clippedPositive.hash}/${clippedPositive.metrics.geometryBuilds}`);
  scenario.screenshots.clipPositive = await savePage(page, "03-clip-y-positive.png");

  await page.click('#clip-direction [data-direction="-1"]');
  await settle(page);
  const clippedNegative = await readSnapshot(page);
  check(clippedNegative.state.clip.direction === -1, "Normal: clip direction switch is active", clippedNegative.state.clip.direction);
  check(clippedNegative.hash === initial.hash && clippedNegative.metrics.geometryBuilds === buildBaseline &&
    clippedNegative.renderer.bufferUploads === uploadBaseline,
  "Normal: reverse clip keeps geometry and buffers stable", `${clippedNegative.hash}/${clippedNegative.renderer.bufferUploads}`);
  scenario.screenshots.clipNegative = await savePage(page, "04-clip-y-negative.png");

  await page.click("#restore-reference");
  await settle(page);
  const restored = await readSnapshot(page);
  check(restored.state.filter === "painted" && restored.state.clip.enabled &&
    restored.state.clip.direction === 1 && Math.abs(restored.state.clip.offset - 0.6) < 1e-6,
  "Normal: one-click reference restore applies comparison parameters", JSON.stringify(restored.state));
  check(restored.stats.visible === restored.referenceState.expectedVisible &&
    restored.stats.clipped === restored.referenceState.expectedClipped &&
    restored.stats.draws === restored.referenceState.expectedDraws,
  "Normal: restored stats match saved algorithm summary", JSON.stringify({
    actual: restored.stats,
    expected: restored.referenceState
  }));
  check(restored.hash === initial.hash && restored.metrics.geometryBuilds === buildBaseline,
    "Normal: reference restore does not rebuild the scene", `${restored.hash}/${restored.metrics.geometryBuilds}`);
  scenario.screenshots.reference = await savePage(page, "05-reference-restored.png");

  const downloadPromise = page.waitForEvent("download");
  await page.click("#export-png");
  const download = await downloadPromise;
  const exportPath = join(OUT, "06-export-current-view.png");
  await download.saveAs(exportPath);
  const exported = await readSnapshot(page);
  const png = await import("node:fs").then((fs) => fs.readFileSync(exportPath));
  check(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "Normal: current view exports a valid PNG", download.suggestedFilename());
  check(png.length === exported.lastExport.bytes && exported.lastExport.draws === restored.stats.draws,
    "Normal: exported PNG bytes and draw count match the live report",
    `${png.length}/${exported.lastExport.bytes} · ${exported.lastExport.draws}`);
  report.screenshots["06-export-current-view.png"] = { bytes: png.length, sha256: sha256(png) };

  const beforeRecompute = await readSnapshot(page);
  const beforeShot = await saveCanvas(page, "07-recompute-before.png");
  await page.click("#recompute");
  await page.waitForFunction(() => {
    const recompute = window.__INSPECTOR__.snapshot().lastRecompute;
    return recompute && recompute.status === "PASS";
  }, null, { timeout: 10000 });
  await settle(page);
  const afterRecompute = await readSnapshot(page);
  const afterShot = await saveCanvas(page, "08-recompute-after.png");
  check(afterRecompute.lastRecompute.status === "PASS", "Normal: deterministic recompute passes", JSON.stringify(afterRecompute.lastRecompute));
  check(beforeRecompute.hash === afterRecompute.hash, "Normal: scene hash survives recompute",
    `${beforeRecompute.hash}→${afterRecompute.hash}`);
  check(beforeRecompute.objectCount === afterRecompute.objectCount, "Normal: object count survives recompute",
    `${beforeRecompute.objectCount}→${afterRecompute.objectCount}`);
  check(beforeShot.hash === afterShot.hash, "Normal: screenshots are pixel-identical before/after recompute",
    `${beforeShot.hash}→${afterShot.hash}`);
  check(afterRecompute.lastRecompute.screenshotBefore === afterRecompute.lastRecompute.screenshotAfter,
    "Normal: in-page screenshot hashes match", afterRecompute.lastRecompute.screenshotMatch);
  check(afterRecompute.metrics.geometryBuilds > beforeRecompute.metrics.geometryBuilds &&
    afterRecompute.metrics.fullRebuilds > beforeRecompute.metrics.fullRebuilds,
  "Normal: recompute is the only path that rebuilds geometry",
  `${beforeRecompute.metrics.geometryBuilds}→${afterRecompute.metrics.geometryBuilds}`);
  report.scenario.normal.recompute = {
    beforeHash: beforeRecompute.hash,
    afterHash: afterRecompute.hash,
    objectCountBefore: beforeRecompute.objectCount,
    objectCountAfter: afterRecompute.objectCount,
    screenshotBefore: beforeShot.hash,
    screenshotAfter: afterShot.hash,
    appScreenshotBefore: afterRecompute.lastRecompute.screenshotBefore,
    appScreenshotAfter: afterRecompute.lastRecompute.screenshotAfter,
    screenshotMatch: beforeShot.hash === afterShot.hash,
    elapsedMs: afterRecompute.lastRecompute.elapsedMs
  };
  report.scenario.normal.noRebuildCounters = {
    initial: { uploads: uploadBaseline, geometryBuilds: buildBaseline, fullRebuilds: rebuildBaseline },
    afterParameters: {
      uploads: clippedNegative.renderer.bufferUploads,
      geometryBuilds: clippedNegative.metrics.geometryBuilds,
      fullRebuilds: clippedNegative.metrics.fullRebuilds
    }
  };
  check(errors.length === 0, "Normal: browser reports no runtime errors", errors.join(" | "));
  await context.close();
  return scenario;
}

async function boundaryScenario(browser, url) {
  const { context, page, errors } = await openInspector(browser, url);
  const scenario = { checks: [], screenshots: {} };
  report.scenario.boundary = scenario;
  const initial = await readSnapshot(page);

  await page.evaluate(() => {
    const api = window.__INSPECTOR__;
    for (const part of ["P-01", "P-02", "P-03", "P-04", "P-05", "P-06"]) api.toggleHidden(part);
  });
  await settle(page);
  const empty = await readSnapshot(page);
  check(empty.stats.visible === 0 && empty.stats.hidden === 6 && empty.stats.draws === 0,
    "Boundary: hiding every part leaves zero visible/drawn objects", JSON.stringify(empty.stats));
  check(empty.stats.triangles === 0, "Boundary: hidden geometry contributes zero visible triangles", empty.stats.triangles);
  check(empty.hash === initial.hash && empty.metrics.geometryBuilds === initial.metrics.geometryBuilds,
    "Boundary: all-hidden state preserves geometry hash and builds", empty.hash);
  scenario.screenshots.empty = await savePage(page, "09-boundary-all-hidden.png");

  await page.evaluate(() => {
    const api = window.__INSPECTOR__;
    for (const part of ["P-01", "P-02", "P-03", "P-04", "P-05", "P-06"]) api.toggleHidden(part);
    api.setClip({ enabled: true, axis: "y", direction: 1, offset: 99 });
  });
  await settle(page);
  const upperExtreme = await readSnapshot(page);
  check(Math.abs(upperExtreme.state.clip.offset - 2.5) < 1e-6,
    "Boundary: clip offset clamps at upper bound", upperExtreme.state.clip.offset);
  check(upperExtreme.stats.clipped === 6 && upperExtreme.stats.draws === 0,
    "Boundary: upper clip extreme culls all parts safely", JSON.stringify(upperExtreme.stats));
  check(upperExtreme.hash === initial.hash, "Boundary: extreme clip leaves hash unchanged", upperExtreme.hash);

  await page.evaluate(() => window.__INSPECTOR__.setClip({ direction: -1, offset: -99 }));
  await settle(page);
  const lowerExtreme = await readSnapshot(page);
  check(Math.abs(lowerExtreme.state.clip.offset - (-1.5)) < 1e-6,
    "Boundary: clip offset clamps at lower bound", lowerExtreme.state.clip.offset);
  check(lowerExtreme.stats.clipped === 6 && lowerExtreme.stats.draws === 0,
    "Boundary: reversed lower extreme also yields a consistent empty frame", JSON.stringify(lowerExtreme.stats));
  const emptyShot = await saveCanvas(page, "10-boundary-extreme-clip.png");
  scenario.screenshots.extreme = emptyShot.path;
  scenario.emptyScreenshot = {
    hash: emptyShot.hash,
    draws: lowerExtreme.stats.draws,
    stats: lowerExtreme.stats
  };

  await page.evaluate(() => window.__INSPECTOR__.setFilter("glass"));
  await settle(page);
  const invalidFilter = await readSnapshot(page);
  check(invalidFilter.state.filter === "all",
    "Boundary: unsupported filter is rejected without corrupting state", invalidFilter.state.filter);
  check(invalidFilter.hash === initial.hash, "Boundary: rejected input leaves scene hash stable", invalidFilter.hash);
  check(errors.length === 0, "Boundary: boundary inputs produce no runtime errors", errors.join(" | "));
  await context.close();
  return scenario;
}

async function failureScenario(browser, url) {
  const scenario = { checks: [], screenshots: {} };
  report.scenario.failure = scenario;

  const unsupportedContext = await browser.newContext({
    viewport: { width: 1440, height: 920 },
    deviceScaleFactor: 1
  });
  const unsupportedPage = await unsupportedContext.newPage();
  await unsupportedPage.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
      if (type === "webgl2" || type === "webgl") return null;
      return original.call(this, type, ...args);
    };
  });
  await unsupportedPage.goto(url, { waitUntil: "networkidle" });
  await unsupportedPage.waitForFunction(() => !document.getElementById("fatal").classList.contains("hidden"));
  const fatalTitle = await unsupportedPage.locator("#fatal-title").innerText();
  const fatalMessage = await unsupportedPage.locator("#fatal-message").innerText();
  check(fatalTitle.includes("WebGL2") && fatalMessage.includes("fails explicitly"),
    "Failure: unavailable WebGL2 produces an explicit fatal state", `${fatalTitle} / ${fatalMessage}`);
  scenario.screenshots.unsupported = await savePage(unsupportedPage, "11-failure-webgl2-unavailable.png");
  await unsupportedContext.close();

  const { context, page, errors } = await openInspector(browser, url);
  const before = await readSnapshot(page);
  const beforeShot = await saveCanvas(page, "12-failure-rollback-before.png");
  await page.evaluate(() => window.__INSPECTOR__.debug.injectFailure("recompute"));
  const result = await page.evaluate(() => window.__INSPECTOR__.recompute());
  await settle(page);
  const after = await readSnapshot(page);
  check(result.status === "FAIL" && result.error.includes("Injected"),
    "Failure: injected recompute reports a controlled failure", JSON.stringify(result));
  check(after.hash === before.hash && after.sceneHashNow === before.hash,
    "Failure: failed recompute rolls back to the previous hash", `${before.hash}→${after.hash}`);
  check(after.objectCount === before.objectCount, "Failure: failed recompute preserves object count",
    `${before.objectCount}→${after.objectCount}`);
  check(after.stats.visible === before.stats.visible && after.stats.draws === before.stats.draws,
    "Failure: failed recompute preserves visibility and draw counts", JSON.stringify(after.stats));
  check(after.metrics.rollbackCount === before.metrics.rollbackCount + 1,
    "Failure: rollback counter increments exactly once", after.metrics.rollbackCount);
  check(after.renderer.bufferUploads === before.renderer.bufferUploads,
    "Failure: rejected rebuild does not replace live GPU buffers", after.renderer.bufferUploads);
  const afterShot = await saveCanvas(page, "13-failure-rollback-after.png");
  check(beforeShot.hash === afterShot.hash, "Failure: rollback screenshot matches pre-failure frame",
    `${beforeShot.hash}→${afterShot.hash}`);
  scenario.screenshots.rollback = await savePage(page, "14-failure-rollback-page.png");

  await page.evaluate(() => window.__INSPECTOR__.debug.clearFailure());
  const recovered = await page.evaluate(() => window.__INSPECTOR__.recompute());
  check(recovered.status === "PASS" && recovered.afterHash === before.hash,
    "Failure: clearing the fault allows deterministic recovery", JSON.stringify(recovered));
  scenario.rollback = {
    beforeHash: before.hash,
    afterHash: after.hash,
    objectCountBefore: before.objectCount,
    objectCountAfter: after.objectCount,
    screenshotBefore: beforeShot.hash,
    screenshotAfter: afterShot.hash,
    screenshotMatch: beforeShot.hash === afterShot.hash,
    buffersBefore: before.renderer.bufferUploads,
    buffersAfter: after.renderer.bufferUploads
  };
  report.scenario.failure.runtimeErrors = errors;
  check(errors.length === 0, "Failure: rollback path emits no uncaught frontend errors", errors.join(" | "));
  await context.close();
  return scenario;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await startServer();
  let browser;
  try {
    const executablePath = browserExecutable();
    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox"]
    });
    report.browser = {
      name: "Chromium",
      version: browser.version(),
      executablePath: executablePath || "playwright-default",
      viewport: "1440×920 @1x"
    };
    await normalScenario(browser, server.url);
    await boundaryScenario(browser, server.url);
    await failureScenario(browser, server.url);
    report.status = "PASS";
  } catch (error) {
    report.status = "FAIL";
    report.error = error.message;
    console.error(error);
  } finally {
    if (browser) await browser.close();
    server.child.kill();
    report.finishedAt = new Date().toISOString();
    report.assertionCount = report.assertions.length;
    report.assertionsPassed = report.assertions.filter((entry) => entry.pass).length;
    report.assertionsFailed = report.assertions.filter((entry) => !entry.pass).length;
    await writeFile(join(OUT, "test-summary.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      status: report.status,
      assertions: `${report.assertionsPassed}/${report.assertionCount}`,
      artifacts: OUT,
      error: report.error || null
    }, null, 2));
    if (report.status !== "PASS") process.exitCode = 1;
  }
}

main();
