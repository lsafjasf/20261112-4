import {
  FACILITIES,
  HYDRAULICS,
  PIPE_SEGMENTS,
  PRESSURE,
  RECOVERY_WATCH_SECONDS,
  RESERVOIRS,
  RESERVOIR_IDS,
  SIM_DURATION_SECONDS,
  STATIONS,
  STATION_IDS,
  TICK_SECONDS,
  ZONES,
  ZONE_IDS,
  clamp,
  formatClock,
  priorityWeights,
  rainfallAt,
  round,
} from './model.js';

const DEFAULT_PRIORITY = ['R2', 'R3', 'R1'];

function copyMeta(source) {
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, { ...value }]));
}

function buildInitialState(scenario) {
  const pumpSpeeds = scenario.initial?.pumpSpeeds ?? {};
  const gates = scenario.initial?.gates ?? {};
  const priority = scenario.initial?.priority ?? DEFAULT_PRIORITY;
  const pumps = copyMeta(STATIONS);
  const reservoirs = copyMeta(RESERVOIRS);
  const wetWells = {};

  for (const id of STATION_IDS) {
    const speed = clamp(pumpSpeeds[id] ?? pumps[id].initialSpeed, 0, 100);
    wetWells[id] = {
      volumeM3: pumps[id].initialWetWellM3,
      capacityM3: pumps[id].wetWellCapacityM3,
      level: pumps[id].initialWetWellM3 / pumps[id].wetWellCapacityM3,
      overflowTotalM3: 0,
    };
    pumps[id] = {
      ...pumps[id],
      targetSpeed: speed,
      speed,
      flowM3s: 0,
      pumpedM3: 0,
      energyKWh: 0,
      minSpeed: speed,
      maxSpeed: speed,
      speedSum: 0,
      samples: 0,
    };
  }

  for (const id of RESERVOIR_IDS) {
    const gate = clamp(gates[id] ?? reservoirs[id].initialGate, 0, 100);
    const volume = reservoirs[id].initialVolumeM3;
    reservoirs[id] = {
      ...reservoirs[id],
      targetGate: gate,
      gate,
      volumeM3: volume,
      level: volume / reservoirs[id].capacityM3,
      inflowM3s: 0,
      outflowM3s: 0,
      inflowTotalM3: 0,
      outflowTotalM3: 0,
      spillTotalM3: 0,
      peakLevel: volume / reservoirs[id].capacityM3,
    };
  }

  const facilities = Object.fromEntries(
    Object.entries(FACILITIES).map(([id, item]) => [
      id,
      { ...item, floodM3: 0, peakFloodM3: 0, flooded: false, floodedAt: null },
    ]),
  );

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    timeSec: 0,
    tick: 0,
    pumps,
    wetWells,
    reservoirs,
    priority,
    facilities,
    burst: null,
    zones: Object.fromEntries(
      ZONE_IDS.map((id) => [
        id,
        {
          ...ZONES[id],
          pressure: 4.8,
          minPressure: 99,
          maxPressure: 0,
          pressureSum: 0,
          samples: 0,
          exposureSec: 0,
          lowPressureSec: 0,
          hydrantAvailable: true,
        },
      ]),
    ),
    pendingCommands: [],
    scheduledCommands: (scenario.schedule ?? [])
      .map((command, index) => ({ ...command, scheduleIndex: index }))
      .sort((a, b) => a.at - b.at || a.scheduleIndex - b.scheduleIndex),
    commandSeq: 0,
    eventSeq: 0,
    tasks: [],
    events: [],
    alerts: [],
    faultRecords: [],
    history: [],
    rainfallMmH: rainfallAt(0),
    wtpInflowM3s: HYDRAULICS.wtpTargetM3s * 0.86,
    hydrantLowSec: 0,
    recoveryWatch: {
      requiredSec: RECOVERY_WATCH_SECONDS,
      startedAt: null,
      endsAt: null,
      completedAt: null,
      samples: 0,
      issues: [],
      maxPressure: 0,
      minPressure: 99,
      hydrantLowSec: 0,
      pendingCommandTicks: 0,
      clean: null,
    },
    totals: {
      pumpedM3: 0,
      energyKWh: 0,
      overflowM3: 0,
      burstSpillM3: 0,
      wtpDeficitSec: 0,
    },
    result: null,
  };
}

