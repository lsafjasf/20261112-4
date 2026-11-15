import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const chromeCandidates = [
  process.env.CHROME_BIN,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/home/hj/.codex-relay-home-c6r5qmlg/.cache/puppeteer/chrome-headless-shell/linux-137.0.7151.55/chrome-headless-shell-linux64/chrome-headless-shell',
].filter(Boolean);
const chromePath = chromeCandidates.find((candidate) => existsSync(candidate));
if (!chromePath) throw new Error('Set CHROME_BIN to a Chrome or Chromium executable');
const url = process.env.APP_URL || 'http://127.0.0.1:43991/';
const debugPort = Number(process.env.CHROME_DEBUG_PORT || 9322);
const outputDir = resolve(import.meta.dirname, '..', 'artifacts');
await mkdir(outputDir, { recursive: true });

const chrome = spawn(chromePath, [
  '--headless',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=/tmp/chrome-smoke-${process.pid}`,
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
chrome.stderr.on('data', () => {});

async function waitForDebugger() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) return;
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error('Chrome debugging endpoint did not start');
}

await waitForDebugger();
const tab = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json());
const socket = new WebSocket(tab.webSocketDebuggerUrl);
const pending = new Map();
const exceptions = [];
const consoleEntries = [];
let commandId = 0;

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve: resolveCommand, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolveCommand(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
  if (message.method === 'Log.entryAdded') consoleEntries.push(message.params.entry);
  if (message.method === 'Runtime.consoleAPICalled') {
    consoleEntries.push({ level: message.params.type, text: message.params.args.map((arg) => arg.value ?? arg.description).join(' ') });
  }
});

await new Promise((resolveOpen, reject) => {
  socket.addEventListener('open', resolveOpen, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

function send(method, params = {}) {
  commandId += 1;
  return new Promise((resolveCommand, reject) => {
    pending.set(commandId, { resolve: resolveCommand, reject });
    socket.send(JSON.stringify({ id: commandId, method, params }));
  });
}

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 1100,
  deviceScaleFactor: 1,
  mobile: false,
});
await send('Page.navigate', { url });
await delay(2_500);

const initial = await evaluate(`({
  clock: document.querySelector('#simClock')?.textContent,
  scenario: document.querySelector('#scenarioSelect')?.value,
  verification: document.querySelector('#verificationBox')?.textContent.trim(),
  pumpControls: document.querySelectorAll('.pump-row').length,
  reservoirControls: document.querySelectorAll('.reservoir-row').length,
  canvasPixels: [document.querySelector('#networkCanvas')?.width, document.querySelector('#networkCanvas')?.height]
})`);

await evaluate(`document.querySelector('#pauseBtn').click()`);
await delay(200);
const pausedClock = await evaluate(`document.querySelector('#simClock').textContent`);
await evaluate(`document.querySelector('#stepBtn').click()`);
await delay(220);
const steppedClock = await evaluate(`document.querySelector('#simClock').textContent`);
await evaluate(`(() => {
  const select = document.querySelector('#speedSelect');
  select.value = '8';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  const pause = document.querySelector('#pauseBtn');
  if (pause.textContent === '继续') pause.click();
})()`);

let burstObservation = null;
for (let attempt = 0; attempt < 100; attempt += 1) {
  await delay(250);
  const status = await evaluate(`({
    clock: document.querySelector('#simClock').textContent,
    burst: document.querySelector('#burstState').textContent,
    isolateDisabled: document.querySelector('#isolateBtn').disabled,
    repairDisabled: document.querySelector('#repairBtn').disabled
  })`);
  if (status.burst !== '无爆管') {
    await evaluate(`document.querySelector('#pauseBtn').click()`);
    await delay(150);
    burstObservation = await evaluate(`({
      clock: document.querySelector('#simClock').textContent,
      burst: document.querySelector('#burstState').textContent,
      isolateDisabled: document.querySelector('#isolateBtn').disabled,
      repairDisabled: document.querySelector('#repairBtn').disabled,
      resultText: document.querySelector('#resultBody').textContent.trim()
    })`);
    break;
  }
}

const burstScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await writeFile(resolve(outputDir, 'browser-smoke.png'), Buffer.from(burstScreenshot.data, 'base64'));

await evaluate(`(() => {
  const pause = document.querySelector('#pauseBtn');
  if (pause.textContent === '继续') pause.click();
})()`);
let finalObservation = null;
for (let attempt = 0; attempt < 150; attempt += 1) {
  await delay(1_000);
  const status = await evaluate(`({
    clock: document.querySelector('#simClock').textContent,
    badge: document.querySelector('#resultBadge').textContent,
    resultText: document.querySelector('#resultBody').textContent.trim()
  })`);
  if (status.badge !== '进行中' && status.badge !== '已暂停') {
    finalObservation = status;
    break;
  }
}
const finalScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await writeFile(resolve(outputDir, 'browser-final.png'), Buffer.from(finalScreenshot.data, 'base64'));

await evaluate(`(() => {
  const select = document.querySelector('#scenarioSelect');
  select.value = 'burst-failure';
  select.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
let failureObservation = null;
for (let attempt = 0; attempt < 45; attempt += 1) {
  await delay(1_000);
  const status = await evaluate(`({
    clock: document.querySelector('#simClock').textContent,
    badge: document.querySelector('#resultBadge').textContent,
    resultText: document.querySelector('#resultBody').textContent.trim()
  })`);
  if (status.badge === '失败') {
    failureObservation = status;
    break;
  }
}
const failureScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await writeFile(resolve(outputDir, 'browser-failure.png'), Buffer.from(failureScreenshot.data, 'base64'));

const report = {
  url,
  initial,
  controls: { pausedClock, steppedClock, advancedByStep: pausedClock !== steppedClock },
  burstObservation,
  finalObservation,
  failureObservation,
  exceptions: exceptions.map((exception) => exception.text),
  consoleErrors: consoleEntries.filter((entry) => entry.level === 'error').map((entry) => entry.text),
};
await writeFile(resolve(outputDir, 'browser-smoke.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

socket.close();
chrome.kill('SIGTERM');
