import {
  FIXED_DT,
  LIMITS,
  NO_GO,
  SHIP,
  STATION,
  Simulation,
  clamp,
  distance,
  getControlProfile,
  hashNumber,
  wrapAngle,
} from "./sim.js";

function navigate(sim, target, options = {}) {
  const state = sim.state;
  const ship = state.ship;
  const dx = target.x - ship.x;
  const dy = target.y - ship.y;
  const gap = Math.hypot(dx, dy) || 1;
  const maxSpeed = options.maxSpeed ?? 118;
  const slowRadius = options.slowRadius ?? 150;
  const desiredSpeed = Math.min(maxSpeed, Math.max(0, (gap - 16) * 0.72));
  const desiredVx = (dx / gap) * desiredSpeed;
  const desiredVy = (dy / gap) * desiredSpeed;
  const dvx = desiredVx - ship.vx;
  const dvy = desiredVy - ship.vy;
  const dv = Math.hypot(dvx, dvy);
  const wantsThrust = dv > 2 && gap > 14;
  const desiredAngle = wantsThrust ? Math.atan2(dvy, dvx) : ship.angle;
  const turn = clamp(wrapAngle(desiredAngle - ship.angle) * 2.25, -1, 1);
  const alignment = Math.cos(wrapAngle(desiredAngle - ship.angle));
  const thrust = wantsThrust && alignment > 0.18 ? clamp(dv / 24, 0.08, 1) : 0;

  return {
    thrust,
    turn,
    capture: false,
    release: false,
    gap,
    desiredSpeed,
    slowRadius,
  };
}

export function missionController() {
  let captureLatched = false;
  let releaseLatched = false;

  return (sim) => {
    const state = sim.state;
    if (state.status !== "active") {
      return { thrust: 0, turn: 0, capture: false, release: false };
    }

    const free = state.debris.find((item) => item.state === "free");
    const attached = state.attachedId
      ? state.debris.find((item) => item.id === state.attachedId)
      : null;

    if (attached) {
      const input = navigate(sim, STATION, { maxSpeed: 88, slowRadius: 110 });
      const canRelease = input.gap <= LIMITS.deliveryRange - 8;
      const release = canRelease && !releaseLatched;
      releaseLatched = canRelease;
      return { ...input, release, capture: false };
    }

    if (!free) {
      const input = navigate(sim, STATION, { maxSpeed: 86, slowRadius: 90 });
      return { ...input, capture: false, release: false };
    }

    const input = navigate(sim, free, { maxSpeed: 108, slowRadius: 120 });
    const canCapture = input.gap <= LIMITS.captureRange - 5 && Math.hypot(state.ship.vx, state.ship.vy) < 62;
    const capture = canCapture && !captureLatched;
    captureLatched = canCapture;
    return { ...input, capture, release: false };
  };
}

export function failureController() {
  return (sim) => {
    if (sim.state.status !== "active") {
      return { thrust: 0, turn: 0, capture: false, release: false };
    }
    return navigate(sim, NO_GO, { maxSpeed: 140, slowRadius: 180 });
  };
}

export function runWithController(sim, controller, maxTicks, stopWhen = () => false) {
  const inputs = [];
  for (let index = 0; index < maxTicks; index += 1) {
    if (sim.state.status !== "active" || stopWhen(sim.state)) break;
    const action = controller(sim);
    const recorded = {
      thrust: action.thrust,
      turn: action.turn,
      capture: action.capture,
      release: action.release,
    };
    inputs.push(recorded);
    sim.step(recorded);
  }
  return inputs;
}

export function replayInputs(seed, inputs) {
  const sim = new Simulation({ seed });
  const snapshots = [];
  inputs.forEach((input) => {
    sim.step(input);
    snapshots.push(sim.criticalSnapshot());
  });
  return { sim, snapshots };
}

export function summarizeTrace(seed, inputs) {
  const first = replayInputs(seed, inputs);
  const second = replayInputs(seed, inputs);
  const firstHashes = first.snapshots.map((snapshot) => hashNumber(JSON.stringify(snapshot)));
  const secondHashes = second.snapshots.map((snapshot) => hashNumber(JSON.stringify(snapshot)));
  const firstEvents = first.sim.state.events.map((event) => `${event.tick}:${event.type}`);
  const secondEvents = second.sim.state.events.map((event) => `${event.tick}:${event.type}`);
  const sameTicks = firstHashes.length === secondHashes.length;
  const firstDivergence = sameTicks
    ? firstHashes.findIndex((value, index) => value !== secondHashes[index])
    : 0;
  const traceHash = hashNumber(firstHashes.join(""));
  return {
    pass: firstDivergence < 0
      && JSON.stringify(firstEvents) === JSON.stringify(secondEvents)
      && JSON.stringify(first.sim.criticalSnapshot()) === JSON.stringify(second.sim.criticalSnapshot()),
    tickCount: first.sim.state.tick,
    traceHash,
    replayHash: hashNumber(secondHashes.join("")),
    firstDivergence: firstDivergence < 0 ? null : firstDivergence,
    final: first.sim.criticalSnapshot(),
    deliveryOrder: [...first.sim.state.deliveryOrder],
    events: first.sim.state.events,
    after: first.sim.state,
  };
}

