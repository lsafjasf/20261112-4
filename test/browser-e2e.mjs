import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(import.meta.dirname);
const chromePath = join(homedir(), '.cache/puppeteer/chrome/chrome-linux64/chrome');
const outDir = join(root, 'artifacts');
mkdirSync(outDir, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const path = (req.url === '/' ? '/index.html' : req.url.split('?')[0]);
    const data = await readFile(join(root, path));
    const ext = path.slice(path.lastIndexOf('.'));
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/index.html`;

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100 });
const consoleErrors = [];
page.on('pageerror', (err) => consoleErrors.push(String(err)));
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

await page.goto(url, { waitUntil: 'networkidle0' });
await page.waitForSelector('#editors .state-card');
await new Promise((r) => setTimeout(r, 500));

await page.click('[data-input="moveStart"]');
await new Promise((r) => setTimeout(r, 250));
await page.click('[data-input="attack"]');
await new Promise((r) => setTimeout(r, 120));
await page.click('[data-input="hit"]');
await new Promise((r) => setTimeout(r, 120));
const interactive = await page.evaluate(() => {
  const log = document.getElementById('audio-log').innerText;
  return {
    blocked: log.includes('hitBlocked'),
    attackStarted: log.includes('attack-start'),
    moveStarted: log.includes('move-start'),
  };
});
if (!interactive.blocked || !interactive.attackStarted || !interactive.moveStarted) {
  throw new Error('按钮交互验证失败: ' + JSON.stringify(interactive));
}

await page.click('#btn-roundtrip');
await page.waitForFunction(() => document.querySelector('#verdict').className.includes('ok'), { timeout: 8000 });

await page.click('#btn-dirty');
await new Promise((r) => setTimeout(r, 700));

const data = await page.evaluate(() => ({
  verdict: document.getElementById('verdict').textContent,
  verdictClass: document.getElementById('verdict').className,
  hashTable: document.getElementById('hash-output').innerText,
  chain: document.getElementById('chain-output').innerText,
  testTable: document.getElementById('test-output').innerText,
  dirty: document.getElementById('dirty-output').innerText,
  summary: document.getElementById('summary').innerText,
  flash: document.getElementById('flash').textContent,
  storage: localStorage.getItem('asm2d.project') ? 'saved' : 'missing',
}));

await page.screenshot({ path: join(outDir, 'browser-page.png'), fullPage: true });
await page.screenshot({ path: join(outDir, 'stage-only.png'), clip: { x: 28, y: 90, width: 680, height: 480 } });

const stageHash = await page.evaluate(() => {
  const c = document.getElementById('stage');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0x811c9dc5;
  let nonzero = 0;
  for (let i = 0; i < d.length; i++) {
    if (i % 4 === 3 && d[i]) nonzero++;
    h = Math.imul(h ^ d[i], 0x01000193);
  }
  return { hash: (h >>> 0).toString(16).padStart(8, '0'), nonzero };
});

writeFileSync(join(outDir, 'browser-report.json'), JSON.stringify({ ...data, stageHash, consoleErrors }, null, 2));

console.log('=== 浏览器端到端 ===');
console.log(data.verdict);
console.log('localStorage:', data.storage);
console.log('stage:', stageHash);
console.log('console errors:', consoleErrors.length);
if (consoleErrors.length) console.log(consoleErrors.join('\n'));

await browser.close();
server.close();
if (!data.verdictClass.includes('ok') || consoleErrors.length) process.exit(1);
