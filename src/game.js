import { makeWorld, checkReachability, collisionAt, HOME, WORLD } from "./world.js";
import { round } from "./rng.js";

export const TICK = 1 / 30;
export const SAMPLE_RANGE = 56;
export const SCAN_COST = 5.2;

const OXYGEN_MAX = 100;
const BATTERY_MAX = 100;
const ARM_MAX = 100;
const COG_MAX_MASS = 20;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleDelta(target, current) {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

function segmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distance(point, a);
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq, 0, 1);
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

export class BlackwaterGame {
  constructor({ seed = 7319 } = {}) {
    this.seed = seed;
    this.world = makeWorld(seed);
    this.reachability = checkReachability(this.world);
    this.status = "ready";
    this.paused = false;
    this.time = 0;
    this.tick = 0;
    this.position = { x: 132, y: 884 };
    this.velocity = { x: 0, y: 0 };
    this.heading = -0.38;
    this.angularVelocity = 0;
    this.controls = { thrust: 0, turn: 0, boost: false };
    this.resources = { oxygen: OXYGEN_MAX, battery: BATTERY_MAX, arm: ARM_MAX };
    this.cargoMass = 0;
    this.scanCount = 0;
    this.precision = 0.46;
    this.scanCooldown = 0;
    this.pings = [];
    this.silt = [];
    this.sampling = null;
    this.events = [];
    this.eventSeq = 0;
    this.eventCursor = 0;
    this.actionSeq = 0;
    this.actions = [];
    this.faults = [];
    this.activeFault = null;
    this.failure = null;
    this.faultCooldown = 0;
    this.nextWakeAt = 0;
    this.recovery = null;
    this.stats = {
      distance: 0,
      collisions: 0,
      scans: 0,
      samples: 0,
      batterySpent: 0,
      oxygenSpent: 0,
    };
    this.artifacts = this.world.artifacts.map((artifact) => ({
      ...artifact,
      discovered: false,
      sampled: false,
      echoUntil: 0,
      lastEchoAt: -Infinity,
      obscured: false,
      sampleProgress: 0,
    }));
    this.hull = this.world.hull.map((segment) => ({ ...segment, revealUntil: 0, seen: false }));
    this.routeNodes = this.world.routeNodes.map((node) => ({ ...node, surveyed: false, revealUntil: 0 }));
    this.log("system", "ROV-07 就绪", `seed ${seed} · 可达性 ${this.reachability.passed}/${this.reachability.total}`);
  }

  get phase() {
    if (this.status === "complete") return "COMPLETE";
    const sampled = this.artifacts.filter((artifact) => artifact.sampled).length;
    if (sampled === 0) return "SURVEY";
    if (sampled < 3) return "SALVAGE";
    return distance(this.position, this.world.home) < 90 ? "DOCKSIDE" : "RETURN";
  }

  get sampledCount() {
    return this.artifacts.filter((artifact) => artifact.sampled).length;
  }

  get cogPercent() {
    return clamp((this.cargoMass / COG_MAX_MASS) * 100, 0, 100);
  }

  get hullSeenCount() {
    return this.hull.filter((segment) => segment.seen).length;
  }

  get hullCoverage() {
    return this.hullSeenCount / this.hull.length;
  }

  get routeMapped() {
    return this.routeNodes.every((node) => node.surveyed);
  }

  get distanceHome() {
    return distance(this.position, this.world.home);
  }

  start() {
    if (this.status === "ready") {
      this.status = "running";
      this.log("start", "下潜开始", "固定 seed 任务已启动");
    }
  }

  setPaused(paused) {
    if (this.status !== "running") return;
    this.paused = Boolean(paused);
    this.log("pause", this.paused ? "模拟暂停" : "模拟继续", this.paused ? "所有系统计时冻结" : "固定步长恢复");
  }

  togglePause() {
    this.setPaused(!this.paused);
  }

