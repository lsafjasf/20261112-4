// 轻量 DOM/Canvas 桩：在无浏览器环境加载 src/main.js，验证绑定与渲染调用链。

const noop = () => {};
const ctx2d = new Proxy(
  {},
  {
    get: (t, p) => {
      if (p === "canvas") return {};
      return typeof p === "string" ? noop : undefined;
    },
    set: () => true,
  },
);

const elements = new Map();
function makeEl(id) {
  const listeners = {};
  return {
    id,
    value: id === "seed" ? "20261112" : id === "reorder" ? "H2,S1" : "",
    textContent: "",
    scrollTop: 0,
    scrollHeight: 0,
    width: 760,
    height: 520,
    getContext: () => ctx2d,
    addEventListener: (ev, fn) => {
      listeners[ev] = fn;
    },
    click: () => listeners.click && listeners.click(),
    appendChild: noop,
  };
}
globalThis.document = {
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  },
  createElement: () => makeEl("dynamic"),
};
globalThis.window = {
  AudioContext: function () {
    const node = () => ({
      type: "",
      frequency: {
        value: 0,
        setTargetAtTime: noop,
        setValueAtTime: noop,
        exponentialRampToValueAtTime: noop,
      },
      gain: {
        value: 0,
        setTargetAtTime: noop,
        setValueAtTime: noop,
        exponentialRampToValueAtTime: noop,
      },
      connect: () => node(),
      start: noop,
      stop: noop,
    });
    return {
      state: "running",
      currentTime: 0,
      destination: {},
      createOscillator: node,
      createGain: node,
      createBiquadFilter: node,
      resume: noop,
    };
  },
};
globalThis.setInterval = () => 0;
globalThis.clearInterval = noop;

await import("../src/main.js");
const stateEl = elements.get("state");
const queueEl = elements.get("queue");
console.log("初始状态:", stateEl.textContent, "| 队列:", queueEl.textContent);
elements.get("step").click(); // 单步一次
console.log("单步后状态:", stateEl.textContent);
elements.get("play").click(); // 单步会进入暂停，先恢复运行
elements.get("driveMain").click(); // 主路封闭应被记录而非抛错
elements.get("driveBackup").click(); // 备用发车
console.log("发车后队列/日志:", queueEl.textContent);
const logText = elements.get("log").value;
if (!logText.includes("主路") || !logText.includes("备用")) {
  throw new Error("未记录主路封闭/备用发车事件");
}
console.log("事件日志片段:\n" + logText.trim().split("\n").slice(-4).join("\n"));
elements.get("pause").click();
console.log("暂停后状态:", stateEl.textContent);
elements.get("reset").click();
console.log("重置后状态:", stateEl.textContent, "队列:", queueEl.textContent);
console.log("DOM 冒烟测试通过");
