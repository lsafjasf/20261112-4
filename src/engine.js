import { createRng } from "./rng.js";
import {
  TEMP,
  MEDICINES,
  defaultBoxes,
  BOX_RULES,
  VEHICLE,
  SEGMENTS,
  STATION,
  FAIL_RULES,
  defaultScenario,
} from "./config.js";

export class DeliverySim {
  constructor(seed = 20261112, scenario = {}) {
    const cfg = { ...defaultScenario(seed), ...scenario, seed };
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    this.rng = createRng(this.cfg.seed);
    this.state = this._initialState();
    return this.state;
  }

  _initialState() {
    const boxes = defaultBoxes();
    if (this.cfg.insulationStart !== undefined) {
      for (const box of boxes) box.insulation = this.cfg.insulationStart;
    }
    this.drainBoost = this.cfg.drainBoost ?? 1;
    return {
      tick: 0,
      status: "running", // running | paused | success | failed
      rngCursor: this.rng.cursor,
      vehicle: {
        location: "depot",
        segment: null, // { from, to, route, total, progress }
        mileage: 0,
        damage: 0,
        hardBrakes: 0,
        waitingBlock: false,
      },
      boxes,
      medicines: MEDICINES.map((m) => ({ ...m, delivered: false })),
      queue: ["H1", "H2", "S1"], // 可重排的访问队列
      station: {
        outage: { ...this.cfg.outage },
        outageActive: false,
        outageExperienced: false,
        recovered: false,
        recoveredTick: null,
        spares: Object.fromEntries(boxes.map((b) => [b.id, STATION.spareCount])),
        charging: Object.fromEntries(boxes.map((b) => [b.id, 0])),
        swaps: 0,
      },
      routes: {
        backupUsed: false,
        records: [], // 完整备用路线记录
      },
      events: [],
      failure: null,
      pendingSuccess: false,
      faultSnapshots: {
        overTemp: { before: null, after: null },
        outage: null,
        damage: null,
      },
      observe: { startTick: null, start: null, ticks: 0, clean: null },
    };
  }

  get s() {
    return this.state;
  }

  pause() {
    if (this.s.status === "running") this.s.status = "paused";
    return this.s;
  }

  resume() {
    if (this.s.status === "paused") this.s.status = "running";
    return this.s;
  }

  step() {
    // 单步：暂停态下推进一个 tick
    if (this.s.status === "paused") this.s.status = "running";
    this._advance();
    if (this.s.status === "running") this.s.status = "paused";
    return this.s;
  }

  // 整段深拷贝，供两次运行逐字段比对
  snapshot() {
    return JSON.parse(JSON.stringify(this.s));
  }

  reorderQueue(nextQueue) {
    const allowed = this.s.queue;
    const ok =
      Array.isArray(nextQueue) &&
      nextQueue.length === allowed.length &&
      allowed.every((x) => nextQueue.includes(x));
    if (!ok) throw new Error("非法队列：必须是当前剩余站点的排列");
    if (this.s.vehicle.segment) throw new Error("车辆在途，无法重排路线");
    this.s.queue = [...nextQueue];
    this._log("route_reorder", { queue: [...nextQueue] });
    return this.s;
  }

  _log(type, detail = {}) {
    this.s.events.push({ tick: this.s.tick, type, ...detail });
  }

  run(ticks) {
    for (let i = 0; i < ticks; i += 1) {
      if (this.s.status !== "running") break;
      this._advance();
    }
    return this.s;
  }

  _advance() {
    if (this.s.status !== "running") return;
    this.s.tick += 1;
    this.s.rngCursor = this.rng.cursor;
    this._updateOutage();
    this._updateVehicle();
    this._updateBoxes();
    this._updateObservation();
    this._checkEnd();
    this.s.rngCursor = this.rng.cursor;
  }