export function buildMissionTrial({ seed = 550, maxTicks = 7200 } = {}) {
  const sim = new Simulation({ seed });
  const initialProfile = getControlProfile(sim.state);
  const controller = missionController();
  const inputs = runWithController(
    sim,
    controller,
    maxTicks,
    (state) => state.status === "complete",
  );
  return {
    seed,
    inputs,
    initialProfile,
    result: sim.state.status,
    tick: sim.state.tick,
    deliveryOrder: [...sim.state.deliveryOrder],
    finalProfile: getControlProfile(sim.state),
    events: sim.state.events,
  };
}

export function buildFailureTrial({ seed = 550, maxTicks = 2400 } = {}) {
  const sim = new Simulation({ seed });
  const controller = failureController();
  const inputs = runWithController(
    sim,
    controller,
    maxTicks,
    (state) => state.status === "failed",
  );
  return {
    seed,
    inputs,
    failure: sim.state.failure,
    events: sim.state.events,
  };
}

export function observeRecovery(seed, inputs, observationTicks = 600) {
  const sim = new Simulation({ seed });
  inputs.forEach((input) => sim.step(input));
  const failed = sim.state.failure;
  const beforeReset = sim.criticalSnapshot();
  sim.reset(seed);
  const reset = sim.criticalSnapshot();
  const observations = [];
  for (let index = 0; index < observationTicks; index += 1) {
    sim.step({ thrust: 0, turn: 0, capture: false, release: false });
    if (index % 60 === 0) observations.push(sim.criticalSnapshot());
  }
  const after = sim.criticalSnapshot();
  observations.push(after);
  const expectedProfile = getControlProfile(new Simulation({ seed }).state);
  const allowedObservationEvents = new Set(["solar-wind"]);
  const noErrorEvents = sim.state.events.every((event) => allowedObservationEvents.has(event.type));
  const noResidual = sim.state.status === "active"
    && sim.state.failure === null
    && sim.state.attachedId === null
    && sim.state.deliveredCount === 0
    && sim.state.collisionCount === 0
    && sim.state.debris.every((item) => item.state === "free")
    && noErrorEvents
    && Math.abs(sim.state.ship.fuel - LIMITS.fuel) < 0.001
    && Math.abs(getControlProfile(sim.state).totalMass - expectedProfile.totalMass) < 0.001;
  return {
    pass: Boolean(failed) && noResidual,
    observationSeconds: observationTicks * FIXED_DT,
    failedBefore: beforeReset,
    reset,
    after,
    observations,
    noResidual,
    failureLabel: failed?.label ?? null,
  };
}

export function buildAuditReport({ seed = 550 } = {}) {
  const mission = buildMissionTrial({ seed });
  const missionReplay = summarizeTrace(seed, mission.inputs);
  const failure = buildFailureTrial({ seed });
  const failureReplay = summarizeTrace(seed, failure.inputs);
  const recovery = observeRecovery(seed, failure.inputs, 600);

  const firstCaptureTick = mission.events.find((event) => event.type === "capture")?.tick ?? 0;
  const loadedAt = firstCaptureTick
    ? replayInputs(seed, mission.inputs.slice(0, firstCaptureTick)).sim
    : null;
  const loadedProfile = loadedAt ? getControlProfile(loadedAt.state) : mission.finalProfile;
  const controlChanged = Math.abs(loadedProfile.totalMass - mission.initialProfile.totalMass) > 1
    && Math.abs(loadedProfile.linearAccel - mission.initialProfile.linearAccel) > 0.1
    && Math.abs(loadedProfile.angularAccel - mission.initialProfile.angularAccel) > 0.01;

  const sequence = missionReplay.events
    .filter((event) => ["capture", "deliver", "mission-complete", "failure", "collision"].includes(event.type))
    .map((event) => `${event.tick}:${event.type}:${event.debrisId ?? event.reason ?? ""}`);

  return {
    seed,
    generatedAt: new Date().toISOString(),
    mission: {
      pass: mission.result === "complete" && missionReplay.pass,
      status: mission.result,
      ticks: mission.tick,
      duration: Number((mission.tick * FIXED_DT).toFixed(2)),
      inputCount: mission.inputs.length,
      traceHash: missionReplay.traceHash,
      replayHash: missionReplay.replayHash,
      deliveryOrder: mission.deliveryOrder,
      sequence,
      fuelStart: LIMITS.fuel,
      final: missionReplay.final,
      controlChanged,
      initialProfile: mission.initialProfile,
      loadedProfile,
      events: missionReplay.events,
    },
    failure: {
      pass: failure.failure?.reason === "NO_GO" && failureReplay.pass,
      reason: failure.failure?.reason ?? null,
      label: failure.failure?.label ?? null,
      ticks: failure.inputs.length,
      traceHash: failureReplay.traceHash,
      replayHash: failureReplay.replayHash,
      before: failure.failure?.before ?? null,
      at: failure.failure?.at ?? null,
      events: failureReplay.events,
    },
    recovery: {
      ...recovery,
      tracePass: recovery.pass,
    },
  };
}

export function actionsForUi(inputs) {
  return inputs.map(({ thrust, turn, capture, release }) => ({
    thrust,
    turn,
    capture,
    release,
  }));
}

export const TEST_CONTROLS = Object.freeze({
  thrustForce: SHIP.thrust,
  deliveryRange: LIMITS.deliveryRange,
});
