// 集中可调参数。tick = 1 个仿真步，对应显示 1 分钟。
export const TICK_MS = 1;

export const TEMP = {
  ambient: 30, // 外界环境温度 ℃
  leak: 0.9, // 断电/开门时每 tick 向环境温度靠近的比例
  compressorBand: 0.15, // 低于上限多少度停机（滞回）
};

// 三种温控药品：id、名称、目标冷藏箱、允许温度区间
export const MEDICINES = [
  { id: "A", name: "疫苗", box: "box1", min: 2, max: 8, hospital: "H1" },
  { id: "B", name: "生物制剂", box: "box2", min: -4, max: 0, hospital: "H2" },
  { id: "C", name: "血样", box: "box3", min: 2, max: 6, hospital: "H2" },
];

export function defaultBoxes() {
  // 三个冷藏箱各自独立电池与保温层
  const mk = (id, temp) => ({
    id,
    temp,
    soc: 100, // 电量百分比
    insulation: 100, // 保温层剩余有效时间（分钟/tick）
    openTicksLeft: 0, // 剩余开箱 tick 数
    compressorOn: false,
    degraded: false, // 低电量制冷功率下降标记
    violations: 0, // 温度超限 tick 计数
    violationTicks: [],
    delivered: false,
  });
  return [mk("box1", 5), mk("box2", -2), mk("box3", 4)];
}

export const BOX_RULES = {
  drainPerTick: 0.55, // 压缩机工作每 tick 耗电
  idleDrain: 0.05, // 待机耗电
  coolingPower: 1.1, // 正常制冷：每 tick 变温 ℃
  degradedPower: 0.45, // 低电量（<20%）制冷功率
  lowSocThreshold: 20,
  openInsulationPenalty: 18, // 每次开箱扣减的保温时间
  deliveryOpenTicks: 2, // 交付时开箱持续 tick
};

export const VEHICLE = {
  startMileage: 0,
  hardBrakeDamage: 10, // 一次急刹对样本的损伤
  damageFailThreshold: 100,
  congestionBrakeChance: 0.5, // 拥堵路段每 tick 急刹概率
  normalBrakeChance: 0.04,
};

// 站点：depot 出发，H1/H2 为医院，S1 为换电点
export const STOPS = ["depot", "H1", "H2", "S1"];

// 每段行程的主路/备用路里程（tick 数）
export const SEGMENTS = {
  "depot->H1": { main: 14, backup: 20, congested: [[4, 9]], forceBlockTick: 0 },
  "H1->H2": { main: 12, backup: 17, congested: [[3, 7]] },
  "H1->S1": { main: 9, backup: 13, congested: [[2, 4]] },
  "H2->S1": { main: 8, backup: 12, congested: [] },
  "S1->H1": { main: 10, backup: 14, congested: [[2, 5]] },
  "S1->H2": { main: 9, backup: 13, congested: [] },
};

export const STATION = {
  swapCost: 1, // 换电占用 tick
  spareCount: 2, // 每箱可用满电备用电池数
  rechargePerTick: 12, // 换下的电池每 tick 回充
};

// 临时停电：换电点在 [start, end] 内无法换电/回充
export function defaultOutage() {
  return { start: 22, end: 30 };
}

// 故障判定阈值
export const FAIL_RULES = {
  maxViolationTicks: 15, // 累计超限 tick 达到该值即失败
};

export function defaultScenario(seed = 20261112) {
  return {
    seed,
    outage: defaultOutage(),
    observeTicks: 20, // 恢复后固定观察时长
  };
}