export function createSimulation(scenario) {
  if (!scenario?.id) throw new Error('A scenario is required');
  const state = buildInitialState(scenario);
  addEvent(state, 'info', 'SIM_START', `开始演练：${scenario.name}`);
  updateHydraulicPreview(state);
  captureHistory(state);
  return state;
}

export function addEvent(state, level, code, message) {
  state.eventSeq += 1;
  const event = {
    id: `EV-${String(state.eventSeq).padStart(4, '0')}`,
    atSec: state.timeSec,
    clock: formatClock(state.timeSec),
    level,
    code,
    message,
  };
  state.events.push(event);
  if (state.events.length > 240) state.events.shift();
  return event;
}

export function commandDelay(command) {
  if (command.type === 'setPump') return STATIONS[command.station].delaySec;
  if (command.type === 'setGate') return RESERVOIRS[command.reservoir].delaySec;
  if (command.type === 'setPriority') return 90;
  if (command.type === 'isolateBurst') return 30;
  if (command.type === 'repairBurst') return 180;
  return 0;
}

export function enqueueCommand(state, command, source = 'operator') {
  if (state.result) return null;
  const seq = state.commandSeq + 1;
  const target = command.station ?? command.reservoir ?? command.segment ?? 'SYSTEM';
  const value = command.value ?? command.order?.join('>') ?? null;
  const task = {
    seq,
    taskId: `T-${String(seq).padStart(3, '0')}`,
    type: command.type,
    target,
    value,
    issuedAt: state.timeSec,
    effectiveAt: state.timeSec + commandDelay(command),
    appliedAt: null,
    status: 'queued',
    source,
    payload: structuredClone(command),
  };
  state.commandSeq = seq;
  state.pendingCommands.push(task);
  state.tasks.push(task);
  addEvent(
    state,
    'info',
    'TASK_QUEUED',
    `${task.taskId} ${commandLabel(command)}，执行延迟 ${commandDelay(command)} 秒`,
  );
  return task;
}

export function commandLabel(command) {
  if (command.type === 'setPump') return `设定 ${command.station} 泵速 ${command.value}%`;
  if (command.type === 'setGate') return `设定 ${command.reservoir} 闸门 ${command.value}%`;
  if (command.type === 'setPriority') return `调整蓄水优先级 ${command.order.join(' > ')}`;
  if (command.type === 'isolateBurst') return `隔离 ${command.segment} 爆管段`;
  if (command.type === 'repairBurst') return `修复 ${command.segment} 爆管段`;
  if (command.type === 'ackAlarm') return '确认当前警报';
  return command.type;
}

function applyTask(state, task) {
  const command = task.payload;
  let applied = true;
  if (command.type === 'setPump' && STATIONS[command.station]) {
    state.pumps[command.station].targetSpeed = clamp(command.value, 0, 100);
  } else if (command.type === 'setGate' && RESERVOIRS[command.reservoir]) {
    state.reservoirs[command.reservoir].targetGate = clamp(command.value, 0, 100);
  } else if (command.type === 'setPriority') {
    const valid = command.order?.length === RESERVOIR_IDS.length
      && new Set(command.order).size === RESERVOIR_IDS.length
      && command.order.every((id) => RESERVOIRS[id]);
    if (valid) state.priority = [...command.order];
    else applied = false;
  } else if (command.type === 'isolateBurst') {
    if (state.burst?.segment === command.segment && state.burst.status === 'active') {
      state.burst.status = 'isolated';
      state.burst.isolatedAt = state.timeSec;
      recordBurstResolution(state, 'isolated');
      addEvent(state, 'warn', 'BURST_ISOLATED', `${command.segment} 爆管段已隔离，进入降载重路由`);
    } else {
      applied = false;
    }
  } else if (command.type === 'repairBurst') {
    if (state.burst?.segment === command.segment && state.burst.status === 'isolated') {
      state.burst.status = 'repaired';
      state.burst.repairedAt = state.timeSec;
      startRecoveryWatch(state);
      recordBurstResolution(state, 'repaired');
      addEvent(state, 'success', 'BURST_REPAIRED', `${command.segment} 修复完成，开始 30 分钟恢复观察`);
    } else {
      applied = false;
    }
  } else if (command.type === 'ackAlarm') {
    state.alerts = state.alerts.filter((alert) => alert.severity !== 'info');
  } else {
    applied = false;
  }
  return applied;
}