  _updateOutage() {
    const { outage } = this.s.station;
    const active = this.s.tick >= outage.start && this.s.tick <= outage.end;
    if (active && !this.s.station.outageActive) {
      this.s.station.outageActive = true;
      this.s.station.outageExperienced = true;
      this.s.station.recovered = false;
      this._log("outage_start", { range: [outage.start, outage.end] });
      this.s.faultSnapshots.outage = this._snapshotKeys([
        "tick",
        "station",
        "vehicle",
        "boxes",
      ]);
    }
    if (!active && this.s.station.outageActive) {
      this.s.station.outageActive = false;
      this.s.station.recovered = true;
      this.s.station.recoveredTick = this.s.tick;
      this.s.observe.startTick = this.s.tick;
      this.s.observe.start = this._snapshotKeys(["station", "boxes", "vehicle"]);
      this._log("outage_recover", { tick: this.s.tick });
    }
  }

  _updateObservation() {
    const ob = this.s.observe;
    if (ob.startTick === null || this.s.status !== "running") return;
    ob.ticks = this.s.tick - ob.startTick;
    if (ob.ticks >= this.cfg.observeTicks && ob.clean === null) {
      const residual =
        this.s.station.outageActive ||
        this.s.boxes.some((b) => b.openTicksLeft > 0) ||
        (this.s.station.recoveredTick === null);
      ob.clean = !residual;
      this._log("observe_complete", {
        ticks: this.cfg.observeTicks,
        clean: ob.clean,
      });
    }
  }

  _snapshotKeys(keys) {
    return JSON.parse(JSON.stringify(Object.fromEntries(keys.map((k) => [k, this.s[k]]))));
  }

  _updateBoxes() {
    for (const box of this.s.boxes) {
      if (box.delivered) continue; // 已交付：温度定格在交付时刻，不再仿真
      const med = MEDICINES.find((m) => m.box === box.id);
      const wasViolating = box.temp < med.min || box.temp > med.max;
      const open = box.openTicksLeft > 0;
      box.degraded = box.soc < BOX_RULES.lowSocThreshold;

      // 压缩机双向工作：高于上限制冷、低于下限制热，带滞回带宽
      const coolStop = med.max - TEMP.compressorBand;
      const heatStop = med.min + TEMP.compressorBand;
      if (box.temp >= med.max || box.temp <= med.min) box.compressorOn = true;
      if (box.temp <= coolStop && box.temp >= heatStop) box.compressorOn = false;

      if (open) {
        // 开箱：制冷暂停，温度快速向环境漂移，保温时间减少
        box.compressorOn = false;
        box.temp += (TEMP.ambient - box.temp) * TEMP.leak;
        box.openTicksLeft -= 1;
      } else if (box.compressorOn && box.soc > 0) {
        const power = box.degraded
          ? BOX_RULES.degradedPower
          : BOX_RULES.coolingPower;
        box.temp += box.temp > (med.min + med.max) / 2 ? -power : power;
        box.soc = Number(
          Math.max(0, box.soc - BOX_RULES.drainPerTick * this.drainBoost).toFixed(3),
        );
      } else {
        // 关箱待机：保温层有效时缓慢漂移，耗尽后按环境泄漏
        box.soc = Number(
          Math.max(0, box.soc - BOX_RULES.idleDrain).toFixed(3),
        );
        const drift = box.insulation > 0 ? TEMP.leak * 0.02 : TEMP.leak * 0.35;
        box.temp += (TEMP.ambient - box.temp) * drift;
      }
      box.temp = Number(box.temp.toFixed(3));

      // 保温时间随 tick 自然衰减，开箱额外惩罚在 openBox/deliver 时结算
      if (box.insulation > 0) box.insulation = Math.max(0, box.insulation - 1);

      const violating = box.temp < med.min || box.temp > med.max;
      if (violating) {
        box.violations += 1;
        box.violationTicks.push(this.s.tick);
        if (!wasViolating) {
          this._log("temp_violation_start", {
            box: box.id,
            temp: box.temp,
            range: [med.min, med.max],
            soc: box.soc,
          });
            this.s.faultSnapshots.overTemp.before ??= this._snapshotKeys([
              "tick",
              "boxes",
              "vehicle",
              "station",
            ]);
        }
      } else if (wasViolating) {
        this._log("temp_violation_recover", { box: box.id, temp: box.temp });
          this.s.faultSnapshots.overTemp.after ??= this._snapshotKeys([
            "tick",
            "boxes",
            "vehicle",
            "station",
          ]);
      }
    }
  }

