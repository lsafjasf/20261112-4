import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:4180/";
const candidates = [
  process.env.CHROME_PATH,
  "/tmp/chrome-test/chrome-linux64/chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
].filter(Boolean);

let executablePath = null;
for (const candidate of candidates) {
  try {
    await access(candidate);
    executablePath = candidate;
    break;
  } catch {
    // Try the next installed browser.
  }
}
if (!executablePath) {
  throw new Error("No Chromium executable found. Set CHROME_PATH to run the browser check.");
}

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(`PAGE: ${error.message}`));

async function setPower(deviceId, value) {
  const input = page.locator(`.device-card[data-device="${deviceId}"] [data-power]`);
  await input.evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function configureSuccessPlan() {
  for (const deviceId of ["R1", "R2", "R3", "D1"]) {
    await page.locator(`.device-card[data-device="${deviceId}"] [data-frequency="3"]`).click();
    await setPower(deviceId, 95);
  }
  await page.locator('.device-card[data-device="R2"] [data-zone="1"]').click();
  await page.locator('.device-card[data-device="R3"] [data-zone="2"]').click();
}

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });

assert.match(await page.title(), /潮汐守夜/);
assert.equal(await page.locator(".device-card").count(), 4);
assert.equal(await page.locator("#tickNow").textContent(), "0");
const canvasHasPixels = await page.locator("#coastCanvas").evaluate((canvas) => {
  const context = canvas.getContext("2d");
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let nonTransparent = 0;
  for (let index = 3; index < data.length; index += 4000) {
    if (data[index] > 0) nonTransparent += 1;
  }
  return nonTransparent > 100;
});
assert.equal(canvasHasPixels, true);

await page.selectOption("#scenarioSelect", "gust");
await page.click("#loadScenarioBtn");
assert.equal(await page.locator("#scenarioCode").textContent(), "GUST-01");
await configureSuccessPlan();
await page.click("#stepBtn");

let restored = await page.evaluate(() => JSON.parse(localStorage.getItem("coastwatch.run.v1")));
assert.equal(restored.tick, 1);
assert.equal(restored.devices.R2.zone, 1);
assert.equal(restored.devices.R2.power, 95);
assert.equal(restored.devices.R2.frequency, 3);
assert.ok(restored.devices.R2.battery < 100);

await page.reload({ waitUntil: "networkidle" });
assert.equal(await page.locator("#tickNow").textContent(), "1");
assert.equal(await page.locator("#D1-power-value").textContent(), "95%");

await page.click("#audioBtn");
await page.waitForTimeout(180);
assert.equal(await page.locator("#audioBtn").getAttribute("aria-pressed"), "true");
let runtime = await page.evaluate(() => window.__coastwatchDebug.snapshot());
assert.ok(["running", "suspended"].includes(runtime.audio.contextState));

await page.click("#runBtn");
await page.waitForTimeout(80);
await page.click("#pauseBtn");
const pausedTick = Number(await page.locator("#tickNow").textContent());
assert.ok(pausedTick >= 2);
await page.waitForTimeout(1800);
assert.equal(Number(await page.locator("#tickNow").textContent()), pausedTick);

await page.click("#stepBtn");
const steppedTick = Number(await page.locator("#tickNow").textContent());
assert.equal(steppedTick, pausedTick + 1);
await page.waitForTimeout(1800);
assert.equal(Number(await page.locator("#tickNow").textContent()), steppedTick);

for (let index = 0; index < 8; index += 1) {
  if (await page.locator("#stepBtn").isDisabled()) break;
  await page.click("#stepBtn");
  await page.waitForTimeout(30);
}

runtime = await page.evaluate(() => window.__coastwatchDebug.snapshot());
assert.equal(runtime.status, "completed");
assert.equal(runtime.outcome, "success");
assert.equal(runtime.faultStatus, "recovered");
assert.equal(runtime.pendingRetakes, 0);
assert.equal(runtime.disturbanceCount, 0);
assert.equal(runtime.recoveryObservation.completed, 4);
assert.equal(runtime.recoveryObservation.passed, true);
assert.equal(runtime.autoTimerActive, false);

await page.click('[data-tab="verify"]');
await page.click("#runVerificationBtn");
await page.waitForFunction(
  () => document.querySelector("#runVerificationBtn").textContent.includes("重新运行"),
);
const proofText = await page.locator("#verifyResults").innerText();
assert.match(proofText, /同输入连续运行 ×2/);
assert.match(proofText, /噪声 → 质检拒绝 → 重采/);
assert.match(proofText, /可重复失败场景/);
assert.match(proofText, /恢复后固定观察/);
assert.match(proofText, /PASS/);
await page.screenshot({ path: "artifacts/ui-verified.png", fullPage: true });

await page.click("#resetBtn");
await page.waitForTimeout(80);
runtime = await page.evaluate(() => window.__coastwatchDebug.snapshot());
assert.equal(runtime.tick, 0);
assert.equal(runtime.autoTimerActive, false);
assert.equal(runtime.faultActive, false);
assert.equal(runtime.pendingRetakes, 0);
assert.equal(runtime.recoveryObservation.completed, 0);
assert.equal(await page.locator("#D1-power-value").textContent(), "80%");
await page.waitForTimeout(1800);
assert.equal(Number(await page.locator("#tickNow").textContent()), 0);

await page.click("#lightsBtn");
await page.click("#stepBtn");
runtime = await page.evaluate(() => window.__coastwatchDebug.snapshot());
assert.equal(runtime.disturbanceCount, 1);
await page.click("#resetBtn");
await page.waitForTimeout(1800);
runtime = await page.evaluate(() => window.__coastwatchDebug.snapshot());
assert.equal(runtime.tick, 0);
assert.equal(runtime.disturbanceCount, 0);
assert.equal(runtime.autoTimerActive, false);
assert.equal(runtime.audio.scheduledTimers, 0);
assert.equal(runtime.audio.dynamicVoiceNodes, 0);

if (await page.locator("#audioBtn").getAttribute("aria-pressed") === "true") {
  await page.click("#audioBtn");
  await page.waitForTimeout(80);
}
assert.equal(await page.locator("#audioBtn").getAttribute("aria-pressed"), "false");
runtime = await page.evaluate(() => window.__coastwatchDebug.snapshot());
assert.equal(runtime.audio.dynamicVoiceNodes, 0);
assert.equal(runtime.audio.scheduledTimers, 0);
assert.equal(runtime.audio.contextState, "suspended");
assert.deepEqual(errors, []);

const evidence = {
  baseUrl,
  executablePath,
  checks: {
    canvasRendered: canvasHasPixels,
    persistedAcrossReload: true,
    pausedWithoutAdvancing: true,
    singleStepDidNotStartTimer: true,
    completedSuccessfully: true,
    verificationUiPassed: true,
    resetClearedRunAndTimer: true,
    lightsCountedAsDisturbance: true,
    noRuntimeErrors: errors.length === 0,
  },
  finalRuntime: runtime,
};
await writeFile("artifacts/browser-check.json", `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));

await browser.close();