function processTaskQueues(state) {
  while (state.scheduledCommands.length && state.scheduledCommands[0].at <= state.timeSec) {
    const scheduled = state.scheduledCommands.shift();
    const { at, scheduleIndex, ...command } = scheduled;
    enqueueCommand(state, command, 'scenario');
  }

  for (const task of state.pendingCommands) {
    if (task.status !== 'queued' || task.effectiveAt > state.timeSec) continue;
    const applied = applyTask(state, task);
    task.status = applied ? 'applied' : 'rejected';
    task.appliedAt = state.timeSec;
    if (!applied) addEvent(state, 'warn', 'TASK_REJECTED', `${task.taskId} 执行条件不满足`);
  }
  state.pendingCommands = state.pendingCommands.filter((task) => task.status === 'queued');
}

export function compactSnapshot(state) {
  return {
    timeSec: state.timeSec,
    clock: formatClock(state.timeSec),
    pressure: Object.fromEntries(ZONE_IDS.map((id) => [id, round(state.zones[id].pressure)])),
    pumpSpeeds: Object.fromEntries(STATION_IDS.map((id) => [id, round(state.pumps[id].speed, 1)])),
    wetWellLevels: Object.fromEntries(
      STATION_IDS.map((id) => [id, round(state.wetWells[id].level, 3)]),
    ),
    reservoirLevels: Object.fromEntries(
      RESERVOIR_IDS.map((id) => [id, round(state.reservoirs[id].level, 3)]),
    ),
    facilityFloodM3: Object.fromEntries(
      Object.keys(FACILITIES).map((id) => [id, round(state.facilities[id].floodM3)]),
    ),
    wtpInflowM3s: round(state.wtpInflowM3s),
    totalPumpedM3: round(state.totals.pumpedM3),
    pendingCommands: state.pendingCommands.length,
    burst: state.burst ? { ...state.burst } : null,
  };
}

function triggerBurst(state, segmentId, cause) {
  if (state.burst) return;
  const before = compactSnapshot(state);
  const segment = PIPE_SEGMENTS[segmentId];
  state.burst = {
    segment: segment.id,
    name: segment.name,
    zone: segment.zone,
    station: segment.station,
    status: 'active',
    detectedAt: state.timeSec,
    detectedClock: formatClock(state.timeSec),
    cause,
    isolatedAt: null,
    repairedAt: null,
    spillM3: 0,
  };
  state.zones[segment.zone].pressure = Math.max(0, state.zones[segment.zone].pressure - 1.15);
  const incident = {
    id: `INC-${String(state.faultRecords.length + 1).padStart(3, '0')}`,
    type: 'pipe_burst',
    segment: segment.id,
    segmentName: segment.name,
    detectedAt: state.timeSec,
    detectedClock: formatClock(state.timeSec),
    before,
    after: compactSnapshot(state),
    resolution: null,
  };
  state.faultRecords.push(incident);
  addEvent(state, 'critical', 'PIPE_BURST', `${segment.name} 压力超限爆管，${segment.station} 泵站降效`);
}

function recordBurstResolution(state, resolution) {
  const incident = state.faultRecords.at(-1);
  if (!incident || incident.segment !== state.burst?.segment) return;
  incident.resolution = {
    ...(incident.resolution ?? {}),
    [resolution]: {
      atSec: state.timeSec,
      clock: formatClock(state.timeSec),
      snapshot: compactSnapshot(state),
    },
  };
}