  clearControls() {
    this.controls.thrust = 0;
    this.controls.turn = 0;
    this.controls.boost = false;
  }

  setControl(name, value) {
    if (name === "boost") this.controls.boost = Boolean(value);
    else this.controls[name] = clamp(Number(value) || 0, -1, 1);
  }

  ping() {
    if (this.status !== "running" || this.paused) {
      this.recordAction("ping", "blocked");
      return false;
    }
    if (this.scanCooldown > 0 || this.resources.battery < SCAN_COST) {
      this.log("scan-denied", "声呐不可用", this.scanCooldown > 0 ? "换能器冷却中" : "电池低于扫描阈值", "warn");
      this.recordAction("ping", "denied");
      return false;
    }
    this.scanCount += 1;
    this.stats.scans += 1;
    this.stats.batterySpent += SCAN_COST;
    this.resources.battery = Math.max(0, this.resources.battery - SCAN_COST);
    this.precision = Math.min(0.98, 0.46 + this.scanCount * 0.065);
    this.scanCooldown = 1.05;
    this.pings.push({
      id: `P${this.scanCount}`,
      x: this.position.x,
      y: this.position.y,
      age: 0,
      radius: 12,
      maxRadius: 438,
    });
    this.emit("ping", `声呐脉冲 ${String(this.scanCount).padStart(2, "0")}`, `精度 ${Math.round(this.precision * 100)}% · 电池 -${SCAN_COST.toFixed(1)}%`, "scan");
    this.recordAction("ping", this.scanCount);
    return true;
  }

  beginSample() {
    if (this.status !== "running" || this.paused || this.sampling) {
      this.recordAction("sample", "blocked");
      return false;
    }
    if (this.activeFault) {
      this.log("sample-denied", "采样臂锁定", "先执行紧急恢复", "warn");
      this.recordAction("sample", "fault");
      return false;
    }
    if (this.resources.arm < 17) {
      this.log("sample-denied", "采样臂耐久不足", "无法再执行取样", "warn");
      this.recordAction("sample", "arm");
      return false;
    }
    const target = this.artifacts
      .filter((artifact) => !artifact.sampled)
      .map((artifact) => ({ artifact, d: distance(this.position, artifact) }))
      .sort((a, b) => a.d - b.d)[0];
    if (!target || target.d > SAMPLE_RANGE) {
      this.log("sample-denied", "取样范围外", "接近目标至 56 m 内", "warn");
      this.recordAction("sample", "range");
      return false;
    }
    if (!target.artifact.discovered) {
      this.log("sample-denied", "目标未识别", "先使用声呐测绘", "warn");
      this.recordAction("sample", "unknown");
      return false;
    }
    const obscuration = this.siltAt(target.artifact.x, target.artifact.y);
    if (obscuration > 0.5) {
      this.log("sample-denied", "泥沙遮蔽目标", `遮蔽度 ${Math.round(obscuration * 100)}%`, "warn");
      this.recordAction("sample", "silt");
      return false;
    }
    if (Math.hypot(this.velocity.x, this.velocity.y) > 24) {
      this.log("sample-denied", "潜器未稳定", "取样前需减速", "warn");
      this.recordAction("sample", "moving");
      return false;
    }
    this.sampling = { artifactId: target.artifact.id, elapsed: 0, duration: 2.7 };
    target.artifact.sampleProgress = 0;
    this.emit("sample-start", `机械臂展开 · ${target.artifact.code}`, `${target.artifact.name} 取样中`, "salvage");
    this.recordAction("sample", target.artifact.id);
    return true;
  }

  emergencyRecovery() {
    if (this.status !== "running" || !this.activeFault) {
      this.recordAction("recover", "no-fault");
      return false;
    }
    const before = this.snapshot();
    this.activeFault = null;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.angularVelocity = 0;
    this.sampling = null;
    this.clearControls();
    this.resources.battery = Math.max(0.5, this.resources.battery - 3.5);
    this.recovery = {
      at: round(this.time, 3),
      before,
      after: null,
    };
    this.recovery.after = this.snapshot();
    this.emit("recovery", "紧急恢复完成", "泄漏阀隔离 · 推进器锁定解除", "good");
    this.recordAction("recover", this.faults.length);
    return true;
  }