  openBox(boxId) {
    const box = this._box(boxId);
    if (box.delivered) throw new Error(`${boxId} 已交付，不能开箱`);
    box.openTicksLeft += 1;
    box.insulation = Math.max(0, box.insulation - BOX_RULES.openInsulationPenalty);
    this._log("box_open", {
      box: boxId,
      insulation: box.insulation,
      openTicksLeft: box.openTicksLeft,
    });
    return this.s;
  }

  _box(boxId) {
    const box = this.s.boxes.find((b) => b.id === boxId);
    if (!box) throw new Error(`未知冷藏箱 ${boxId}`);
    return box;
  }

  drive(route = "main") {
    const v = this.s.vehicle;
    if (this.s.status !== "running") throw new Error("仅运行态可发车");
    if (v.segment) throw new Error("车辆已在途");
    if (this.s.queue.length === 0) throw new Error("队列已空，无目的地");
    const to = this.s.queue[0];
    const key = `${v.location}->${to}`;
    const seg = SEGMENTS[key];
    if (!seg) throw new Error(`不存在路段 ${key}`);
    if (route === "main" && seg.forceBlockTick !== undefined &&
        this.s.tick >= seg.forceBlockTick && !this.s.routes.backupUsed) {
      // 主路在该 tick 起封闭（确定性事件），必须改走备用路线
      v.waitingBlock = true;
      this._log("route_blocked", { key, tick: this.s.tick });
      return this.s;
    }
    v.waitingBlock = false;
    v.segment = { from: v.location, to, route, total: seg[route], progress: 0 };
    if (route === "backup") {
      this.s.routes.backupUsed = true;
      this.s.routes.records.push({
        key,
        tick: this.s.tick,
        length: seg.backup,
        complete: false,
      });
    }
    this._log("drive_start", { key, route, length: seg[route] });
    return this.s;
  }

  _updateVehicle() {
    const v = this.s.vehicle;
    if (!v.segment) return;
    const seg = v.segment;
    seg.progress += 1;
    v.mileage += 1;
    const def = SEGMENTS[`${seg.from}->${seg.to}`];
    const inCongestion = def.congested.some(
      ([a, b]) => seg.progress >= a && seg.progress <= b,
    );
    const roll = this.rng.chance(
      inCongestion ? VEHICLE.congestionBrakeChance : VEHICLE.normalBrakeChance,
    );
    if (roll.hit) {
      v.hardBrakes += 1;
      v.damage = Math.min(
        VEHICLE.damageFailThreshold,
        v.damage + VEHICLE.hardBrakeDamage,
      );
      this._log("hard_brake", {
        progress: seg.progress,
        congestion: inCongestion,
        rng: roll.value,
        damage: v.damage,
      });
      if (v.damage >= VEHICLE.damageFailThreshold && !this.s.faultSnapshots.damage) {
        this.s.faultSnapshots.damage = this._snapshotKeys(["tick", "vehicle", "boxes"]);
      }
    }
    if (seg.progress >= seg.total) this._arrive();
  }

  _arrive() {
    const v = this.s.vehicle;
    const to = v.segment.to;
    v.location = to;
    const finished = v.segment;
    v.segment = null;
    this.s.queue.shift();
    if (finished.route === "backup") {
      const rec = this.s.routes.records[this.s.routes.records.length - 1];
      rec.complete = true;
      rec.endTick = this.s.tick;
    }
    this._log("arrive", { stop: to, tick: this.s.tick });
  }