function startRecoveryWatch(state) {
  const watch = state.recoveryWatch;
  if (watch.startedAt !== null) return;
  watch.startedAt = state.timeSec;
  watch.endsAt = state.timeSec + watch.requiredSec;
  addEvent(state, 'info', 'RECOVERY_WATCH', `恢复观察开始，固定窗口 ${watch.requiredSec / 60} 分钟`);
}

function zonePressureAt(state, zoneId, rain) {
  const zone = ZONES[zoneId];
  const pumpAverage = zone.pumps.reduce((sum, id) => sum + state.pumps[id].speed, 0) / zone.pumps.length;
  const reservoirAverage = zone.reservoirs.reduce(
    (sum, id) => sum + state.reservoirs[id].level,
    0,
  ) / zone.reservoirs.length;
  const stormRelief = (rain / 45) * 0.55;
  let pressure = zone.basePressure
    + (pumpAverage / 100) * 7.25
    + (reservoirAverage - 0.4) * 1.9
    - stormRelief;
  if (state.burst?.zone === zoneId) {
    pressure -= state.burst.status === 'active' ? 1.15 : 0.25;
  }
  return clamp(pressure, 0, 12);
}

function updateHydraulicPreview(state) {
  for (const zoneId of ZONE_IDS) {
    state.zones[zoneId].pressure = round(zonePressureAt(state, zoneId, state.rainfallMmH), 3);
  }
}

function stationEfficiency(state, stationId) {
  if (state.burst?.station !== stationId) return 1;
  return state.burst.status === 'active' ? 0.58 : 0.86;
}

function addFacilityWater(state, facilityId, volumeM3, source) {
  if (volumeM3 <= 0) return;
  const facility = state.facilities[facilityId];
  const wasFlooded = facility.flooded;
  facility.floodM3 += volumeM3;
  facility.peakFloodM3 = Math.max(facility.peakFloodM3, facility.floodM3);
  if (!facility.flooded && facility.floodM3 >= facility.floodLimitM3) {
    facility.flooded = true;
    facility.floodedAt = state.timeSec;
    addEvent(state, 'critical', 'FACILITY_FLOODED', `${facility.name} 进水，触发任务失败`);
  } else if (!wasFlooded && facility.floodM3 > facility.floodLimitM3 * 0.55) {
    const recent = state.events.at(-1);
    if (recent?.code !== 'FACILITY_WATER') {
      addEvent(state, 'warn', 'FACILITY_WATER', `${facility.name} 出现积水（${source}）`);
    }
  }
}