  update(dt = TICK) {
    if (this.status !== "running" || this.paused) return false;
    const step = clamp(dt, 0.001, 0.1);
    this.time += step;
    this.tick += 1;
    this.scanCooldown = Math.max(0, this.scanCooldown - step);
    this.faultCooldown = Math.max(0, this.faultCooldown - step);

    this.updateSampling(step);
    this.updateMotion(step);
    this.updateWake(step);
    this.updatePings(step);
    this.updateSilt(step);
    this.updateCollisions();
    this.updateResources(step);

    if (this.status === "running") this.checkOutcome();
    return true;
  }

  updateMotion(dt) {
    const thrust = clamp(this.controls.thrust, -1, 1);
    const turn = clamp(this.controls.turn, -1, 1);
    const inertia = 1 + this.cargoMass * 0.019;
    const acceleration = (this.controls.boost ? 48 : 31) / inertia;
    const forwardX = Math.cos(this.heading);
    const forwardY = Math.sin(this.heading);

    this.velocity.x += forwardX * thrust * acceleration * dt;
    this.velocity.y += forwardY * thrust * acceleration * dt;
    this.angularVelocity += (turn * 2.35) / inertia * dt;
    this.angularVelocity *= Math.exp(-4.1 * dt);
    this.heading += this.angularVelocity * dt;
    this.heading = Math.atan2(Math.sin(this.heading), Math.cos(this.heading));

    const drag = Math.exp(-(thrust !== 0 ? 0.75 : 2.25) * dt);
    this.velocity.x *= drag;
    this.velocity.y *= drag;
    const maxSpeed = this.controls.boost ? 98 / inertia : 59 / inertia;
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    if (speed > maxSpeed) {
      this.velocity.x = (this.velocity.x / speed) * maxSpeed;
      this.velocity.y = (this.velocity.y / speed) * maxSpeed;
    }

    this.position.x = clamp(this.position.x + this.velocity.x * dt, WORLD.margin, this.world.width - WORLD.margin);
    this.position.y = clamp(this.position.y + this.velocity.y * dt, WORLD.margin, this.world.height - WORLD.margin);
    this.stats.distance += speed * dt;
  }

  updateWake(dt) {
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    if (speed > 67 && this.time >= this.nextWakeAt) {
      this.addSilt(
        this.position.x - Math.cos(this.heading) * 22,
        this.position.y - Math.sin(this.heading) * 22 + 7,
        27,
        0.27,
        7.2,
      );
      this.nextWakeAt = this.time + 0.34;
    }
  }

  updateSampling(dt) {
    if (!this.sampling) return;
    const artifact = this.artifacts.find((item) => item.id === this.sampling.artifactId);
    if (!artifact) {
      this.sampling = null;
      return;
    }
    const inRange = distance(this.position, artifact) <= SAMPLE_RANGE + 9;
    const stable = Math.hypot(this.velocity.x, this.velocity.y) < 23;
    if (!inRange || !stable || this.activeFault) {
      artifact.sampleProgress = 0;
      this.sampling = null;
      this.emit("sample-abort", "取样中止", inRange ? "潜器移动导致机械臂失去锁定" : "目标超出机械臂范围", "warn");
      return;
    }
    this.sampling.elapsed += dt;
    artifact.sampleProgress = clamp(this.sampling.elapsed / this.sampling.duration, 0, 1);
    if (this.sampling.elapsed >= this.sampling.duration) {
      this.completeSample(artifact);
    }
  }

