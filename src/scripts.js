// 固定输入脚本：动作绑定 tick，配合固定 seed 实现逐位复现。

export const SUCCESS_SCRIPT = [
  { at: 0, type: "drive", route: "main" }, // 主路封闭，记录 route_blocked
  { at: 1, type: "drive", route: "backup" }, // 改装备用路线并留完整记录
  { at: 20, type: "deliver", medicine: "A" }, // 抵达 H1
  // 重排：先去 S1 换电再去 H2（H1 完成后队列原为 H2,S1）
  { at: 21, type: "reorder", queue: ["S1", "H2"] },
  { at: 22, type: "drive", route: "main" },
  { at: 30, type: "swap", box: "box2" }, // 抵达 S1（停电 tick22-30，30 为最后停电 tick）
  { at: 31, type: "swap", box: "box3" },
  { at: 32, type: "drive", route: "main" },
  { at: 44, type: "deliver", medicine: "B" }, // 抵达 H2
  { at: 45, type: "deliver", medicine: "C" },
];

// 失败场景：不给 box2 换电并多次开箱，耗尽保温与电量，
// 低电量下制冷功率下降，累计超限 15 tick 触发温控失败。
export const FAILURE_SCRIPT = [
  { at: 0, type: "drive", route: "main" },
  { at: 1, type: "drive", route: "backup" },
  { at: 20, type: "deliver", medicine: "A" },
  { at: 21, type: "reorder", queue: ["S1", "H2"] },
  { at: 22, type: "drive", route: "main" },
  { at: 30, type: "wait" }, // 到达 S1 但刻意不换电
  { at: 32, type: "drive", route: "main" },
  { at: 40, type: "open", box: "box2" }, // 多次开箱缩短保温
  { at: 42, type: "open", box: "box2" },
  { at: 44, type: "open", box: "box2" },
];

// 失败场景专用参数：加快耗电与保温衰减，保证在固定 tick 内触发
export const FAILURE_SCENARIO = {
  seed: 20261112,
  outage: { start: 22, end: 30 },
  observeTicks: 20,
  drainBoost: 2.6,
  insulationStart: 18,
};