function updatePumpsAndWater(state, rain) {
  let totalPumpFlow = 0;
  const overflowMap = { P1: 'D1', P2: 'D2', P3: 'D2', P4: 'D3' };

  for (const id of STATION_IDS) {
    const pump = state.pumps[id];
    const delta = clamp(pump.targetSpeed - pump.speed, -HYDRAULICS.pumpRampPerTick, HYDRAULICS.pumpRampPerTick);
    pump.speed = clamp(pump.speed + delta, 0, 100);
    const efficiency = stationEfficiency(state, id);
    const flow = (pump.speed / 100) * pump.capacityM3s * efficiency;
    pump.flowM3s = flow;
    const pumpedDelta = flow * TICK_SECONDS;
    const energyDelta = (pump.capacityM3s * 96) * ((pump.speed / 100) ** 3) * (TICK_SECONDS / 3600);
    pump.pumpedM3 += pumpedDelta;
    pump.energyKWh += energyDelta;
    state.totals.pumpedM3 += pumpedDelta;
    state.totals.energyKWh += energyDelta;
    pump.minSpeed = Math.min(pump.minSpeed, pump.speed);
    pump.maxSpeed = Math.max(pump.maxSpeed, pump.speed);
    pump.speedSum += pump.speed;
    pump.samples += 1;

    const runoff = (rain / 1000) * (pump.catchmentM2 / 3600);
    const inflow = pump.baseInflowM3s + runoff;
    const well = state.wetWells[id];
    let nextVolume = clamp(well.volumeM3 + (inflow - flow) * TICK_SECONDS, 0, well.capacityM3);
    const overflowAt = well.capacityM3 * 0.9;
    if (nextVolume > overflowAt) {
      const overflow = nextVolume - overflowAt;
      nextVolume = overflowAt;
      well.overflowTotalM3 += overflow;
      state.totals.overflowM3 += overflow;
      addFacilityWater(state, overflowMap[id], overflow, `${pump.short}湿井溢流`);
    }
    well.volumeM3 = nextVolume;
    well.level = nextVolume / well.capacityM3;
    totalPumpFlow += flow;
  }

  const weights = priorityWeights(state.priority);
  let reservoirInletTotal = 0;
  let reservoirOutflowTotal = 0;
  for (const id of RESERVOIR_IDS) {
    const reservoir = state.reservoirs[id];
    const gateDelta = clamp(reservoir.targetGate - reservoir.gate, -5, 5);
    reservoir.gate = clamp(reservoir.gate + gateDelta, 0, 100);
    const inlet = totalPumpFlow
      * HYDRAULICS.storageFraction
      * weights[id]
      * (reservoir.gate / 100);
    const outflow = (0.035 + reservoir.level * 0.24) * 1.55;
    reservoir.inflowM3s = inlet;
    reservoir.outflowM3s = outflow;
    reservoir.inflowTotalM3 += inlet * TICK_SECONDS;
    reservoir.outflowTotalM3 += outflow * TICK_SECONDS;
    let nextVolume = reservoir.volumeM3 + (inlet - outflow) * TICK_SECONDS;
    const overflowAt = reservoir.capacityM3 * 0.94;
    if (nextVolume > overflowAt) {
      const overflow = nextVolume - overflowAt;
      nextVolume = overflowAt;
      reservoir.spillTotalM3 += overflow;
      state.totals.overflowM3 += overflow;
      addFacilityWater(state, reservoir.facilityId, overflow, `${reservoir.short}蓄水池溢流`);
    }
    reservoir.volumeM3 = clamp(nextVolume, 0, reservoir.capacityM3);
    reservoir.level = reservoir.volumeM3 / reservoir.capacityM3;
    reservoir.peakLevel = Math.max(reservoir.peakLevel, reservoir.level);
    reservoirInletTotal += inlet;
    reservoirOutflowTotal += outflow;
  }

  state.wtpInflowM3s = Math.max(0, (totalPumpFlow - reservoirInletTotal) + reservoirOutflowTotal);
  if (state.wtpInflowM3s < HYDRAULICS.wtpTargetM3s * 0.85) {
    state.totals.wtpDeficitSec += TICK_SECONDS;
  }

  if (state.burst?.status === 'active') {
    const stationFlow = state.pumps[state.burst.station].flowM3s;
    const spill = stationFlow * 0.035 * TICK_SECONDS;
    state.burst.spillM3 += spill;
    state.totals.burstSpillM3 += spill;
    addFacilityWater(state, 'D2', spill * 0.8, '爆管外泄');
    addFacilityWater(state, 'WTP', spill * 0.2, '爆管回流');
  }
}

function updatePressureAndHazards(state) {
  let anyLow = false;
  for (const zoneId of ZONE_IDS) {
    const zone = state.zones[zoneId];
    const pressure = zonePressureAt(state, zoneId, state.rainfallMmH);
    zone.pressure = round(pressure, 3);
    zone.minPressure = Math.min(zone.minPressure, pressure);
    zone.maxPressure = Math.max(zone.maxPressure, pressure);
    zone.pressureSum += pressure;
    zone.samples += 1;
    if (pressure >= PRESSURE.burstAt && !state.burst) {
      zone.exposureSec += TICK_SECONDS;
      if (zone.exposureSec >= PRESSURE.burstExposureSec) {
        const segment = zoneId === 'north' ? 'S1' : zoneId === 'central' ? 'S2' : 'S4';
        triggerBurst(state, segment, `持续超压 ${(zone.exposureSec / 60).toFixed(0)} 分钟`);
        zone.exposureSec = 0;
      }
    } else {
      zone.exposureSec = Math.max(0, zone.exposureSec - TICK_SECONDS / 2);
    }

    zone.hydrantAvailable = pressure >= PRESSURE.lowAlert;
    if (!zone.hydrantAvailable) {
      zone.lowPressureSec += TICK_SECONDS;
      anyLow = true;
    }
  }
  if (anyLow) state.hydrantLowSec += TICK_SECONDS;
}