  completeSample(artifact) {
    artifact.sampled = true;
    artifact.sampleProgress = 1;
    artifact.revealUntil = this.time + 12;
    this.sampling = null;
    this.resources.arm = Math.max(0, this.resources.arm - 17);
    this.resources.battery = Math.max(0, this.resources.battery - 1.2);
    this.cargoMass += artifact.mass;
    this.stats.samples += 1;
    this.addSilt(artifact.x, artifact.y + 8, 148, 0.9, 15.5);
    this.emit(
      "sample-complete",
      `取样完成 · ${artifact.code}`,
      `${artifact.name} +${artifact.mass.toFixed(1)} kg · 重心 ${this.cogPercent.toFixed(1)}%`,
      "good",
    );
  }

  updatePings(dt) {
    for (const pulse of this.pings) {
      const previousRadius = pulse.radius;
      pulse.age += dt;
      pulse.radius = Math.min(pulse.maxRadius, 12 + pulse.age * 472);
      this.revealWithPulse(pulse, previousRadius);
    }
    this.pings = this.pings.filter((pulse) => pulse.age < 1.16);
  }

  revealWithPulse(pulse, previousRadius) {
    const lower = previousRadius - 18;
    for (const segment of this.hull) {
      const d = segmentDistance(pulse, segment.a, segment.b);
      if (d >= lower && d <= pulse.radius) {
        segment.seen = true;
        segment.revealUntil = Math.max(segment.revealUntil, this.time + 6.8);
      }
    }
    for (const artifact of this.artifacts) {
      const d = distance(pulse, artifact);
      if (d < lower || d > pulse.radius) continue;
      artifact.echoUntil = this.time + 8.5;
      const silt = this.siltAt(artifact.x, artifact.y);
      artifact.obscured = silt > 0.5;
      if (silt > 0.5) {
        if (!artifact.discovered && this.time - artifact.lastEchoAt > 1.4) {
          artifact.lastEchoAt = this.time;
          this.emit("echo-blocked", `回波衰减 · ${artifact.code}`, `泥沙遮蔽 ${Math.round(silt * 100)}%`, "warn");
        }
        continue;
      }
      if (!artifact.discovered) {
        artifact.discovered = true;
        artifact.lastEchoAt = this.time;
        this.emit("echo", `识别目标 · ${artifact.code}`, `${artifact.name} · 回波清晰`, "scan");
      }
    }
    for (const node of this.routeNodes) {
      const d = distance(pulse, node);
      if (d < lower || d > pulse.radius) continue;
      node.revealUntil = this.time + 9;
      if (!node.surveyed) {
        node.surveyed = true;
        this.emit("route-node", `航线节点 ${node.id}`, node.label, "scan");
      }
    }
  }

  updateSilt(dt) {
    for (const cloud of this.silt) cloud.age += dt;
    this.silt = this.silt.filter((cloud) => cloud.age < cloud.life).slice(-24);
  }

  addSilt(x, y, radius, strength, life) {
    this.silt.push({ x, y, radius, strength, life, age: 0 });
  }

  siltAt(x, y) {
    let amount = 0;
    for (const cloud of this.silt) {
      const d = Math.hypot(x - cloud.x, y - cloud.y);
      if (d >= cloud.radius) continue;
      const remaining = 1 - cloud.age / cloud.life;
      amount += cloud.strength * remaining * (1 - d / cloud.radius);
    }
    return clamp(amount, 0, 1);
  }

  updateCollisions() {
    const obstacle = collisionAt(this.world, this.position.x, this.position.y, 13);
    if (!obstacle) return;
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    const dx = this.position.x - obstacle.x;
    const dy = this.position.y - obstacle.y;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    const minimum = obstacle.radius + 14;
    this.position.x = obstacle.x + (dx / length) * minimum;
    this.position.y = obstacle.y + (dy / length) * minimum;
    this.velocity.x *= -0.16;
    this.velocity.y *= -0.16;
    if (speed < 13 || this.faultCooldown > 0) return;
    this.faultCooldown = 2.2;
    this.stats.collisions += 1;
    this.registerFault(obstacle, speed);
  }

