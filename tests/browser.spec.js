import { test, expect } from "@playwright/test";

async function findByCage(page, container, cageId) {
  return page.locator(`${container} [data-cage="${cageId}"]`);
}

async function queueRound(page) {
  for (const cageId of [1, 2, 3]) {
    await (await findByCage(page, "#aeratorActions", cageId)).click();
    await (await findByCage(page, "#cleanActions", cageId)).click();
  }
  for (const cageId of [1, 2, 3]) {
    await page.locator("#feedCage").selectOption(String(cageId));
    await page.locator("#feedButton").click();
  }
}

async function runUntil(page, tick) {
  return page.evaluate((target) => window.__tidewatch.runUntil(target), tick);
}

async function state(page) {
  return page.evaluate(() => window.__tidewatch.snapshot);
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.__errors = errors;
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
});

test.afterEach(async ({ page }) => {
  expect(page.__errors, "页面不应出现脚本或资源错误").toEqual([]);
});

test("pause, single-step and reset controls", async ({ page }) => {
  await expect(page.locator("#runStatus")).toHaveText("已暂停");
  await page.locator("#playButton").click();
  await page.waitForTimeout(700);
  await page.locator("#playButton").click();
  const paused = await state(page);
  expect(paused.tick).toBeGreaterThan(0);

  await page.locator("#stepButton").click();
  const stepped = await state(page);
  expect(stepped.tick).toBe(paused.tick + 1);

  await page.locator("#resetButton").click();
  const reset = await state(page);
  expect(reset.tick).toBe(0);
  expect(reset.resources).toEqual({ power: 86, fuel: 48, feed: 34, repairKits: 2 });
  expect(reset.cages.map((cage) => cage.health)).toEqual([64, 61, 67]);
});

test("delayed feedback completes a full standard regulation", async ({ page }) => {
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveClass(/is-on/);

  await queueRound(page);
  const issued = await state(page);
  expect(issued.pending).toHaveLength(9);
  expect(issued.cages.every((cage) => !cage.aerator)).toBe(true);
  expect(issued.cages.map((cage) => cage.feedReserve)).toEqual([2.2, 1.3, 2.6]);

  await runUntil(page, 3);
  const beforePump = await state(page);
  expect(beforePump.cages.every((cage) => !cage.aerator)).toBe(true);

  await runUntil(page, 4);
  const afterPumpDelay = await state(page);
  expect(afterPumpDelay.cages.every((cage) => cage.aerator)).toBe(true);

  await runUntil(page, 9);
  const afterServiceDelay = await state(page);
  expect(afterServiceDelay.cages.every((cage) => cage.fouling < 40)).toBe(true);
  expect(afterServiceDelay.cages.every((cage) => cage.feedReserve > issued.cages.find((item) => item.id === cage.id).feedReserve)).toBe(true);

  await runUntil(page, 60);
  await (await findByCage(page, "#cleanActions", 2)).click();
  await page.locator("#feedCage").selectOption("1");
  await page.locator("#feedButton").click();
  await page.locator("#feedCage").selectOption("2");
  await page.locator("#feedButton").click();
  await page.locator("#feedCage").selectOption("3");
  await page.locator("#feedButton").click();

  const final = await runUntil(page, 120);
  expect(final.finished).toBe(true);
  expect(final.success).toBe(true);
  final.cages.forEach((cage) => {
    expect(cage.health).toBeGreaterThanOrEqual(72);
    expect(cage.pollution).toBeLessThanOrEqual(42);
  });
  await expect(page.locator("#resultDialog")).toBeVisible();
  await expect(page.locator("#resultTitle")).toHaveText("12 小时任务达标");
  await page.screenshot({ path: "artifacts/tidewatch-standard-final.png", fullPage: true });

  await page.locator('.modal-close[data-close="resultDialog"]').click();
  await page.locator("#auditButton").click();
  await expect(page.locator("#auditDialog")).toBeVisible();
  await expect(page.locator("#auditBody")).toContainText("双跑结果完全一致");
  const audit = await page.evaluate(() => window.__tidewatch.auditEvidence);
  expect(audit.allEqual).toBe(true);
  expect(audit.runA.final.success).toBe(true);
  expect(audit.runB.final.success).toBe(true);
  await page.screenshot({ path: "artifacts/tidewatch-standard-audit.png", fullPage: true });
});

