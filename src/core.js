export const TOTAL_TICKS = 14;
export const CLEAR_THRESHOLD = 82;
export const SCENARIOS = {
  calm: {
    id: "calm",
    name: "平稳夜航",
    code: "CLM-00",
    description: "轻风窗口，适合熟悉设备与航线。",
    winds: [0, 1, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1, 0],
    faultTick: null,
  },
  gust: {
    id: "gust",
    name: "GUST-01 侧风故障",
    code: "GUST-01",
    description: "第 2 段突发强侧风；固定随机种子可重复触发污染与重采。",
    winds: [0, 4, 5, 3, 2, 1, 0, 1, 2, 1, 0, 1, 2, 0],
    faultTick: 2,
  },
};

export const FLOCKS = [
  {
    id: "oystercatcher",
    name: "蛎鹬群",
    call: "oystercatcher",
    color: "#ffcf70",
    route: [0, 0, 0, 1, 1, 2, 2, 1, 0, 0, 1, 1, 2, 2],
  },
  {
    id: "tern",
    name: "燕鸥群",
    call: "tern",
    color: "#7ff3dd",
    route: [0, 1, 1, 0, 1, 1, 2, 2, 2, 1, 0, 0, 1, 1],
  },
  {
    id: "sandpiper",
    name: "滨鹬群",
    call: "sandpiper",
    color: "#ff9f8f",
    route: [0, 1, 2, 2, 0, 0, 1, 1, 1, 2, 2, 2, 0, 0],
  },
];

export const DEVICE_SPECS = {
  R1: { id: "R1", kind: "recorder", label: "录音器 A", zone: 0, power: 75, frequency: 1 },
  R2: { id: "R2", kind: "recorder", label: "录音器 B", zone: 0, power: 75, frequency: 1 },
  R3: { id: "R3", kind: "recorder", label: "录音器 C", zone: 0, power: 75, frequency: 1 },
  D1: { id: "D1", kind: "drone", label: "航拍机 D", zone: 1, power: 80, frequency: 1 },
};

export const ZONE_NAMES = ["北岬", "潮汐湾", "南沙嘴"];

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function roundOne(value) {
  return Math.round(value * 10) / 10;
}

