import { BlackwaterGame, TICK } from "./game.js";
import { planPath } from "./world.js";
import { hashString, round } from "./rng.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angleDelta = (target, current) => Math.atan2(Math.sin(target - current), Math.cos(target - current));

class Pilot {
  constructor(game) {
    this.game = game;
    this.goal = null;
    this.mode = "path";
    this.boost = false;
    this.path = [];
    this.pathIndex = 0;
    this.replanAt = 0;
  }

  setGoal(goal, { mode = "path", boost = false } = {}) {
    const changed = !this.goal || distance(this.goal, goal) > 2 || this.mode !== mode;
    this.goal = { x: goal.x, y: goal.y };
    this.mode = mode;
    this.boost = boost;
    if (changed) {
      this.path = [];
      this.pathIndex = 0;
      this.replanAt = 0;
    }
  }

  stop() {
    this.goal = null;
    this.path = [];
    this.game.clearControls();
  }

  tick() {
    const game = this.game;
    game.clearControls();
    if (!this.goal) return;
    if (this.mode === "path" && (game.time >= this.replanAt || this.path.length === 0)) {
      this.path = planPath(game.world, game.position, this.goal);
      this.pathIndex = Math.min(1, Math.max(0, this.path.length - 1));
      this.replanAt = game.time + 2.8;
    }

    let aim = this.goal;
    if (this.mode === "path" && this.path.length > 1) {
      while (this.pathIndex < this.path.length - 1 && distance(game.position, this.path[this.pathIndex]) < 19) {
        this.pathIndex += 1;
      }
      aim = this.path[this.pathIndex];
    }

    const toGoal = distance(game.position, this.goal);
    const desired = Math.atan2(aim.y - game.position.y, aim.x - game.position.x);
    const difference = angleDelta(desired, game.heading);
    game.setControl("turn", clamp(difference * 2.9, -1, 1));
    if (Math.abs(difference) > 1.08) {
      game.setControl("thrust", 0.08);
      return;
    }
    const thrust = Math.abs(difference) > 0.55
      ? 0.12
      : toGoal > 82
        ? (this.boost ? 0.86 : 0.7)
        : clamp(toGoal / 82, 0.18, 0.62);
    game.setControl("thrust", thrust);
    game.setControl("boost", this.boost && Math.abs(difference) < 0.18 && toGoal > 95);
  }
}

function scrubFault(fault) {
  return {
    id: fault.id,
    code: fault.code,
    label: fault.label,
    phase: fault.phase,
    at: fault.at,
    before: fault.before,
    after: fault.after,
    delta: fault.delta,
  };
}

function missionEvents(events) {
  const types = new Set([
    "echo",
    "echo-blocked",
    "sample-start",
    "sample-complete",
    "sample-abort",
    "route-node",
    "collision",
    "fault",
    "recovery",
    "failure",
    "mission-complete",
  ]);
  return events
    .filter((event) => types.has(event.type))
    .map((event) => ({ time: event.time, type: event.type, label: event.label }));
}

class ScenarioBase {
  constructor(seed) {
    this.seed = seed;
    this.game = new BlackwaterGame({ seed });
    this.pilot = new Pilot(this.game);
    this.phase = 0;
    this.phaseTime = 0;
    this.elapsed = 0;
    this.finished = false;
    this.timeline = [];
    this.lastTimelineSecond = -1;
    this.inputTrace = [];
    this.game.start();
  }

  setPhase(phase) {
    this.phase = phase;
    this.phaseTime = 0;
    this.phaseAction = false;
  }

  captureInput() {
    const controls = this.game.controls;
    this.inputTrace.push(
      `${controls.thrust.toFixed(3)}:${controls.turn.toFixed(3)}:${controls.boost ? 1 : 0}`,
    );
  }

  recordTimeline() {
    const second = Math.floor(this.game.time);
    if (second === this.lastTimelineSecond) return;
    this.lastTimelineSecond = second;
    const snap = this.game.snapshot();
    this.timeline.push({
      t: second,
      phase: snap.phase,
      oxygen: snap.resources.oxygen,
      battery: snap.resources.battery,
      arm: snap.resources.arm,
      x: snap.position.x,
      y: snap.position.y,
      scans: snap.scanCount,
      samples: snap.sampledCount,
    });
  }