  deliver(medicineId) {
    const med = this.s.medicines.find((m) => m.id === medicineId);
    if (!med) throw new Error(`未知药品 ${medicineId}`);
    if (med.delivered) throw new Error(`${medicineId} 已交付`);
    if (this.s.vehicle.location !== med.hospital) {
      throw new Error(`药品 ${medicineId} 只能在 ${med.hospital} 交付`);
    }
    const box = this._box(med.box);
    const inRange = box.temp >= med.min && box.temp <= med.max;
    med.delivered = true;
    box.delivered = true;
    // 交付开箱的保温惩罚立即结算，开箱计时不再残留到后续 tick
    box.openTicksLeft = 0;
    box.insulation = Math.max(
      0,
      box.insulation - BOX_RULES.openInsulationPenalty,
    );
    this._log("deliver", {
      medicine: medicineId,
      hospital: med.hospital,
      temp: box.temp,
      inRange,
    });
    return this.s;
  }

  swapBattery(boxId) {
    const st = this.s.station;
    const v = this.s.vehicle;
    if (v.location !== "S1") throw new Error("仅换电点 S1 可换电");
    if (st.outageActive) throw new Error("临时停电中，换电点不可用");
    const box = this._box(boxId);
    if (st.spares[boxId] <= 0) throw new Error(`${boxId} 无可用满电备用电池`);
    st.spares[boxId] -= 1;
    st.charging[boxId] += box.soc; // 旧电池入桩回充（记录剩余电量）
    const oldSoc = box.soc;
    box.soc = 100;
    st.swaps += 1;
    this._log("battery_swap", { box: boxId, oldSoc: Number(oldSoc.toFixed(2)) });
    return this.s;
  }

  _rechargeStation() {
    const st = this.s.station;
    if (st.outageActive) return; // 停电期间停止回充
    for (const box of this.s.boxes) {
      if (st.charging[box.id] > 0) {
        st.charging[box.id] = Math.min(
          100,
          st.charging[box.id] + STATION.rechargePerTick,
        );
        if (st.charging[box.id] >= 100) {
          st.charging[box.id] = 0;
          st.spares[box.id] += 1;
        }
      }
    }
  }

  _checkEnd() {
    this._rechargeStation();
    const overTemp = this.s.boxes.find(
      (b) => b.violations >= FAIL_RULES.maxViolationTicks,
    );
    if (overTemp) {
      this._finish("failed", "temp", {
        box: overTemp.id,
        violations: overTemp.violations,
      });
      return;
    }
    if (this.s.vehicle.damage >= VEHICLE.damageFailThreshold) {
      this._finish("failed", "damage", { damage: this.s.vehicle.damage });
      return;
    }
    const allDelivered = this.s.medicines.every((m) => m.delivered);
    const backupOk = this.s.routes.records.some((r) => r.complete);
    const tempsOk = this.s.boxes
      .filter((b) => b.delivered)
      .every((b) => {
        const med = MEDICINES.find((m) => m.box === b.id);
        return b.temp >= med.min && b.temp <= med.max;
      });
    if (allDelivered && backupOk && tempsOk) {
      this.s.pendingSuccess = true;
      this._log("all_delivered_pending_observe", { tick: this.s.tick });
    }
    if (
      this.s.pendingSuccess &&
      this.s.observe.clean !== null &&
      this.s.status === "running"
    ) {
      this._finish(
        this.s.observe.clean ? "success" : "failed",
        this.s.observe.clean ? null : "residual",
        { observe: this.s.observe.clean },
      );
    }
  }

  _finish(status, reason, detail) {
    this.s.status = status;
    if (status === "failed") {
      this.s.failure = { reason, ...detail, tick: this.s.tick };
      this._log("mission_failed", this.s.failure);
    } else {
      this._log("mission_success", { tick: this.s.tick });
    }
  }
}