function makeAlert(previous, code, severity, message, target = 'SYSTEM') {
  const old = previous.find((alert) => alert.code === code && alert.target === target);
  return { code, severity, message, target, since: old?.since ?? 0 };
}

function updateAlerts(state) {
  const previous = state.alerts;
  const alerts = [];
  if (state.burst?.status === 'active') {
    alerts.push(makeAlert(previous, 'PIPE_BURST', 'critical', `${state.burst.name} 爆管，正在外泄`, state.burst.segment));
  } else if (state.burst?.status === 'isolated') {
    alerts.push(makeAlert(previous, 'BURST_ISOLATED', 'warning', `${state.burst.name} 已隔离，等待修复`, state.burst.segment));
  }

  for (const zoneId of ZONE_IDS) {
    const zone = state.zones[zoneId];
    if (zone.pressure >= PRESSURE.highAlert) {
      alerts.push(makeAlert(previous, 'HIGH_PRESSURE', 'warning', `${zone.name} 压力 ${zone.pressure.toFixed(2)} bar`, zoneId));
    }
    if (zone.pressure < PRESSURE.lowCritical) {
      alerts.push(makeAlert(previous, 'HYDRANT_LOST', 'critical', `${zone.name} 消防栓压力不足`, zoneId));
    } else if (zone.pressure < PRESSURE.lowAlert) {
      alerts.push(makeAlert(previous, 'LOW_PRESSURE', 'warning', `${zone.name} 低压，消防余量下降`, zoneId));
    }
  }

  for (const id of STATION_IDS) {
    const level = state.wetWells[id].level;
    if (level >= 0.9) {
      alerts.push(makeAlert(previous, 'WELL_OVERFLOW', 'critical', `${state.pumps[id].short}湿井溢流`, id));
    } else if (level >= 0.82) {
      alerts.push(makeAlert(previous, 'WELL_HIGH', 'warning', `${state.pumps[id].short}湿井高水位`, id));
    }
  }

  for (const id of RESERVOIR_IDS) {
    if (state.reservoirs[id].level >= 0.91) {
      alerts.push(makeAlert(previous, 'RESERVOIR_HIGH', 'warning', `${state.reservoirs[id].short}蓄水池接近溢流`, id));
    }
  }

  for (const facility of Object.values(state.facilities)) {
    if (facility.flooded) {
      alerts.push(makeAlert(previous, 'FACILITY_FLOODED', 'critical', `${facility.name} 已进水`, facility.id));
    }
  }

  if (state.result?.passed === false) {
    alerts.push(makeAlert(previous, 'RUN_FAILED', 'critical', state.result.reason, 'RESULT'));
  }
  state.alerts = alerts.map((alert) => ({ ...alert, since: previous.find(
    (old) => old.code === alert.code && old.target === alert.target,
  )?.since ?? state.timeSec }));
}

function addWatchIssue(state, code, message) {
  const watch = state.recoveryWatch;
  if (watch.issues.some((issue) => issue.code === code)) return;
  watch.issues.push({ code, message, atSec: state.timeSec, clock: formatClock(state.timeSec) });
}