function hashSeed(seed, text) {
  let hash = 2166136261;
  const input = `${seed}:${text}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

export function deterministicJitter(seed, tick, key) {
  return (hashSeed(seed, `${tick}:${key}`) - 0.5) * 1.4;
}

export function deviceConsumption(device) {
  if (device.kind === "drone") {
    return roundOne(1.2 + device.power / 70 + device.frequency * 1.3);
  }
  return roundOne(0.7 + device.power / 80 + device.frequency);
}

export function moveCost(device) {
  return device.kind === "drone" ? 4 : 3;
}

export function coverageRadius(device) {
  const zoneRadius = device.kind === "drone" ? 0.42 + device.power / 120 : 0.22 + device.power / 140;
  return roundOne(Math.max(0.5, zoneRadius));
}

export function windNoiseFactor(wind, frequency) {
  return roundOne(wind * Math.max(2.2, 10 - frequency * 1.7));
}

export function recordingQuality(device, flock, wind, settling) {
  const distance = Math.abs(device.zone - flock.zone);
  const base = 42 + device.power * 0.42 + device.frequency * 5;
  const signalPenalty = roundOne(distance * 8);
  const settlePenalty = settling ? 20 : 0;
  const noisePenalty = windNoiseFactor(wind, device.frequency);
  return roundOne(base - noisePenalty - signalPenalty - settlePenalty);
}

export function trackQuality(device, flock, wind, settling, lightsOn) {
  const distance = Math.abs(device.zone - flock.zone);
  const base = 46 + device.power * 0.43 + device.frequency * 4;
  const signalPenalty = roundOne(distance * 9);
  const noisePenalty = windNoiseFactor(wind, device.frequency);
  const settlePenalty = settling ? 22 : 0;
  const lightPenalty = lightsOn ? 28 : 0;
  return roundOne(base - noisePenalty - signalPenalty - settlePenalty - lightPenalty);
}

export function qualityCheck(kind, quality, details = {}) {
  const threshold = CLEAR_THRESHOLD;
  const checks = [
    {
      id: "wind-noise",
      label: "风噪",
      passed: (details.wind ?? 0) <= 3,
      value: `${details.wind ?? 0} 级`,
    },
    {
      id: "signal",
      label: "信噪比",
      passed: quality >= threshold,
      value: `${quality.toFixed(1)} dB`,
    },
    {
      id: "settling",
      label: "移动沉降",
      passed: !details.settling,
      value: details.settling ? "沉降中" : "稳定",
    },
  ];
  const failed = checks.filter((check) => !check.passed);
  return {
    kind,
    quality,
    threshold,
    checks,
    status: failed.length === 0 ? "clear" : "rejected",
    issues: failed.map((check) => check.label),
  };
}

function clone(value) {
  return structuredClone(value);
}

export function createInitialFlocks() {
  return Object.fromEntries(
    FLOCKS.map((flock) => [
      flock.id,
      {
        id: flock.id,
        name: flock.name,
        zone: flock.route[0],
        routeIndex: 0,
        disturbed: false,
        clear: false,
        clearAt: null,
        attempts: 0,
        retakes: 0,
        lastQuality: null,
        lastStatus: null,
        bestQuality: null,
        checks: null,
      },
    ]),
  );
}

export function createInitialDevices() {
  return Object.fromEntries(
    Object.entries(DEVICE_SPECS).map(([id, spec]) => [
      id,
      {
        id,
        kind: spec.kind,
        label: spec.label,
        zone: spec.zone,
        power: spec.power,
        frequency: spec.frequency,
        battery: 100,
        status: "ready",
        settling: false,
        queuedZone: null,
        lastMovedAt: null,
      },
    ]),
  );
}

export function createGame({ scenarioId = "calm", seed = 20261112 } = {}) {
  if (!SCENARIOS[scenarioId]) {
    throw new Error(`Unknown scenario: ${scenarioId}`);
  }
  const scenario = SCENARIOS[scenarioId];
  return {
    version: 1,
    scenarioId,
    scenarioCode: scenario.code,
    seed,
    tick: 0,
    totalTicks: TOTAL_TICKS,
    status: "planning",
    paused: true,
    outcome: "active",
    wind: scenario.winds[0],
    lightsOn: false,
    disturbanceCount: 0,
    eventSeq: 0,
    events: [],
    flocks: createInitialFlocks(),
    devices: createInitialDevices(),
    tracks: {
      attempts: 0,
      valid: {},
      lastQuality: null,
      lastStatus: null,
      checks: null,
    },
    retakeQueue: [],
    observations: [],
    recoveryObservation: {
      active: false,
      required: 4,
      completed: 0,
      startTick: null,
      passed: false,
      failures: [],
      baselineBattery: null,
    },
    lastStep: null,
    fault: {
      active: false,
      status: "idle",
      scenarioId,
      triggeredAt: null,
      recoveredAt: null,
      before: null,
      after: null,
      recoveryState: null,
      reason: null,
    },
  };
}

export function getScenario(state) {
  return SCENARIOS[state.scenarioId];
}

export function getWind(state, tick = state.tick + 1) {
  const winds = getScenario(state).winds;
  return winds[clamp(tick - 1, 0, winds.length - 1)];
}

function logEvent(state, tick, type, message, data = {}) {
  state.eventSeq += 1;
  state.events.push({
    seq: state.eventSeq,
    tick,
    type,
    message,
    data,
  });
}

export function keyStateSnapshot(state) {
  return clone({
    tick: state.tick,
    status: state.status,
    outcome: state.outcome,
    wind: state.wind,
    lightsOn: state.lightsOn,
    disturbanceCount: state.disturbanceCount,
    devices: Object.fromEntries(
      Object.values(state.devices).map((device) => [
        device.id,
        {
          zone: device.zone,
          queuedZone: device.queuedZone,
          battery: device.battery,
          power: device.power,
          frequency: device.frequency,
          status: device.status,
          settling: device.settling,
        },
      ]),
    ),
    recordings: Object.fromEntries(
      Object.values(state.flocks).map((flock) => [
        flock.id,
        {
          zone: flock.zone,
          clear: flock.clear,
          attempts: flock.attempts,
          retakes: flock.retakes,
          lastQuality: flock.lastQuality,
          lastStatus: flock.lastStatus,
        },
      ]),
    ),
    tracks: {
      attempts: state.tracks.attempts,
      valid: clone(state.tracks.valid),
      lastQuality: state.tracks.lastQuality,
      lastStatus: state.tracks.lastStatus,
    },
    pendingRetakes: state.retakeQueue.length,
    fault: {
      active: state.fault.active,
      status: state.fault.status,
      triggeredAt: state.fault.triggeredAt,
      recoveredAt: state.fault.recoveredAt,
    },
  });
}

export function configureDevice(state, deviceId, patch) {
  const next = clone(state);
  const device = next.devices[deviceId];
  if (!device || next.status === "completed") return next;
  if (patch.power !== undefined) device.power = clamp(roundOne(patch.power), 20, 100);
  if (patch.frequency !== undefined) device.frequency = clamp(Math.round(patch.frequency), 1, 3);
  return next;
}

export function queueMove(state, deviceId, zone) {
  const next = clone(state);
  const device = next.devices[deviceId];
  if (!device || next.status === "completed" || !Number.isInteger(zone) || zone < 0 || zone > 2) {
    return next;
  }
  if (device.zone === zone) {
    device.queuedZone = null;
  } else {
    device.queuedZone = zone;
  }
  return next;
}

export function setLights(state, lightsOn) {
  const next = clone(state);
  if (next.status === "completed") return next;
  next.lightsOn = Boolean(lightsOn);
  return next;
}

function consumeAndMoveDevices(state, tick) {
  for (const device of Object.values(state.devices)) {
    const consumption = deviceConsumption(device);
    device.settling = false;
    if (device.battery <= 0) {
      device.status = "offline";
      logEvent(state, tick, "DEVICE_OFFLINE", `${device.label} 电量耗尽，未参与本段监测。`, {
        deviceId: device.id,
      });
      continue;
    }
    device.battery = roundOne(Math.max(0, device.battery - consumption));
    if (device.battery <= 0) {
      device.status = "offline";
      logEvent(state, tick, "DEVICE_OFFLINE", `${device.label} 电量耗尽。`, { deviceId: device.id });
      continue;
    }
    if (device.queuedZone !== null) {
      const cost = moveCost(device);
      if (device.battery >= cost) {
        device.battery = roundOne(device.battery - cost);
        device.zone = device.queuedZone;
        device.queuedZone = null;
        device.settling = true;
        device.lastMovedAt = tick;
        device.status = "settling";
        logEvent(
          state,
          tick,
          "DEVICE_MOVED",
          `${device.label} 移至${ZONE_NAMES[device.zone]}，下一段进入沉降。`,
          { deviceId: device.id, zone: device.zone, moveCost: cost },
        );
      } else {
        device.status = "low-power";
        logEvent(state, tick, "MOVE_REJECTED", `${device.label} 电量不足以移动。`, {
          deviceId: device.id,
          battery: device.battery,
          moveCost: cost,
        });
      }
    } else if (device.status === "settling") {
      device.status = "ready";
    }
  }
}

function updateFlocks(state, tick) {
  for (const flock of Object.values(state.flocks)) {
    const baseZone = FLOCKS.find((item) => item.id === flock.id).route[tick - 1];
    flock.routeIndex = tick - 1;
    flock.disturbed = state.lightsOn;
    flock.zone = state.lightsOn ? (baseZone + 1) % 3 : baseZone;
  }
  if (state.lightsOn) {
    state.disturbanceCount += 1;
    logEvent(state, tick, "DISTURBANCE", "航标灯开启，鸟群偏离原航线；本段不再满足“不惊扰”条件。", {
      zones: Object.fromEntries(Object.values(state.flocks).map((flock) => [flock.id, flock.zone])),
    });
  }
}

function triggerFaultIfNeeded(state, tick, preSnapshot, sample, flock) {
  if (state.fault.status !== "armed" || sample.status !== "rejected") return;
  state.fault.active = true;
  state.fault.status = "triggered";
  state.fault.triggeredAt = tick;
  state.fault.before = preSnapshot;
  state.fault.reason = `${flock.name}录音被 ${state.wind} 级侧风污染，已进入重采队列。`;
  logEvent(state, tick, "FAULT_TRIGGERED", state.fault.reason, {
    flockId: flock.id,
    quality: sample.quality,
    checks: sample.checks,
  });
}

function collectRecordings(state, tick, preSnapshot) {
  const usedRecorders = new Set();
  for (const flock of Object.values(state.flocks).filter((item) => !item.clear)) {
    const candidates = Object.values(state.devices)
      .filter((device) => {
        if (device.kind !== "recorder" || device.status === "offline" || usedRecorders.has(device.id)) {
          return false;
        }
        return Math.abs(device.zone - flock.zone) <= coverageRadius(device);
      })
      .map((device) => ({
        device,
        projected: recordingQuality(device, flock, state.wind, device.settling),
      }))
      .sort((left, right) => right.projected - left.projected || left.device.id.localeCompare(right.device.id));

    if (candidates.length === 0) {
      logEvent(state, tick, "NO_RECORDER_COVERAGE", `${flock.name}不在任何录音器覆盖内。`, {
        flockId: flock.id,
        zone: flock.zone,
      });
      continue;
    }

    const { device } = candidates[0];
    usedRecorders.add(device.id);
    const isRetake = flock.lastStatus === "rejected";
    const quality = roundOne(
      recordingQuality(device, flock, state.wind, device.settling) +
        deterministicJitter(state.seed, tick, `${device.id}:${flock.id}:rec`),
    );
    const sample = qualityCheck("recording", quality, {
      wind: state.wind,
      frequency: device.frequency,
      settling: device.settling,
      deviceId: device.id,
      flockId: flock.id,
      isRetake,
    });
    flock.attempts += 1;
    flock.lastQuality = quality;
    flock.lastStatus = sample.status;
    flock.checks = sample.checks;
    flock.bestQuality = flock.bestQuality === null ? quality : Math.max(flock.bestQuality, quality);

    if (sample.status === "clear") {
      flock.clear = true;
      flock.clearAt = tick;
      state.retakeQueue = state.retakeQueue.filter((item) => item.flockId !== flock.id);
      logEvent(
        state,
        tick,
        "RECORDING_CLEAR",
        `${device.label} 捕获${flock.name}清晰录音（${quality.toFixed(1)} dB）。`,
        { deviceId: device.id, flockId: flock.id, quality, isRetake, checks: sample.checks },
      );
    } else {
      if (isRetake) flock.retakes += 1;
      const existing = state.retakeQueue.find((item) => item.flockId === flock.id);
      if (existing) {
        existing.tick = tick;
        existing.quality = quality;
        existing.issues = sample.issues;
      } else {
        state.retakeQueue.push({
          flockId: flock.id,
          tick,
          quality,
          issues: sample.issues,
        });
      }
      logEvent(
        state,
        tick,
        "QUALITY_REJECTED",
        `${flock.name}录音未通过质检：${sample.issues.join("、")}；已排队重采。`,
        { deviceId: device.id, flockId: flock.id, quality, checks: sample.checks },
      );
    }
    triggerFaultIfNeeded(state, tick, preSnapshot, sample, flock);
  }
}

function collectAerialTrack(state, tick) {
  if (Object.keys(state.tracks.valid).length >= 2) return;
  const drone = state.devices.D1;
  if (drone.status === "offline") return;
  const candidates = Object.values(state.flocks)
    .filter((flock) => !state.tracks.valid[flock.id])
    .filter((flock) => Math.abs(drone.zone - flock.zone) <= coverageRadius(drone))
    .map((flock) => ({
      flock,
      projected: trackQuality(drone, flock, state.wind, drone.settling, state.lightsOn),
    }))
    .sort((left, right) => right.projected - left.projected || left.flock.id.localeCompare(right.flock.id));

  if (candidates.length === 0) {
    logEvent(state, tick, "NO_DRONE_COVERAGE", "航拍机范围内没有待建立航迹的鸟群。", {
      zone: drone.zone,
    });
    return;
  }

  const { flock } = candidates[0];
  const quality = roundOne(
    trackQuality(drone, flock, state.wind, drone.settling, state.lightsOn) +
      deterministicJitter(state.seed, tick, `D1:${flock.id}:track`),
  );
  const result = qualityCheck("track", quality, {
    wind: state.wind,
    frequency: drone.frequency,
    settling: drone.settling,
    lightsOn: state.lightsOn,
    deviceId: drone.id,
    flockId: flock.id,
  });
  state.tracks.attempts += 1;
  state.tracks.lastQuality = quality;
  state.tracks.lastStatus = result.status;
  state.tracks.checks = result.checks;
  if (result.status === "clear") {
    state.tracks.valid[flock.id] = { tick, quality, zone: flock.zone };
    logEvent(state, tick, "TRACK_VALID", `航拍机建立${flock.name}有效航迹（${quality.toFixed(1)} dB）。`, {
      flockId: flock.id,
      quality,
      checks: result.checks,
    });
  } else {
    logEvent(state, tick, "TRACK_REJECTED", `${flock.name}航迹质量不足：${result.issues.join("、")}。`, {
      flockId: flock.id,
      quality,
      checks: result.checks,
    });
  }
}

function syncFaultRecovery(state, tick) {
  if (!state.fault.active || state.retakeQueue.length > 0) return;
  state.fault.active = false;
  state.fault.status = "recovered";
  state.fault.recoveredAt = tick;
  state.fault.recoveryState = keyStateSnapshot(state);
  state.recoveryObservation.active = true;
  state.recoveryObservation.startTick = tick;
  state.recoveryObservation.baselineBattery = Object.fromEntries(
    Object.values(state.devices).map((device) => [device.id, device.battery]),
  );
  logEvent(state, tick, "FAULT_RECOVERED", "重采队列清空，故障解除；开始 4 段固定恢复观察。", {
    startTick: tick,
    required: state.recoveryObservation.required,
  });
}

function expectedStepDrain(state, device) {
  let expected = deviceConsumption(device);
  if (device.lastMovedAt === state.tick) expected += moveCost(device);
  return roundOne(expected);
}

function observeRecoveryWindow(state, tick, preState) {
  const observation = state.recoveryObservation;
  if (!observation.active || tick <= observation.startTick) return;
  const failures = [];
  const errorTypes = new Set(["DEVICE_OFFLINE", "MOVE_REJECTED", "FAULT_TRIGGERED"]);
  const stepErrors = state.events.filter((event) => event.tick === tick && errorTypes.has(event.type));
  if (state.retakeQueue.length > 0) failures.push(`仍有 ${state.retakeQueue.length} 个重采任务`);
  if (state.fault.active) failures.push("故障标志未清除");
  if (stepErrors.length > 0) failures.push(`本段新增 ${stepErrors.length} 个错误事件`);

  const batteryUsed = {};
  const expectedBattery = {};
  for (const device of Object.values(state.devices)) {
    const before = preState.devices[device.id];
    const used = roundOne(before.battery - device.battery);
    const expected = expectedStepDrain(state, device);
    batteryUsed[device.id] = used;
    expectedBattery[device.id] = expected;
    if (used > expected + 0.11) failures.push(`${device.id} 出现额外 ${roundOne(used - expected)}% 耗电`);
  }

  observation.completed += 1;
  const record = {
    tick,
    pendingRetakes: state.retakeQueue.length,
    faultActive: state.fault.active,
    errorEvents: stepErrors.length,
    batteryUsed,
    expectedBattery,
    passed: failures.length === 0,
    failures,
  };
  state.observations.push(record);
  if (!record.passed) observation.failures.push(...failures.map((failure) => `第 ${tick} 段：${failure}`));
  logEvent(
    state,
    tick,
    record.passed ? "OBSERVATION_TICK" : "OBSERVATION_FAILED",
    `恢复观察 ${observation.completed}/${observation.required}：${
      record.passed ? "无残留任务或错误" : failures.join("；")
    }。`,
    record,
  );
  if (observation.completed >= observation.required) {
    observation.active = false;
    observation.passed = observation.failures.length === 0;
    logEvent(
      state,
      tick,
      observation.passed ? "OBSERVATION_PASSED" : "OBSERVATION_FAILED",
      observation.passed ? "固定恢复观察通过。" : "固定恢复观察发现残留问题。",
      { failures: observation.failures },
    );
  }
}

export function evaluateOutcome(state, final = false) {
  const recordings = Object.values(state.flocks).filter((flock) => flock.clear);
  const trackCount = Object.keys(state.tracks.valid).length;
  const recoveryRequired = state.fault.triggeredAt !== null;
  const recoveryOk = !recoveryRequired || state.recoveryObservation.passed;
  const goals = {
    recordings: recordings.length,
    recordingsRequired: 3,
    tracks: trackCount,
    tracksRequired: 2,
    disturbances: state.disturbanceCount,
    recoveryOk,
  };
  const success =
    recordings.length >= 3 && trackCount >= 2 && state.disturbanceCount === 0 && recoveryOk;
  const reasons = [];
  if (recordings.length < 3) {
    reasons.push(
      `缺少清晰录音：${Object.values(state.flocks)
        .filter((flock) => !flock.clear)
        .map((flock) => flock.name)
        .join("、")}`,
    );
  }
  if (trackCount < 2) reasons.push(`有效航迹仅 ${trackCount}/2 条`);
  if (state.disturbanceCount > 0) reasons.push(`灯光惊扰 ${state.disturbanceCount} 次`);
  if (recoveryRequired && !state.recoveryObservation.passed) reasons.push("故障恢复观察尚未通过");
  if (success) {
    state.outcome = "success";
    state.status = "completed";
  } else if (final) {
    state.outcome = "failure";
    state.status = "completed";
  }
  return { success, goals, reasons };
}

export function executeStep(inputState) {
  const state = clone(inputState);
  if (state.status === "completed") return state;
  if (state.tick >= state.totalTicks) {
    evaluateOutcome(state, true);
    return state;
  }

  const tick = state.tick + 1;
  const preState = keyStateSnapshot(state);
  const scenario = getScenario(state);
  state.tick = tick;
  state.wind = getWind(state, tick);
  state.status = "running";
  logEvent(state, tick, "STEP_START", `第 ${tick}/${state.totalTicks} 段监测开始，风级 ${state.wind}。`, {
    wind: state.wind,
    lightsOn: state.lightsOn,
  });
  if (scenario.faultTick === tick && state.fault.status === "idle") {
    state.fault.status = "armed";
    logEvent(state, tick, "FAULT_ARMED", `${scenario.code} 侧风故障已装载，等待污染触发。`, {
      scenarioId: state.scenarioId,
    });
  }

  consumeAndMoveDevices(state, tick);
  updateFlocks(state, tick);
  collectRecordings(state, tick, preState);
  collectAerialTrack(state, tick);
  if (state.fault.triggeredAt === tick && state.fault.after === null) {
    state.fault.after = keyStateSnapshot(state);
  }
  syncFaultRecovery(state, tick);
  observeRecoveryWindow(state, tick, preState);

  const evaluation = evaluateOutcome(state, tick >= state.totalTicks);
  const stepEvents = state.events.filter((event) => event.tick === tick);
  state.lastStep = {
    tick,
    pre: preState,
    post: keyStateSnapshot(state),
    events: stepEvents.map((event) => event.seq),
    evaluation,
  };
  logEvent(
    state,
    tick,
    "STEP_END",
    evaluation.success
      ? "任务目标与恢复观察全部达成。"
      : `本段结束，目标进度 ${evaluation.goals.recordings}/3 录音、${evaluation.goals.tracks}/2 航迹。`,
    evaluation.goals,
  );
  if (state.status === "completed") {
    logEvent(
      state,
      tick,
      state.outcome === "success" ? "MISSION_SUCCESS" : "MISSION_FAILURE",
      state.outcome === "success" ? "监测任务成功。" : evaluation.reasons.join("；"),
      evaluation,
    );
  }
  return state;
}

export function applyPlanActions(state, actions = {}) {
  let next = clone(state);
  if (actions.lightsOn !== undefined) next = setLights(next, actions.lightsOn);
  for (const [deviceId, patch] of Object.entries(actions.devices ?? {})) {
    next = configureDevice(next, deviceId, patch);
    if (patch.moveTo !== undefined) next = queueMove(next, deviceId, patch.moveTo);
  }
  return next;
}

export function runPlan({ scenarioId = "calm", seed = 20261112, plan = {}, maxTicks = TOTAL_TICKS }) {
  let state = createGame({ scenarioId, seed });
  for (let tick = 1; tick <= maxTicks && state.status !== "completed"; tick += 1) {
    state = applyPlanActions(state, plan[tick] ?? {});
    state = executeStep(state);
  }
  if (state.status !== "completed") {
    state = evaluateOutcome(state, true);
  }
  return state;
}

export function serializeGame(state) {
  return JSON.stringify(state);
}

export function restoreGame(serialized) {
  const parsed = typeof serialized === "string" ? JSON.parse(serialized) : clone(serialized);
  if (
    parsed?.version !== 1 ||
    !parsed.devices ||
    !parsed.flocks ||
    !parsed.retakeQueue ||
    !parsed.fault ||
    !parsed.recoveryObservation
  ) {
    throw new Error("Invalid saved monitoring state");
  }
  return parsed;
}

export function digestRun(state) {
  const key = {
    scenarioId: state.scenarioId,
    seed: state.seed,
    ticks: state.tick,
    outcome: state.outcome,
    status: state.status,
    disturbanceCount: state.disturbanceCount,
    events: state.events.map(({ seq, tick, type, message }) => ({ seq, tick, type, message })),
    devices: Object.fromEntries(
      Object.values(state.devices).map((device) => [
        device.id,
        {
          zone: device.zone,
          battery: device.battery,
          power: device.power,
          frequency: device.frequency,
          status: device.status,
        },
      ]),
    ),
    recordings: Object.fromEntries(
      Object.values(state.flocks).map((flock) => [
        flock.id,
        {
          clear: flock.clear,
          clearAt: flock.clearAt,
          attempts: flock.attempts,
          retakes: flock.retakes,
          lastQuality: flock.lastQuality,
        },
      ]),
    ),
    tracks: Object.keys(state.tracks.valid).sort(),
    fault: {
      triggeredAt: state.fault.triggeredAt,
      recoveredAt: state.fault.recoveredAt,
      status: state.fault.status,
    },
    observations: state.observations,
    recoveryObservation: state.recoveryObservation,
  };
  return JSON.stringify(key);
}

export function summarizeRun(state) {
  return {
    scenarioId: state.scenarioId,
    scenarioCode: state.scenarioCode,
    seed: state.seed,
    ticks: state.tick,
    outcome: state.outcome,
    disturbanceCount: state.disturbanceCount,
    faultStatus: state.fault.status,
    faultTriggeredAt: state.fault.triggeredAt,
    faultRecoveredAt: state.fault.recoveredAt,
    recordings: Object.fromEntries(
      Object.values(state.flocks).map((flock) => [
        flock.id,
        { clear: flock.clear, clearAt: flock.clearAt, retakes: flock.retakes, attempts: flock.attempts },
      ]),
    ),
    tracks: Object.keys(state.tracks.valid).sort(),
    pendingRetakes: state.retakeQueue.length,
    recoveryObservation: {
      required: state.recoveryObservation.required,
      completed: state.recoveryObservation.completed,
      passed: state.recoveryObservation.passed,
      failures: state.recoveryObservation.failures,
    },
    devices: Object.fromEntries(
      Object.values(state.devices).map((device) => [
        device.id,
        {
          zone: device.zone,
          battery: device.battery,
          power: device.power,
          frequency: device.frequency,
          status: device.status,
        },
      ]),
    ),
    rejectedRecordings: state.events.filter((event) => event.type === "QUALITY_REJECTED").length,
    retakeEvents: state.events.filter(
      (event) => event.type === "RECORDING_CLEAR" && event.data?.isRetake,
    ).length,
  };
}
