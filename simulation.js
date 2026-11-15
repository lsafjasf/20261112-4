export const TICK = 0.1;
export const MISSION_END = 120;

export const FILTERS = {
  ha: { id: "ha", name: "Hα", color: "#ff8a7a", note: "656 nm" },
  o3: { id: "o3", name: "OIII", color: "#67d8d2", note: "501 nm" },
  b: { id: "b", name: "B", color: "#8ea9ff", note: "445 nm" },
};

export const TARGETS = {
  carina: {
    id: "carina",
    group: "A",
    name: "船底座星云",
    short: "船底座",
    catalog: "NGC 3372",
    az: 212,
    peakTime: 30,
    peakAltitude: 60,
    minAltitude: 36,
    maxAltitude: 64,
    minClarity: 78,
    minExposure: 18,
    filter: "ha",
    slewTime: 5,
    color: "#ffb36b",
  },
  vela: {
    id: "vela",
    group: "A",
    name: "船帆座超新星遗迹",
    short: "船帆座",
    catalog: "Vela SNR",
    az: 188,
    peakTime: 44,
    peakAltitude: 54,
    minAltitude: 33,
    maxAltitude: 61,
    minClarity: 78,
    minExposure: 18,
    filter: "o3",
    slewTime: 6,
    color: "#80d8ff",
  },
  trifid: {
    id: "trifid",
    group: "B",
    name: "三叶星云",
    short: "三叶",
    catalog: "M20",
    az: 174,
    peakTime: 53,
    peakAltitude: 56,
    minAltitude: 38,
    maxAltitude: 68,
    minClarity: 78,
    minExposure: 18,
    filter: "o3",
    slewTime: 5,
    color: "#ff8fba",
  },
  eagle: {
    id: "eagle",
    group: "B",
    name: "鹰状星云",
    short: "鹰状",
    catalog: "M16",
    az: 149,
    peakTime: 43,
    peakAltitude: 51,
    minAltitude: 34,
    maxAltitude: 60,
    minClarity: 78,
    minExposure: 18,
    filter: "ha",
    slewTime: 6,
    color: "#b9a8ff",
  },
};

export const SCENARIOS = {
  standard: {
    id: "standard",
    name: "标准窗口",
    stormLabel: "沙尘前锋 01:32",
    stormOnset: 92,
    warningAt: 84,
    windBase: 5.2,
  },
  early: {
    id: "early",
    name: "提前沙尘",
    stormLabel: "沙尘前锋 00:52",
    stormOnset: 52,
    warningAt: 42,
    windBase: 6.4,
  },
};

export const DEFAULT_INPUT = {
  scenario: "standard",
  domeOpen: false,
  focusOffset: 0,
  groups: {
    A: { targetId: "carina", filter: "ha", exposure: 20, autoFocus: true },
    B: { targetId: "trifid", filter: "o3", exposure: 20, autoFocus: true },
  },
};

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeInput(input = DEFAULT_INPUT) {
  const source = clone(input);
  const scenario = SCENARIOS[source.scenario] ? source.scenario : "standard";
  return {
    scenario,
    domeOpen: Boolean(source.domeOpen),
    focusOffset: clamp(Number(source.focusOffset ?? 0), -2, 2),
    groups: {
      A: normalizeGroup(source.groups?.A, "A"),
      B: normalizeGroup(source.groups?.B, "B"),
    },
  };
}

