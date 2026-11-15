import { DeliverySim } from "./engine.js";

// 脚本化播放器：动作按顺序执行，ready 条件满足才触发；
// 因引擎为固定步长 + 固定 seed，两次运行的触发 tick 仍逐位一致。
// action: { type, ...args }，可选 at 表示最早可执行 tick
export function playScript(actions, seed = 20261112, scenario = {}) {
  const sim = new DeliverySim(seed, scenario);
  const log = [];
  let index = 0;
  const queue = actions;
  const maxTicks = scenario.maxTicks ?? 200;

  while (
    (sim.s.status === "running" || sim.s.status === "paused") &&
    sim.s.tick < maxTicks
  ) {
    while (index < queue.length && isReady(sim, queue[index])) {
      const action = queue[index];
      applyAction(sim, action);
      log.push({ tick: sim.s.tick, type: action.type, ok: true });
      index += 1;
    }
    if (sim.s.status === "failed" || sim.s.status === "success") break;
    sim.run(1);
  }
  return { sim, log };
}

function isReady(sim, action) {
  const s = sim.s;
  if (s.status !== "running") return false;
  if (action.at !== undefined && s.tick < action.at) return false;
  if (action.type === "drive") return !s.vehicle.segment && s.queue.length > 0;
  if (action.type === "deliver") {
    const med = s.medicines.find((m) => m.id === action.medicine);
    return !med.delivered && s.vehicle.location === med.hospital && !s.vehicle.segment;
  }
  if (action.type === "swap")
    return s.vehicle.location === "S1" && !s.vehicle.segment && !s.station.outageActive;
  if (action.type === "open") {
    const box = s.boxes.find((b) => b.id === action.box);
    return !box.delivered;
  }
  if (action.type === "reorder") return !s.vehicle.segment;
  if (action.type === "wait") return true;
  return false;
}

function applyAction(sim, action) {
  switch (action.type) {
    case "drive":
      sim.drive(action.route);
      break;
    case "deliver":
      sim.deliver(action.medicine);
      break;
    case "swap":
      sim.swapBattery(action.box);
      break;
    case "open":
      sim.openBox(action.box);
      break;
    case "reorder":
      sim.reorderQueue(action.queue);
      break;
    case "wait":
      break;
    default:
      throw new Error(`未知动作 ${action.type}`);
  }
}

export { DeliverySim };
