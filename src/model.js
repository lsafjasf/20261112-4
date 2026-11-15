export const TICK_SECONDS = 30;
export const SIM_DURATION_SECONDS = 6 * 60 * 60;
export const HISTORY_INTERVAL_SECONDS = 60;
export const RECOVERY_WATCH_SECONDS = 30 * 60;

export const STATION_IDS = ['P1', 'P2', 'P3', 'P4'];
export const RESERVOIR_IDS = ['R1', 'R2', 'R3'];
export const ZONE_IDS = ['north', 'central', 'lowland'];

export const STATIONS = {
  P1: {
    id: 'P1',
    name: '北岸泵站',
    short: '北岸',
    zone: 'north',
    capacityM3s: 3.6,
    catchmentM2: 300_000,
    baseInflowM3s: 0.18,
    wetWellCapacityM3: 4_800,
    initialWetWellM3: 1_950,
    delaySec: 45,
    initialSpeed: 54,
  },
  P2: {
    id: 'P2',
    name: '老城泵站',
    short: '老城',
    zone: 'central',
    capacityM3s: 3.2,
    catchmentM2: 260_000,
    baseInflowM3s: 0.24,
    wetWellCapacityM3: 4_200,
    initialWetWellM3: 1_700,
    delaySec: 60,
    initialSpeed: 57,
  },
  P3: {
    id: 'P3',
    name: '南市泵站',
    short: '南市',
    zone: 'central',
    capacityM3s: 2.8,
    catchmentM2: 220_000,
    baseInflowM3s: 0.2,
    wetWellCapacityM3: 3_600,
    initialWetWellM3: 1_480,
    delaySec: 45,
    initialSpeed: 53,
  },
  P4: {
    id: 'P4',
    name: '滨河泵站',
    short: '滨河',
    zone: 'lowland',
    capacityM3s: 4.6,
    catchmentM2: 360_000,
    baseInflowM3s: 0.36,
    wetWellCapacityM3: 5_600,
    initialWetWellM3: 2_300,
    delaySec: 60,
    initialSpeed: 61,
  },
};

export const RESERVOIRS = {
  R1: {
    id: 'R1',
    name: '高地清水池',
    short: '高地',
    zone: 'north',
    capacityM3: 86_000,
    initialVolumeM3: 44_000,
    initialGate: 58,
    delaySec: 60,
    facilityId: 'D3',
  },
  R2: {
    id: 'R2',
    name: '中心调蓄池',
    short: '中心',
    zone: 'central',
    capacityM3: 96_000,
    initialVolumeM3: 47_000,
    initialGate: 44,
    delaySec: 60,
    facilityId: 'D2',
  },
  R3: {
    id: 'R3',
    name: '滨河蓄水池',
    short: '滨河',
    zone: 'lowland',
    capacityM3: 62_000,
    initialVolumeM3: 27_000,
    initialGate: 52,
    delaySec: 60,
    facilityId: 'D3',
  },
};

export const FACILITIES = {
  D1: { id: 'D1', name: '榆树巷', kind: '低洼街区', floodLimitM3: 28 },
  D2: { id: 'D2', name: '河堤路', kind: '低洼街区', floodLimitM3: 32 },
  D3: { id: 'D3', name: '南市街', kind: '低洼街区', floodLimitM3: 26 },
  WTP: { id: 'WTP', name: '净水厂', kind: '关键设施', floodLimitM3: 18 },
};

export const ZONES = {
  north: { id: 'north', name: '北片管网', pumps: ['P1'], reservoirs: ['R1'], basePressure: 1.4 },
  central: { id: 'central', name: '中心管网', pumps: ['P2', 'P3'], reservoirs: ['R2'], basePressure: 1.32 },
  lowland: { id: 'lowland', name: '滨河管网', pumps: ['P4'], reservoirs: ['R3'], basePressure: 1.28 },
};

export const PIPE_SEGMENTS = {
  S1: { id: 'S1', name: '北干管', zone: 'north', station: 'P1', from: 'P1', to: 'R1' },
  S2: { id: 'S2', name: '中心干管', zone: 'central', station: 'P2', from: 'P2', to: 'WTP' },
  S3: { id: 'S3', name: '南支管', zone: 'central', station: 'P3', from: 'P3', to: 'R2' },
  S4: { id: 'S4', name: '滨河干管', zone: 'lowland', station: 'P4', from: 'P4', to: 'R3' },
};

export const PRESSURE = {
  lowAlert: 2.8,
  lowCritical: 2.2,
  highAlert: 7.85,
  burstAt: 8.18,
  burstExposureSec: 180,
};

export const HYDRAULICS = {
  pumpRampPerTick: 3.5,
  storageFraction: 0.32,
  wtpTargetM3s: 7.4,
  directToWtpFraction: 0.7,
};

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function priorityWeights(order) {
  const weights = { 1: 0.52, 2: 0.31, 3: 0.17 };
  return Object.fromEntries(order.map((id, index) => [id, weights[index + 1]]));
}

export function rainfallAt(timeSec) {
  const hour = timeSec / 3600;
  const firstCell = 31 * Math.exp(-((hour - 2.15) ** 2) / 0.72);
  const secondCell = 18 * Math.exp(-((hour - 4.75) ** 2) / 0.5);
  const texture = 2.4 * Math.sin(hour * 4.1) + 1.15 * Math.sin(hour * 11.7);
  return round(Math.max(0, 9 + firstCell + secondCell + texture), 3);
}

export function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.min(SIM_DURATION_SECONDS, Math.floor(totalSeconds)));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((part) => String(part).padStart(2, '0')).join(':');
}