  registerFault(obstacle, speed) {
    const before = this.snapshot();
    const armDamage = clamp(speed * 0.19, 6.5, 16);
    this.resources.arm = Math.max(0, this.resources.arm - armDamage);
    this.resources.battery = Math.max(0, this.resources.battery - 4.8);
    this.resources.oxygen = Math.max(0, this.resources.oxygen - 1.1);
    this.sampling = null;
    const wasActive = Boolean(this.activeFault);
    this.activeFault = {
      code: "PROPULSION-LEAK",
      label: "推进器碰撞 · 电池舱泄漏",
      since: round(this.time, 3),
      obstacleId: obstacle.id,
      leakBattery: wasActive ? this.activeFault.leakBattery + 1.4 : 4.8,
      leakOxygen: wasActive ? this.activeFault.leakOxygen + 0.08 : 0.16,
    };
    const after = this.snapshot();
    const delta = {
      oxygen: round(after.resources.oxygen - before.resources.oxygen, 2),
      battery: round(after.resources.battery - before.resources.battery, 2),
      arm: round(after.resources.arm - before.resources.arm, 2),
      speed: round(speed, 2),
    };
    const record = {
      id: `F${this.faults.length + 1}`,
      code: this.activeFault.code,
      label: this.activeFault.label,
      phase: this.phase,
      at: round(this.time, 3),
      obstacleId: obstacle.id,
      before,
      after,
      delta,
    };
    this.faults.push(record);
    this.emit("collision", `碰撞 · ${obstacle.id}`, `冲击速度 ${speed.toFixed(1)} kn`, "fail");
    this.emit("fault", this.activeFault.label, `电池泄漏 +${this.activeFault.leakBattery.toFixed(1)}%/s`, "fail");
  }

  updateResources(dt) {
    const thrust = Math.abs(this.controls.thrust);
    const turning = Math.abs(this.controls.turn);
    const speedRatio = Math.min(1, Math.hypot(this.velocity.x, this.velocity.y) / 60);
    const sampling = this.sampling ? 1 : 0;
    const leakBattery = this.activeFault?.leakBattery ?? 0;
    const leakOxygen = this.activeFault?.leakOxygen ?? 0;
    const oxygenRate = 0.052 + speedRatio * 0.075 + sampling * 0.12 + leakOxygen;
    const batteryRate = 0.034 + thrust * 0.19 + turning * 0.018 + (this.controls.boost ? 0.42 : 0) + leakBattery;
    const oxygenUsed = oxygenRate * dt;
    const batteryUsed = batteryRate * dt;
    this.resources.oxygen = Math.max(0, this.resources.oxygen - oxygenUsed);
    this.resources.battery = Math.max(0, this.resources.battery - batteryUsed);
    this.stats.oxygenSpent += oxygenUsed;
    this.stats.batterySpent += batteryUsed;
  }

  checkOutcome() {
    if (this.resources.battery <= 0) {
      this.fail("BATTERY_DEPLETED", "电池耗尽", this.sampledCount === 3 ? "返航途中电池归零" : "任务途中电池归零");
      return;
    }
    if (this.resources.oxygen <= 0) {
      this.fail("OXYGEN_DEPLETED", "氧气耗尽", "生命维持系统停止");
      return;
    }
    if (this.resources.arm <= 0) {
      this.fail("ARM_DESTROYED", "采样臂损坏", "机械臂结构失效");
      return;
    }
    const complete = this.sampledCount === 3
      && this.routeMapped
      && this.hullCoverage >= 0.55
      && this.distanceHome < this.world.home.radius + 8
      && !this.activeFault;
    if (complete) {
      this.status = "complete";
      this.clearControls();
      this.emit("mission-complete", "三件文物回收完成", "安全返航线验证通过", "good");
    }
  }

