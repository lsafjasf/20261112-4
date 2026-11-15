import { DeliverySim } from "./engine.js";
import { Renderer } from "./renderer.js";
import { AudioEngine } from "./audio.js";
import { MEDICINES } from "./config.js";

const $ = (id) => document.getElementById(id);
const canvas = $("scene");
const renderer = new Renderer(canvas);
const audio = new AudioEngine();

let sim;
let timer = null;
const SPEED = 450; // 每 tick 毫秒

function currentSeed() {
  return Number($("seed").value) >>> 0;
}

function boot() {
  sim = new DeliverySim(currentSeed());
  stopLoop();
  render();
  logLine(`已用 seed=${sim.cfg.seed} 初始化，可发车`);
}

function render() {
  renderer.draw(sim);
  const active = sim.s.boxes.filter((b) => b.compressorOn && !b.delivered).length;
  const degraded = sim.s.boxes.some((b) => b.degraded && b.compressorOn);
  audio.updateCompressor(active, degraded);
  const alarm = sim.s.boxes.some((b) => {
    if (b.delivered) return false;
    const med = MEDICINES.find((m) => m.box === b.id);
    return b.temp < med.min || b.temp > med.max;
  }) || sim.s.vehicle.damage >= 80;
  audio.setAlarm(alarm);
  $("queue").textContent = sim.s.queue.join(" → ");
  $("state").textContent = sim.s.status;
}

function logLine(text) {
  const box = $("log");
  box.value += `t${sim ? sim.s.tick : 0} ${text}\n`;
  box.scrollTop = box.scrollHeight;
}

function guard(fn) {
  try {
    fn();
    render();
  } catch (err) {
    logLine(`操作被拒绝：${err.message}`);
  }
}

function tickLoop() {
  if (sim.s.status !== "running") {
    stopLoop();
    return;
  }
  sim.run(1);
  const ev = sim.s.events[sim.s.events.length - 1];
  if (ev) logLine(ev.type);
  render();
}

function startLoop() {
  stopLoop();
  timer = setInterval(tickLoop, SPEED);
}

function stopLoop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function bind() {
  $("initAudio").addEventListener("click", () => {
    audio.init();
    logLine("Web Audio 已激活");
  });
  $("mute").addEventListener("click", () => {
    const muted = audio.toggleMute();
    $("mute").textContent = muted ? "取消静音" : "静音";
  });
  $("play").addEventListener("click", () =>
    guard(() => {
      audio.init();
      if (sim.s.status === "paused") sim.resume();
      startLoop();
      logLine("继续运行");
    }));
  $("pause").addEventListener("click", () =>
    guard(() => {
      sim.pause();
      stopLoop();
      logLine("已暂停");
      render();
    }));
  $("step").addEventListener("click", () =>
    guard(() => {
      stopLoop();
      sim.step();
      logLine("单步 +1");
    }));
  $("reset").addEventListener("click", () => {
    stopLoop();
    boot();
  });
  $("driveMain").addEventListener("click", () =>
    guard(() => {
      sim.drive("main");
      logLine("尝试主路发车");
    }));
  $("driveBackup").addEventListener("click", () =>
    guard(() => {
      sim.drive("backup");
      logLine("备用路线发车");
    }));
  for (const med of MEDICINES) {
    const btn = document.createElement("button");
    btn.textContent = `交付 ${med.id}`;
    btn.addEventListener("click", () =>
      guard(() => {
        sim.deliver(med.id);
        logLine(`交付药品 ${med.id}`);
      }));
    $("actions").appendChild(btn);
  }
  for (const boxId of ["box1", "box2", "box3"]) {
    const swap = document.createElement("button");
    swap.textContent = `换电 ${boxId}`;
    swap.addEventListener("click", () =>
      guard(() => {
        sim.swapBattery(boxId);
        logLine(`更换 ${boxId} 电池`);
      }));
    $("actions").appendChild(swap);
    const open = document.createElement("button");
    open.textContent = `开箱 ${boxId}`;
    open.addEventListener("click", () =>
      guard(() => {
        sim.openBox(boxId);
        logLine(`打开 ${boxId}（保温缩短）`);
      }));
    $("actions").appendChild(open);
  }
  $("applyReorder").addEventListener("click", () =>
    guard(() => {
      const next = $("reorder").value.split(",").map((x) => x.trim());
      sim.reorderQueue(next);
      logLine(`路线重排为 ${next.join(" → ")}`);
      render();
    }));
  $("reseed").addEventListener("click", () => boot());
}

bind();
boot();