  inputDigest() {
    const actions = this.game.actions.map((action) => `${action.tick}:${action.type}:${action.value}`).join("|");
    return hashString(`${this.inputTrace.join("|")}#${actions}`);
  }
}

export class FailureScenario extends ScenarioBase {
  constructor(seed = 7319) {
    super(seed);
    this.collisionTarget = this.game.world.obstacles.find((obstacle) => obstacle.drill)
      ?? this.game.world.obstacles.find((obstacle) => obstacle.id === "O08");
    this.returnHold = { x: 445, y: 820 };
  }

  step(dt = TICK) {
    if (this.finished) return this.result();
    const game = this.game;
    this.phaseTime += dt;
    this.elapsed += dt;
    this.pilot.tick();
    this.captureInput();

    const artifact = this.phase <= 3 ? game.artifacts[0] : this.phase <= 6 ? game.artifacts[1] : game.artifacts[2];
    const basePhase = this.phase % 3;
    if (this.phase === 0) {
      if (this.phaseTime >= 0.12) {
        game.ping();
        this.setPhase(1);
      }
    } else if (this.phase <= 9) {
      if (basePhase === 1) {
        this.pilot.setGoal(artifact, { mode: "path" });
        if (distance(game.position, artifact) < 39) {
          this.pilot.stop();
          this.setPhase(this.phase + 1);
        }
      } else if (basePhase === 2) {
        if (!this.phaseAction && game.scanCooldown <= 0) {
          game.ping();
          this.phaseAction = true;
        }
        if (this.phaseAction && this.phaseTime > 1.45) this.setPhase(this.phase + 1);
      } else {
        const speed = Math.hypot(game.velocity.x, game.velocity.y);
        if (!game.sampling && !artifact.sampled && speed < 9 && this.phaseTime > 0.2) {
          game.beginSample();
        }
        if (artifact.sampled || this.phaseTime > 9) this.setPhase(this.phase + 1);
      }
    } else if (this.phase === 10) {
      this.pilot.setGoal(this.collisionTarget, { mode: "raw", boost: true });
      if (game.activeFault) {
        this.pilot.stop();
        this.setPhase(11);
      }
      if (this.phaseTime > 24) this.setPhase(11);
    } else if (this.phase === 11) {
      this.pilot.setGoal(this.returnHold, { mode: "path" });
      if (game.status === "failed") {
        this.finish();
      } else if (distance(game.position, this.returnHold) < 35 && this.phaseTime > 7) {
        this.pilot.stop();
      }
    }

    game.update(dt);
    this.recordTimeline();
    if (game.status === "failed" || game.status === "complete" || this.elapsed > 150) {
      this.finish();
    }
    return this.result();
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.pilot.stop();
  }

  get evidence() {
    const final = this.game.snapshot();
    return {
      seed: this.seed,
      layoutHash: this.game.world.layoutHash,
      reachability: this.game.reachability,
      inputDigest: this.inputDigest(),
      missionSequence: missionEvents(this.game.events),
      timeline: this.timeline,
      final,
      faults: this.game.faults.map(scrubFault),
      failure: this.game.failure,
      sampledCount: this.game.sampledCount,
      scanned: this.game.scanCount,
      duration: round(this.game.time, 3),
    };
  }

  result() {
    return {
      finished: this.finished,
      phase: this.phase,
      progress: this.finished ? 1 : clamp(this.game.time / 90, 0, 0.98),
      game: this.game,
      evidence: this.evidence,
    };
  }
}

export class RecoveryScenario extends ScenarioBase {
  constructor(seed = 7319) {
    super(seed);
    this.drillTarget = this.game.world.obstacles.find((obstacle) => obstacle.drill);
    this.observationSeconds = 10;
    this.observationElapsed = 0;
    this.observationTicks = 0;
    this.recoveryAt = null;
    this.observationStart = null;
    this.residualAudit = null;
    this.startTimeline = null;
  }