test("storm tear pauses, is repaired, then passes fixed observation", async ({ page }) => {
  await page.locator('[data-scenario="storm"]').click();
  await queueRound(page);
  const atFault = await runUntil(page, 32);

  expect(atFault.tick).toBe(32);
  expect(atFault.cages[2].tear).toBe(true);
  expect(atFault.pending.some((job) => job.type === "repairNet")).toBe(false);
  expect(await page.evaluate(() => window.__tidewatch.running)).toBe(false);
  await expect(page.locator("#faultDialog")).toBeVisible();
  await expect(page.locator("#faultSummary")).toContainText("触发前 / BEFORE");
  await expect(page.locator("#faultSummary")).toContainText("触发后 / AFTER");
  const record = await page.evaluate(() => window.__tidewatch.state.fault);
  expect(record.before.cages[2].netIntegrity).toBe(38);
  expect(record.after.cages[2].netIntegrity).toBe(12);
  expect(record.after.cages[2].tear).toBe(true);
  await page.screenshot({ path: "artifacts/tidewatch-fault-before-repair.png", fullPage: true });

  await page.locator("#faultRepairAction").click();
  const repairQueued = await state(page);
  expect(repairQueued.pending.some((job) => job.type === "repairNet")).toBe(true);
  expect(repairQueued.cages[2].tear).toBe(true);
  expect(repairQueued.resources.repairKits).toBe(1);

  await runUntil(page, 36);
  expect((await state(page)).cages[2].tear).toBe(true);
  const repaired = await runUntil(page, 37);
  expect(repaired.cages[2].tear).toBe(false);
  expect(repaired.resources.repairKits).toBe(1);
  const observation = await page.evaluate(() => window.__tidewatch.state.observation);
  expect(observation.active).toBe(true);
  expect(observation.endTick - observation.startTick).toBe(20);

  const observed = await runUntil(page, 57);
  const observationFinal = await page.evaluate(() => window.__tidewatch.state.observation);
  expect(observed.tick).toBe(57);
  expect(observationFinal.active).toBe(false);
  expect(observationFinal.passed).toBe(true);
  expect(observationFinal.issues).toEqual([]);
  expect(observationFinal.activeErrorCount).toBe(0);
  expect(observationFinal.pendingCount).toBe(0);
  await page.screenshot({ path: "artifacts/tidewatch-recovery-observed.png", fullPage: true });

  await runUntil(page, 60);
  await (await findByCage(page, "#cleanActions", 2)).click();
  await (await findByCage(page, "#cleanActions", 3)).click();
  await page.locator("#feedCage").selectOption("1");
  await page.locator("#feedButton").click();
  await page.locator("#feedCage").selectOption("2");
  await page.locator("#feedButton").click();
  await page.locator("#feedCage").selectOption("3");
  await page.locator("#feedButton").click();
  const final = await runUntil(page, 120);
  expect(final.success).toBe(true);
  expect(final.cages[2].tear).toBe(false);
  const cleanState = await page.evaluate(() => {
    const current = window.__tidewatch.state;
    return {
      pendingRepairs: current.pending.filter((job) => job.type === "repairNet").length,
      pendingTasks: current.pending.length,
      errors: current.errors.length,
      activeErrors: current.errors.filter((error) => !error.resolved).length,
      observationErrors: current.errors.slice(current.observation.startErrorCount).length,
      resources: current.resources,
      observation: current.observation.end
    };
  });
  expect(cleanState.pendingRepairs).toBe(0);
  expect(cleanState.pendingTasks).toBe(0);
  expect(cleanState.activeErrors).toBe(0);
  expect(cleanState.observationErrors).toBe(0);
  expect(Object.values(cleanState.resources).every((value) => value >= 0)).toBe(true);
  expect(cleanState.observation.cages[2].tear).toBe(false);

  await page.locator('.modal-close[data-close="resultDialog"]').click();
  await page.locator("#auditButton").click();
  const audit = await page.evaluate(() => window.__tidewatch.auditEvidence);
  expect(audit.allEqual).toBe(true);
  expect(audit.runA.fault.observation.passed).toBe(true);
  expect(audit.runB.fault.observation.passed).toBe(true);
  await expect(page.locator("#auditBody")).toContainText("双跑结果完全一致");
  await page.screenshot({ path: "artifacts/tidewatch-storm-audit.png", fullPage: true });
});