function updateRecoveryWatch(state) {
  const watch = state.recoveryWatch;
  if (watch.startedAt === null) return;
  if (state.timeSec <= watch.endsAt) {
    watch.samples += 1;
    const pressures = ZONE_IDS.map((id) => state.zones[id].pressure);
    watch.maxPressure = Math.max(watch.maxPressure, ...pressures);
    watch.minPressure = Math.min(watch.minPressure, ...pressures);
    if (pressures.some((pressure) => pressure >= PRESSURE.burstAt)) {
      addWatchIssue(state, 'PRESSURE_HIGH', '观察窗口内再次出现爆管阈值压力');
    }
    if (pressures.some((pressure) => pressure < PRESSURE.lowAlert)) {
      watch.hydrantLowSec += TICK_SECONDS;
      addWatchIssue(state, 'PRESSURE_LOW', '观察窗口内消防余量不足');
    }
    if (state.pendingCommands.length > 0) {
      watch.pendingCommandTicks += TICK_SECONDS;
      addWatchIssue(state, 'PENDING_COMMANDS', '观察窗口内仍有未完成指令');
    }
    if (state.burst?.status === 'active') {
      addWatchIssue(state, 'BURST_ACTIVE', '观察窗口内爆管仍处于活动状态');
    }
    if (Object.values(state.facilities).some((facility) => facility.flooded)) {
      addWatchIssue(state, 'FACILITY_FLOOD', '观察窗口内关键设施进水');
    }
  }
  if (watch.completedAt === null && state.timeSec >= watch.endsAt) {
    watch.completedAt = state.timeSec;
    watch.issues = watch.issues.filter((issue) => issue.code !== 'PENDING_COMMANDS' || watch.pendingCommandTicks > 0);
    watch.clean = watch.issues.length === 0 && watch.pendingCommandTicks === 0;
    addEvent(
      state,
      watch.clean ? 'success' : 'warn',
      'RECOVERY_WATCH_DONE',
      watch.clean ? '恢复观察通过：无残留告警、积压指令或资源异常' : '恢复观察发现残留状态',
    );
  }
}

function captureHistory(state) {
  state.history.push({
    t: state.timeSec,
    rain: state.rainfallMmH,
    pressure: Object.fromEntries(ZONE_IDS.map((id) => [id, round(state.zones[id].pressure, 2)])),
    wetWell: Object.fromEntries(STATION_IDS.map((id) => [id, round(state.wetWells[id].level, 3)])),
    reservoir: Object.fromEntries(RESERVOIR_IDS.map((id) => [id, round(state.reservoirs[id].level, 3)])),
    wtpInflow: round(state.wtpInflowM3s, 2),
    alerts: state.alerts.filter((alert) => alert.severity !== 'info').length,
  });
}

export function buildStationSummaries(state) {
  return STATION_IDS.map((id) => {
    const pump = state.pumps[id];
    return {
      station: id,
      name: pump.name,
      avgSpeedPct: round(pump.speedSum / Math.max(1, pump.samples), 1),
      minSpeedPct: round(pump.minSpeed, 1),
      maxSpeedPct: round(pump.maxSpeed, 1),
      pumpedM3: round(pump.pumpedM3, 1),
      energyKWh: round(pump.energyKWh, 1),
      overflowM3: round(state.wetWells[id].overflowTotalM3, 1),
      finalWetWellLevel: round(state.wetWells[id].level, 3),
      incidents: state.faultRecords.filter((record) => record.segment && PIPE_SEGMENTS[record.segment]?.station === id).length,
    };
  });
}

export function buildReservoirSummaries(state) {
  return RESERVOIR_IDS.map((id) => {
    const reservoir = state.reservoirs[id];
    return {
      reservoir: id,
      name: reservoir.name,
      gatePct: round(reservoir.gate, 1),
      initialLevel: round(reservoir.initialVolumeM3 / reservoir.capacityM3, 3),
      finalLevel: round(reservoir.level, 3),
      peakLevel: round(reservoir.peakLevel, 3),
      inflowM3: round(reservoir.inflowTotalM3, 1),
      outflowM3: round(reservoir.outflowTotalM3, 1),
      spillM3: round(reservoir.spillTotalM3, 1),
    };
  });
}