  step(dt = TICK) {
    if (this.finished) return this.result();
    const game = this.game;
    this.phaseTime += dt;
    this.elapsed += dt;
    this.pilot.tick();
    this.captureInput();

    if (this.phase === 0) {
      this.pilot.setGoal(this.drillTarget, { mode: "raw", boost: true });
      if (game.activeFault) {
        this.startTimeline = this.game.snapshot();
        this.pilot.stop();
        this.setPhase(1);
      }
    } else if (this.phase === 1) {
      if (this.phaseTime >= 0.8) {
        const recovered = game.emergencyRecovery();
        if (recovered) {
          this.recoveryAt = round(game.time, 3);
          this.observationStart = game.snapshot();
          this.setPhase(2);
        }
      }
    } else if (this.phase === 2) {
      if (this.observationStart === null) this.observationStart = this.game.snapshot();
      this.observationTicks += 1;
      this.observationElapsed = round(this.observationTicks * TICK, 3);
      if (this.observationTicks >= Math.round(this.observationSeconds / TICK)) {
        this.residualAudit = this.auditResiduals();
        this.finish();
      }
    }

    game.update(dt);
    this.recordTimeline();
    if (game.status === "failed" || game.status === "complete" || this.elapsed > 60) this.finish();
    return this.result();
  }

  auditResiduals() {
    const runtime = this.game.runtimeDiagnostics();
    return {
      ...runtime,
      observationSeconds: round(this.observationElapsed, 3),
      noActiveFault: runtime.activeFault === null,
      noActiveLeak: runtime.activeLeaks.battery === 0 && runtime.activeLeaks.oxygen === 0,
      noActivePings: runtime.activePings === 0,
      noActiveSampling: runtime.activeSampling === null,
      noPendingTimers: runtime.pendingTimers === 0,
      stable: runtime.status === "running" && runtime.finiteState,
      resourceInBounds: this.game.resources.oxygen > 0
        && this.game.resources.battery > 0
        && this.game.resources.arm > 0,
    };
  }

  finish() {
    if (this.finished) return;
    if (!this.residualAudit) this.residualAudit = this.auditResiduals();
    this.finished = true;
    this.pilot.stop();
  }

  get evidence() {
    return {
      seed: this.seed,
      layoutHash: this.game.world.layoutHash,
      inputDigest: this.inputDigest(),
      fault: this.game.faults[0] ? scrubFault(this.game.faults[0]) : null,
      recovery: this.game.recovery,
      observation: {
        requiredSeconds: this.observationSeconds,
        observedSeconds: round(this.observationElapsed, 3),
        startedAt: this.recoveryAt,
        start: this.observationStart,
        end: this.game.snapshot(),
      },
      residualAudit: this.residualAudit,
      timeline: this.timeline,
      final: this.game.snapshot(),
    };
  }

  result() {
    return {
      finished: this.finished,
      phase: this.phase,
      progress: clamp((this.phase === 2 ? 0.65 + this.observationElapsed / this.observationSeconds * 0.35 : this.phase * 0.3), 0, 1),
      game: this.game,
      evidence: this.evidence,
    };
  }
}

export function runFailureScenario(seed = 7319) {
  const scenario = new FailureScenario(seed);
  let guard = 0;
  while (!scenario.finished && guard < 6000) {
    scenario.step(TICK);
    guard += 1;
  }
  return scenario.evidence;
}

export function runRecoveryScenario(seed = 7319) {
  const scenario = new RecoveryScenario(seed);
  let guard = 0;
  while (!scenario.finished && guard < 3000) {
    scenario.step(TICK);
    guard += 1;
  }
  return scenario.evidence;
}

export function runDoubleAudit(seed = 7319) {
  const first = runFailureScenario(seed);
  const second = runFailureScenario(seed);
  const checks = {
    sameLayout: first.layoutHash === second.layoutHash,
    sameInputDigest: first.inputDigest === second.inputDigest,
    sameMissionSequence: JSON.stringify(first.missionSequence) === JSON.stringify(second.missionSequence),
    sameResourceTimeline: JSON.stringify(first.timeline) === JSON.stringify(second.timeline),
    sameFinalResult: JSON.stringify(first.final) === JSON.stringify(second.final),
    sameFailure: JSON.stringify(first.failure) === JSON.stringify(second.failure),
  };
  return {
    seed,
    first,
    second,
    checks,
    pass: Object.values(checks).every(Boolean),
  };
}