  fail(reason, label, detail) {
    if (this.status !== "running") return;
    const snapshot = this.snapshot();
    this.status = "failed";
    this.paused = false;
    this.clearControls();
    this.failure = {
      reason,
      label,
      detail,
      phase: this.phase,
      at: round(this.time, 3),
      snapshot,
    };
    this.emit("failure", label, `${this.phase} · ${detail}`, "fail");
  }

  snapshot() {
    const artifacts = {};
    for (const artifact of this.artifacts) {
      artifacts[artifact.id] = artifact.sampled ? "SAMPLED" : artifact.discovered ? "IDENTIFIED" : "UNKNOWN";
    }
    return {
      time: round(this.time, 3),
      tick: this.tick,
      status: this.status,
      phase: this.phase,
      position: {
        x: round(this.position.x, 2),
        y: round(this.position.y, 2),
        heading: round(this.heading, 4),
      },
      velocity: {
        x: round(this.velocity.x, 3),
        y: round(this.velocity.y, 3),
        speed: round(Math.hypot(this.velocity.x, this.velocity.y), 3),
      },
      resources: {
        oxygen: round(this.resources.oxygen, 3),
        battery: round(this.resources.battery, 3),
        arm: round(this.resources.arm, 3),
      },
      cogPercent: round(this.cogPercent, 3),
      scanCount: this.scanCount,
      precision: round(this.precision, 4),
      hullSeen: this.hullSeenCount,
      routeNodes: this.routeNodes.filter((node) => node.surveyed).map((node) => node.id),
      artifacts,
      sampledCount: this.sampledCount,
      activeFault: this.activeFault?.code ?? null,
      failureReason: this.failure?.reason ?? null,
      activePings: this.pings.length,
      sampling: this.sampling?.artifactId ?? null,
    };
  }

  runtimeDiagnostics() {
    const values = [
      this.resources.oxygen,
      this.resources.battery,
      this.resources.arm,
      this.position.x,
      this.position.y,
      this.velocity.x,
      this.velocity.y,
    ];
    return {
      status: this.status,
      paused: this.paused,
      activeFault: this.activeFault?.code ?? null,
      activeLeaks: this.activeFault ? {
        battery: this.activeFault.leakBattery,
        oxygen: this.activeFault.leakOxygen,
      } : { battery: 0, oxygen: 0 },
      activePings: this.pings.length,
      activeSiltClouds: this.silt.length,
      activeSampling: this.sampling?.artifactId ?? null,
      pendingTimers: 0,
      finiteState: values.every(Number.isFinite),
      recoveryCompleted: Boolean(this.recovery),
    };
  }

  advanceFor(seconds, step = TICK) {
    const count = Math.max(0, Math.round(seconds / step));
    for (let index = 0; index < count; index += 1) {
      this.update(step);
    }
    return this.snapshot();
  }

  stepOnce(seconds = 0.25) {
    if (this.status !== "running") return this.snapshot();
    const wasPaused = this.paused;
    this.paused = false;
    this.update(clamp(seconds, TICK, 0.1));
    this.paused = wasPaused;
    return this.snapshot();
  }

  recordAction(type, value) {
    this.actionSeq += 1;
    this.actions.push({ seq: this.actionSeq, tick: this.tick, time: round(this.time, 3), type, value });
  }

  consumeEvents() {
    const pending = this.events.slice(this.eventCursor);
    this.eventCursor = this.events.length;
    return pending;
  }

  log(type, label, detail = "", tag = "info") {
    this.emit(type, label, detail, tag);
  }

  emit(type, label, detail = "", tag = "info") {
    this.eventSeq += 1;
    const event = {
      seq: this.eventSeq,
      tick: this.tick,
      time: round(this.time, 3),
      type,
      label,
      detail,
      tag,
    };
    this.events.push(event);
    return event;
  }
}

export function createGame(options) {
  return new BlackwaterGame(options);
}