function normalizeGroup(group, id) {
  const fallback = DEFAULT_INPUT.groups[id];
  const source = group || fallback;
  const target = TARGETS[source.targetId]?.group === id ? TARGETS[source.targetId] : TARGETS[fallback.targetId];
  const filter = FILTERS[source.filter] ? source.filter : fallback.filter;
  return {
    targetId: target.id,
    filter,
    exposure: clamp(Math.round(Number(source.exposure ?? fallback.exposure)), 14, 30),
    autoFocus: source.autoFocus !== false,
  };
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function altitudeAt(targetId, time) {
  const target = TARGETS[targetId];
  const delta = (time - target.peakTime) / 10;
  return round(target.peakAltitude - 0.34 * delta * delta, 2);
}

export function thermalFocusAt(time) {
  const temperature = temperatureAt(time);
  return round((4.4 - temperature) * 0.6, 3);
}

export function temperatureAt(time) {
  return round(4.4 - 0.021 * time + 0.35 * Math.sin(time / 15), 2);
}

export function windAt(scenarioId, time, dustLevel) {
  const scenario = SCENARIOS[scenarioId];
  return round(
    scenario.windBase + 1.5 * Math.sin(time / 17 + 0.4) + dustLevel * (scenarioId === "early" ? 24 : 15),
    1,
  );
}

export function formatClock(seconds) {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export class ObservatorySimulation {
  constructor(input) {
    this.input = normalizeInput(input);
    this.scenario = SCENARIOS[this.input.scenario];
    this.phase = "ready";
    this.previousPhase = "ready";
    this.time = 0;
    this.currentTaskIndex = -1;
    this.currentTask = null;
    this.taskProgress = 0;
    this.wear = 0;
    this.power = 100;
    this.dataMB = 0;
    this.dust = 0;
    this.temperature = temperatureAt(0);
    this.wind = windAt(this.input.scenario, 0, 0);
    this.domeOpen = this.input.domeOpen;
    this.domeTarget = this.input.domeOpen ? "open" : "closed";
    this.focusPosition = this.input.focusOffset;
    this.focusError = 0;
    this.activeJobs = 0;
    this.airlockSealed = true;
    this.errorCode = null;
    this.abortReason = "";
    this.abortedTaskId = null;
    this.warningActive = false;
    this.stormActive = false;
    this.records = { A: null, B: null };
    this.tasks = this._buildTasks();
    this.events = [];
    this.trace = [];
    this.fault = null;
    this.recovery = null;
    this.summary = null;
    this._traceCounter = 0;
    this._pushEvent("system", "排程已装载，等待启动", "info");
    this._sampleTrace();
  }

  _buildTasks() {
    const tasks = [];
    if (!this.input.domeOpen) {
      tasks.push({
        id: "dome-open",
        kind: "dome",
        group: null,
        label: "开启穹顶",
        detail: "滑轨解锁 / 外罩就绪",
        duration: 3,
      });
    }

    for (const groupId of ["A", "B"]) {
      const settings = this.input.groups[groupId];
      const target = TARGETS[settings.targetId];
      tasks.push({
        id: `slew-${groupId}`,
        kind: "slew",
        group: groupId,
        label: `指向 ${target.short}`,
        detail: `${target.catalog} / AZ ${target.az}°`,
        duration: target.slewTime,
      });
      tasks.push({
        id: `filter-${groupId}`,
        kind: "filter",
        group: groupId,
        label: `切换 ${FILTERS[settings.filter].name}`,
        detail: `${FILTERS[settings.filter].note} 窄带轮`,
        duration: 2,
      });
      if (settings.autoFocus) {
        tasks.push({
          id: `focus-${groupId}`,
          kind: "focus",
          group: groupId,
          label: `温度对焦 ${groupId}`,
          detail: "热漂移补偿 / 自动寻星",
          duration: 4,
        });
      }
      tasks.push({
        id: `expose-${groupId}`,
        kind: "expose",
        group: groupId,
        label: `曝光 ${groupId} 组`,
        detail: `${settings.exposure}s / ${FILTERS[settings.filter].name}`,
        duration: settings.exposure,
      });
    }
    return tasks;
  }

  start() {
    if (this.phase !== "ready") return false;
    this.phase = "running";
    this.currentTaskIndex = 0;
    this._beginTask();
    this._pushEvent("system", "排程开始，主时钟已锁定", "success");
    return true;
  }

  pause() {
    if (this.phase !== "running") return false;
    this.previousPhase = this.phase;
    this.phase = "paused";
    this._pushEvent("system", "时间轴暂停，积分时钟冻结", "warn");
    return true;
  }

  resume() {
    if (this.phase !== "paused") return false;
    this.phase = this.previousPhase || "running";
    this._pushEvent("system", "时间轴继续", "info");
    return true;
  }

  step(dt = TICK) {
    if (this.phase === "running") {
      this._stepRunning(dt);
    } else if (this.phase === "recovering") {
      this._stepRecovery(dt);
    } else if (this.phase === "paused") {
      return false;
    }
    return true;
  }

  stepOnce(dt = 0.5) {
    if (this.phase !== "paused") return false;
    this.phase = "running";
    this._stepRunning(dt);
    if (this.phase === "running") {
      this.phase = "paused";
      this.summary = this._makeSummary();
    }
    return true;
  }

  _stepRunning(dt) {
    let remaining = dt;
    let guard = 0;
    while (remaining > 0.0001 && this.phase === "running" && guard < 12) {
      guard += 1;
      const task = this.tasks[this.currentTaskIndex];
      if (!task) {
        this._completeMission();
        break;
      }
      const taskRemaining = Math.max(0, task.duration - this.taskProgress);
      const slice = Math.min(remaining, taskRemaining || dt);
      this._applyTaskRates(task, slice);
      if (this.phase !== "running") break;
      this.taskProgress += slice;
      this.time += slice;
      this._updateEnvironment();
      remaining -= slice;
      if (this.taskProgress >= task.duration - 0.0001) {
        this._finishTask(task);
        if (this.phase === "running" && this.currentTaskIndex < this.tasks.length) {
          this._beginTask();
        }
      }
      if (this.phase === "running" && this.currentTaskIndex >= this.tasks.length) {
        this._completeMission();
      }
    }
    this.summary = this._makeSummary();
    this._traceCounter += dt;
    if (this._traceCounter >= 0.999) {
      this._traceCounter = 0;
      this._sampleTrace();
    }
  }

  _beginTask() {
    const task = this.tasks[this.currentTaskIndex];
    if (!task) return;
    this.currentTask = task;
    this.taskProgress = 0;
    this.activeJobs = 1;
    const target = task.group ? TARGETS[this.input.groups[task.group].targetId] : null;
    if (task.kind === "expose" && target) {
      const settings = this.input.groups[task.group];
      this.records[task.group] = {
        group: task.group,
        targetId: target.id,
        targetName: target.name,
        catalog: target.catalog,
        filter: settings.filter,
        exposure: 0,
        requiredExposure: target.minExposure,
        requiredClarity: target.minClarity,
        claritySum: 0,
        claritySamples: 0,
        meanClarity: 0,
        visibleSamples: 0,
        status: "观测中",
        qualified: false,
        startedAt: this.time,
        finishedAt: null,
        dataMB: 0,
      };
      this._pushEvent("exposure", `${task.group} 组曝光开始 · ${FILTERS[settings.filter].name}`, "success");
    } else if (task.kind === "slew") {
      this._pushEvent("motor", `${task.group} 组转台指向 ${target.short}`, "info");
    } else if (task.kind === "filter") {
      this._pushEvent("motor", `${task.group} 组滤光轮切换至 ${FILTERS[this.input.groups[task.group].filter].name}`, "info");
    } else if (task.kind === "focus") {
      this._pushEvent("focus", `${task.group} 组温度补偿对焦`, "info");
    } else if (task.kind === "dome") {
      this._pushEvent("dome", "穹顶滑轨开启，外罩退让", "info");
    }
  }

  _applyTaskRates(task, dt) {
    const powerRates = { dome: 0.04, slew: 0.09, filter: 0.05, focus: 0.06, expose: 0.055 };
    const wearRates = { dome: 0.09, filter: 0.1, focus: 0.02 };
    this.power = clamp(this.power - (powerRates[task.kind] || 0) * dt, 0, 100);
    let wearRate = wearRates[task.kind] || 0;
    if (task.kind === "slew") {
      wearRate = 0.18 * Math.max(0.7, this.wind / 7);
    } else if (task.kind === "expose") {
      wearRate = 0.012 + this.dust * 0.34;
    }
    this.wear = clamp(this.wear + wearRate * dt, 0, 100);
    this.focusError = round(Math.abs(this.focusPosition - thermalFocusAt(this.time)), 3);

    if (task.kind === "expose" && task.group) {
      const record = this.records[task.group];
      const settings = this.input.groups[task.group];
      const target = TARGETS[settings.targetId];
      const clarity = this._calculateClarity(target, settings.filter);
      const isVisible = this._isVisible(target);
      record.exposure = round(record.exposure + dt, 3);
      record.claritySum += clarity;
      record.claritySamples += 1;
      record.meanClarity = round(record.claritySum / record.claritySamples, 2);
      if (isVisible) record.visibleSamples += 1;
      record.dataMB = round(record.dataMB + dt * 0.24, 3);
      this.dataMB = round(this.dataMB + dt * 0.24, 3);
    }

    if (this.wear >= 100) {
      this._abort("电机磨损达到硬限位", "E_MOTOR_WEAR");
    } else if (this.dust > 0.16 && this.domeOpen) {
      this._abort("沙尘侵入光路，超过保护阈值", "E_DUST_INGRESS");
    }
  }

  _finishTask(task) {
    this.activeJobs = 0;
    if (task.kind === "dome") {
      this.domeOpen = true;
      this.domeTarget = "open";
      this.airlockSealed = false;
      this._pushEvent("dome", "穹顶已开启，光路无遮挡", "success");
    } else if (task.kind === "focus") {
      this.focusPosition = thermalFocusAt(this.time);
      this.focusError = 0;
      this._pushEvent("focus", `对焦锁定 · 热漂移修正 ${this.focusPosition.toFixed(2)} µm`, "success");
    } else if (task.kind === "filter") {
      const filter = FILTERS[this.input.groups[task.group].filter];
      this._pushEvent("motor", `${task.group} 组滤光片 ${filter.name} 就绪`, "success");
    } else if (task.kind === "expose") {
      this._finalizeRecord(task.group, "complete");
    }
    this.currentTaskIndex += 1;
    this.taskProgress = 0;
    this.currentTask = this.tasks[this.currentTaskIndex] || null;
  }

  _finalizeRecord(groupId, status) {
    const record = this.records[groupId];
    if (!record) return;
    const target = TARGETS[record.targetId];
    record.finishedAt = this.time;
    record.status = "已完成";
    record.qualified =
      record.exposure >= target.minExposure - 0.01 &&
      record.meanClarity >= target.minClarity &&
      record.visibleSamples / Math.max(1, record.claritySamples) >= 0.98;
    if (!record.qualified) {
      record.status = "数据未达标";
      this._pushEvent("quality", `${groupId} 组数据未达标 · 清晰度 ${record.meanClarity.toFixed(1)}`, "warn");
    } else {
      this._pushEvent("quality", `${groupId} 组数据达标 · ${record.exposure.toFixed(1)}s / ${record.meanClarity.toFixed(1)}%`, "success");
    }
  }

  _isVisible(target) {
    const altitude = altitudeAt(target.id, this.time);
    return altitude >= target.minAltitude && altitude <= target.maxAltitude;
  }

  _calculateClarity(target, filter) {
    const altitude = altitudeAt(target.id, this.time);
    const visible = altitude >= target.minAltitude && altitude <= target.maxAltitude;
    const base = visible ? 95 - Math.abs(altitude - 51) * 0.48 : 44;
    const filterPenalty = filter === target.filter ? 3.5 : 32;
    const focusPenalty = Math.min(30, this.focusError * 18);
    const dustPenalty = this.dust * 24;
    return round(clamp(base - filterPenalty - focusPenalty - dustPenalty, 0, 100), 2);
  }

  _updateEnvironment() {
    const { stormOnset, warningAt } = this.scenario;
    if (!this.warningActive && this.time >= warningAt) {
      this.warningActive = true;
      this.fault = {
        type: "沙尘前锋提前抵达",
        scenario: this.scenario.name,
        warningAt: round(this.time, 2),
        triggerAt: stormOnset,
        before: this._snapshot("沙尘预警"),
        after: null,
      };
      this._pushEvent("weather", `预警：沙尘前锋将在 ${formatClock(Math.ceil(stormOnset - this.time))} 后抵达`, "warn");
    }
    if (!this.stormActive && this.time >= stormOnset) {
      this.stormActive = true;
      this._pushEvent("weather", "沙尘前锋抵达观测窗口，能见度快速下降", "error");
    }
    const dustRaw = this.stormActive ? (this.time - stormOnset) / 8 : 0;
    this.dust = round(clamp(dustRaw, 0, 1), 4);
    this.temperature = temperatureAt(this.time);
    this.wind = windAt(this.input.scenario, this.time, this.dust);
    this.focusError = round(Math.abs(this.focusPosition - thermalFocusAt(this.time)), 3);
  }

  _abort(reason, errorCode) {
    if (this.phase !== "running") return;
    const task = this.tasks[this.currentTaskIndex];
    this.abortedTaskId = task?.id || null;
    this.phase = "aborted";
    this.activeJobs = 0;
    this.errorCode = errorCode;
    this.abortReason = reason;
    this.domeOpen = false;
    this.domeTarget = "closed";
    this.airlockSealed = true;
    if (task?.kind === "expose" && task.group && this.records[task.group]) {
      const record = this.records[task.group];
      record.status = "已中止 · 记录保留";
      record.finishedAt = this.time;
      record.qualified = false;
    }
    if (this.fault) {
      this.fault.triggeredAt = round(this.time, 2);
      this.fault.after = this._snapshot("保护停机后");
    }
    this._pushEvent("fault", `${errorCode} · ${reason}，观测记录已冻结`, "error");
    this.summary = this._makeSummary();
    this._sampleTrace();
  }

  _completeMission() {
    if (this.phase !== "running") return;
    this.phase = "complete";
    this.activeJobs = 0;
    this.currentTask = null;
    this.domeOpen = false;
    this.domeTarget = "closed";
    this.airlockSealed = true;
    this.summary = this._makeSummary();
    if (this.summary.success) {
      this._pushEvent("system", "两组数据达标，设备健康，排程成功", "success");
    } else {
      this._pushEvent("system", "排程结束，但验收条件未全部满足", "warn");
    }
    this._sampleTrace();
  }

  _makeSummary() {
    const records = {
      A: this.records.A ? clone(this.records.A) : null,
      B: this.records.B ? clone(this.records.B) : null,
    };
    const bothQualified = Boolean(records.A?.qualified && records.B?.qualified);
    const success = this.phase === "complete" && bothQualified && this.wear < 100;
    let outcome = "READY";
    if (this.phase === "aborted") outcome = "ABORTED";
    else if (this.phase === "complete" && success) outcome = "SUCCESS";
    else if (this.phase === "complete") outcome = "FAILED";
    else if (this.phase === "recovered") outcome = "RECOVERED";
    return {
      outcome,
      success,
      phase: this.phase,
      duration: round(this.time, 2),
      bothQualified,
      equipmentHealthy: this.wear < 100,
      wear: round(this.wear, 3),
      power: round(this.power, 3),
      dataMB: round(this.dataMB, 3),
      errorCode: this.errorCode,
      abortReason: this.abortReason,
      records,
    };
  }

  _snapshot(label) {
    return {
      label,
      time: round(this.time, 2),
      phase: this.phase,
      task: this.currentTask?.id || null,
      taskProgress: round(this.taskProgress, 2),
      dust: round(this.dust, 4),
      wind: round(this.wind, 2),
      temperature: round(this.temperature, 2),
      dome: this.domeOpen ? "OPEN" : "SAFE_CLOSED",
      focusError: round(this.focusError, 3),
      wear: round(this.wear, 3),
      power: round(this.power, 3),
      activeJobs: this.activeJobs,
      records: {
        A: this.records.A
          ? { status: this.records.A.status, exposure: round(this.records.A.exposure, 2) }
          : null,
        B: this.records.B
          ? { status: this.records.B.status, exposure: round(this.records.B.exposure, 2) }
          : null,
      },
    };
  }

  _resourceSnapshot() {
    return {
      time: round(this.time, 2),
      phase: this.phase,
      task: this.currentTask?.id || null,
      wear: round(this.wear, 3),
      power: round(this.power, 3),
      dataMB: round(this.dataMB, 3),
      dust: round(this.dust, 4),
      focusError: round(this.focusError, 3),
      activeJobs: this.activeJobs,
      records: {
        A: this.records.A ? round(this.records.A.exposure, 2) : 0,
        B: this.records.B ? round(this.records.B.exposure, 2) : 0,
      },
    };
  }

  _sampleTrace() {
    this.trace.push(this._resourceSnapshot());
  }

  _pushEvent(channel, message, level = "info") {
    this.events.unshift({
      id: this.events.length + 1,
      time: round(this.time, 2),
      channel,
      message,
      level,
    });
    if (this.events.length > 80) this.events.length = 80;
  }

  recover() {
    if (this.phase !== "aborted") return false;
    this.previousPhase = this.phase;
    this.phase = "recovering";
    this.recovery = {
      stage: "seal",
      stageElapsed: 0,
      stageDuration: 2,
      observationElapsed: 0,
      observationWindow: 12,
      startResources: null,
      endResources: null,
      report: null,
    };
    this._pushEvent("recovery", "恢复序列启动：隔离光路并执行自检", "info");
    return true;
  }

  _stepRecovery(dt) {
    const recovery = this.recovery;
    if (!recovery) return;
    this.time += dt;
    this._updateEnvironment();
    recovery.stageElapsed += dt;
    if (recovery.stage === "seal" && recovery.stageElapsed >= 2) {
      recovery.stage = "selftest";
      recovery.stageElapsed = 0;
      recovery.stageDuration = 3;
      this._pushEvent("recovery", "机械隔离完成，开始电机与传感器自检", "info");
    } else if (recovery.stage === "selftest" && recovery.stageElapsed >= 3) {
      this.errorCode = null;
      this.abortReason = "";
      recovery.stage = "observe";
      recovery.stageElapsed = 0;
      recovery.startResources = this._recoveryResources();
      this._pushEvent("recovery", "自检通过，进入 12.0s 固定观察窗", "success");
    } else if (recovery.stage === "observe") {
      recovery.observationElapsed = Math.min(recovery.observationWindow, recovery.observationElapsed + dt);
      if (recovery.observationElapsed >= recovery.observationWindow - 0.0001) {
        recovery.endResources = this._recoveryResources();
        const start = recovery.startResources;
        const end = recovery.endResources;
        const drift = {
          wear: round(end.wear - start.wear, 4),
          power: round(end.power - start.power, 4),
          dataMB: round(end.dataMB - start.dataMB, 4),
          AExposure: round(end.records.A - start.records.A, 4),
          BExposure: round(end.records.B - start.records.B, 4),
        };
        recovery.report = {
          observedSeconds: recovery.observationWindow,
          activeJobs: this.activeJobs,
          errorCode: this.errorCode,
          domeOpen: this.domeOpen,
          drift,
          passed:
            this.activeJobs === 0 &&
            this.errorCode === null &&
            !this.domeOpen &&
            Object.values(drift).every((value) => Math.abs(value) < 0.0001),
        };
        this.phase = "recovered";
        this.activeJobs = 0;
        this.summary = this._makeSummary();
        this._pushEvent(
          "recovery",
          recovery.report.passed ? "12.0s 恢复观察通过 · 无活动任务、无错误、资源零漂移" : "恢复观察发现残留状态",
          recovery.report.passed ? "success" : "error",
        );
        this._sampleTrace();
      }
    }
  }

  _recoveryResources() {
    return {
      time: round(this.time, 2),
      power: round(this.power, 4),
      wear: round(this.wear, 4),
      dataMB: round(this.dataMB, 4),
      activeJobs: this.activeJobs,
      errorCode: this.errorCode,
      domeOpen: this.domeOpen,
      records: {
        A: round(this.records.A?.exposure || 0, 4),
        B: round(this.records.B?.exposure || 0, 4),
      },
    };
  }

  exportState(includeTrace = false) {
    const state = {
      input: clone(this.input),
      scenario: clone(this.scenario),
      phase: this.phase,
      time: round(this.time, 3),
      currentTaskIndex: this.currentTaskIndex,
      currentTask: this.currentTask ? clone(this.currentTask) : null,
      taskProgress: round(this.taskProgress, 3),
      tasks: clone(this.tasks),
      wear: round(this.wear, 3),
      power: round(this.power, 3),
      dataMB: round(this.dataMB, 3),
      dust: round(this.dust, 4),
      wind: round(this.wind, 2),
      temperature: round(this.temperature, 2),
      domeOpen: this.domeOpen,
      domeTarget: this.domeTarget,
      airlockSealed: this.airlockSealed,
      focusError: round(this.focusError, 3),
      activeJobs: this.activeJobs,
      errorCode: this.errorCode,
      abortReason: this.abortReason,
      abortedTaskId: this.abortedTaskId,
      warningActive: this.warningActive,
      stormActive: this.stormActive,
      records: {
        A: this.records.A ? clone(this.records.A) : null,
        B: this.records.B ? clone(this.records.B) : null,
      },
      events: clone(this.events),
      fault: this.fault ? clone(this.fault) : null,
      recovery: this.recovery ? clone(this.recovery) : null,
      summary: this.summary ? clone(this.summary) : this._makeSummary(),
    };
    if (includeTrace) state.trace = clone(this.trace);
    return state;
  }
}

export function runSchedule(input, options = {}) {
  const sim = new ObservatorySimulation(input);
  sim.start();
  let steps = 0;
  while (sim.phase === "running" && steps < 5000) {
    sim.step(TICK);
    steps += 1;
  }
  if (options.recover && sim.phase === "aborted") {
    sim.recover();
    while (sim.phase === "recovering" && steps < 8000) {
      sim.step(TICK);
      steps += 1;
    }
  }
  return sim.exportState(true);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  const text = stableJson(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function compareRuns(input, options = {}) {
  const runA = runSchedule(input, options);
  const runB = runSchedule(input, options);
  const taskSequenceA = runA.tasks.map(({ id, duration }) => ({ id, duration }));
  const taskSequenceB = runB.tasks.map(({ id, duration }) => ({ id, duration }));
  const resourcesA = runA.trace.map(({ time, wear, power, dataMB, activeJobs }) => ({
    time,
    wear,
    power,
    dataMB,
    activeJobs,
  }));
  const resourcesB = runB.trace.map(({ time, wear, power, dataMB, activeJobs }) => ({
    time,
    wear,
    power,
    dataMB,
    activeJobs,
  }));
  const finalA = runA.summary;
  const finalB = runB.summary;
  const taskMatch = stableJson(taskSequenceA) === stableJson(taskSequenceB);
  const resourceMatch = stableJson(resourcesA) === stableJson(resourcesB);
  const finalMatch = stableJson(finalA) === stableJson(finalB);
  return {
    match: taskMatch && resourceMatch && finalMatch,
    taskMatch,
    resourceMatch,
    finalMatch,
    taskDigest: digest(taskSequenceA),
    resourceDigest: digest(resourcesA),
    finalDigest: digest(finalA),
    runA,
    runB,
    taskSequence: taskSequenceA,
  };
}