function buildFacilitySummaries(state) {
  return Object.values(state.facilities).map((facility) => ({
    facility: facility.id,
    name: facility.name,
    kind: facility.kind,
    floodM3: round(facility.floodM3, 2),
    depthM: round((facility.floodM3 / facility.floodLimitM3) * 0.25, 3),
    flooded: facility.flooded,
    floodedAt: facility.flooded ? formatClock(facility.floodedAt) : null,
    limitM3: facility.floodLimitM3,
  }));
}

export function finalizeRun(state, passed, reason) {
  if (state.result) return state.result;
  const floodedFacilities = Object.values(state.facilities)
    .filter((facility) => facility.flooded)
    .map((facility) => facility.id);
  const wtpSamples = state.history.length;
  const averageWtpInflow = wtpSamples
    ? state.history.reduce((sum, sample) => sum + sample.wtpInflow, 0) / wtpSamples
    : state.wtpInflowM3s;
  const checks = {
    completedDuration: state.timeSec >= SIM_DURATION_SECONDS,
    keyFacilitiesDry: floodedFacilities.length === 0,
    wtpInflowAverageM3s: round(averageWtpInflow, 2),
    wtpDeficitSec: state.totals.wtpDeficitSec,
    hydrantLowSec: state.hydrantLowSec,
    burstIncidents: state.faultRecords.length,
    recoveryWatch: {
      requiredSec: state.recoveryWatch.requiredSec,
      startedAt: state.recoveryWatch.startedAt,
      endsAt: state.recoveryWatch.endsAt,
      samples: state.recoveryWatch.samples,
      completed: state.recoveryWatch.completedAt !== null,
      clean: state.recoveryWatch.clean,
      issues: state.recoveryWatch.issues,
    },
  };
  state.result = {
    passed,
    status: passed ? 'passed' : 'failed',
    reason,
    finishedAtSec: state.timeSec,
    finishedClock: formatClock(state.timeSec),
    checks,
    floodedFacilities,
    totals: {
      pumpedM3: round(state.totals.pumpedM3, 1),
      energyKWh: round(state.totals.energyKWh, 1),
      overflowM3: round(state.totals.overflowM3, 1),
      burstSpillM3: round(state.totals.burstSpillM3, 2),
    },
    stationSummaries: buildStationSummaries(state),
    reservoirSummaries: buildReservoirSummaries(state),
    facilitySummaries: buildFacilitySummaries(state),
    taskSequence: state.tasks.map((task) => ({
      taskId: task.taskId,
      type: task.type,
      target: task.target,
      value: task.value,
      issuedAt: task.issuedAt,
      effectiveAt: task.effectiveAt,
      appliedAt: task.appliedAt,
      status: task.status,
      source: task.source,
    })),
    faultRecords: state.faultRecords,
  };
  addEvent(state, passed ? 'success' : 'critical', passed ? 'RUN_PASSED' : 'RUN_FAILED', reason);
  updateAlerts(state);
  return state.result;
}

export function tickSimulation(state) {
  if (state.result) return state.result;
  if (state.timeSec >= SIM_DURATION_SECONDS) {
    return finalizeRun(state, true, '六小时演练完成，关键设施未进水');
  }

  processTaskQueues(state);
  state.rainfallMmH = rainfallAt(state.timeSec);
  updatePumpsAndWater(state, state.rainfallMmH);
  updatePressureAndHazards(state);
  state.tick += 1;
  state.timeSec += TICK_SECONDS;
  updateRecoveryWatch(state);
  updateAlerts(state);
  if (state.tick % 2 === 0 || state.timeSec === SIM_DURATION_SECONDS) captureHistory(state);

  const flooded = Object.values(state.facilities).find((facility) => facility.flooded);
  if (flooded) {
    return finalizeRun(state, false, `${flooded.name} 进水，关键设施保护失败`);
  }
  if (state.timeSec >= SIM_DURATION_SECONDS) {
    return finalizeRun(state, true, '六小时演练完成，关键设施未进水');
  }
  return null;
}

export function runSimulation(scenario, options = {}) {
  const state = createSimulation(scenario);
  const limit = options.untilSec ?? SIM_DURATION_SECONDS;
  while (!state.result && state.timeSec < limit) tickSimulation(state);
  return state;
}
