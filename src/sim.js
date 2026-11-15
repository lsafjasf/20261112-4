export const WORLD = Object.freeze({ width: 1600, height: 900 });
export const FIXED_DT = 1 / 60;
export const TICKS_PER_SECOND = 60;

export const LIMITS = Object.freeze({
  fuel: 100,
  collisions: 3,
  captureRange: 72,
  deliveryRange: 92,
  maxAngularSpeed: 2.15,
  shipRadius: 15,
});

export const SHIP = Object.freeze({
  dryMass: 1200,
  inertia: 780000,
  inertiaPerKg: 640,
  thrust: 60000,
  reverseFactor: 0.56,
  torque: 2800000,
  linearDrag: 0.022,
  angularDrag: 0.34,
  windForce: 26000,
  fuelThrust: 0.95,
  fuelTurn: 0.1,
  fuelCapture: 0.35,
});

export const STATION = Object.freeze({ x: 236, y: 690, radius: 58 });
export const NO_GO = Object.freeze({ x: 1115, y: 176, radius: 94 });

export const DEBRIS_BLUEPRINTS = Object.freeze([
  { id: "panel", label: "太阳能板", mass: 150, radius: 12, x: 426, y: 506, type: "panel", color: "#79d7ff" },
  { id: "tank", label: "推进剂罐", mass: 270, radius: 15, x: 663, y: 356, type: "tank", color: "#ffd166" },
  { id: "truss", label: "桁架残段", mass: 410, radius: 18, x: 842, y: 708, type: "truss", color: "#ff8fab" },
  { id: "core", label: "反应堆芯", mass: 620, radius: 21, x: 1282, y: 548, type: "core", color: "#b8f2a2" },
]);

export const TRAFFIC_BANDS = Object.freeze([
  { id: "alpha", angle: -0.19, y: 252, amplitude: 54, speed: 0.31, phase: 0.2, width: 82, satellites: 2 },
  { id: "beta", angle: 0.27, y: 586, amplitude: 48, speed: -0.25, phase: 1.7, width: 70, satellites: 2 },
]);

export const FAILURE_LABELS = Object.freeze({
  FUEL: "燃料耗尽",
  COLLISION_LIMIT: "碰撞次数超限",
  NO_GO: "进入禁航带",
});

const TAU = Math.PI * 2;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function wrapAngle(angle) {
  let next = angle;
  while (next > Math.PI) next -= TAU;
  while (next < -Math.PI) next += TAU;
  return next;
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function nextRandom(state) {
  let next = state >>> 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return next >>> 0;
}

export function hashNumber(value) {
  let hash = 0x811c9dc5;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function queueEvent(state, type, detail = {}) {
  state.events.push({ tick: state.tick, type, ...detail });
  if (state.events.length > 180) state.events.splice(0, state.events.length - 180);
}

export function getTotalMass(state) {
  if (!state.attachedId) return SHIP.dryMass;
  const debris = state.debris.find((item) => item.id === state.attachedId);
  return SHIP.dryMass + (debris?.mass ?? 0);
}

export function getControlProfile(state) {
  const mass = getTotalMass(state);
  const debris = state.attachedId
    ? state.debris.find((item) => item.id === state.attachedId)
    : null;
  const inertia = SHIP.inertia + (debris?.mass ?? 0) * SHIP.inertiaPerKg;
  return {
    attachedMass: debris?.mass ?? 0,
    totalMass: mass,
    inertia,
    linearAccel: SHIP.thrust / mass,
    angularAccel: SHIP.torque / inertia,
    loadRatio: mass / SHIP.dryMass,
  };
}

export function bandGeometry(band, time) {
  const centerY = band.y + Math.sin(time * band.speed + band.phase) * band.amplitude;
  const dx = Math.cos(band.angle);
  const dy = Math.sin(band.angle);
  const satellites = [];
  for (let index = 0; index < band.satellites; index += 1) {
    const offset = (time * (104 + index * 23) + index * 611 + band.phase * 160) % 1960;
    const travel = -180 + offset;
    satellites.push({
      id: `${band.id}-${index}`,
      x: WORLD.width * 0.5 + dx * travel,
      y: centerY + dy * travel,
      radius: 7,
    });
  }
  return { ...band, centerY, dx, dy, satellites };
}

export function bandDistance(point, band) {
  const dx = point.x - WORLD.width * 0.5;
  const dy = point.y - band.centerY;
  return Math.abs(dx * band.dy - dy * band.dx);
}

export function makeInitialState(seed) {
  const state = {
    seed: seed >>> 0,
    rngState: (seed >>> 0) || 0x9e3779b9,
    tick: 0,
    time: 0,
    status: "active",
    failure: null,
    failureBefore: null,
    success: null,
    collisionCooldown: 0,
    collisionCount: 0,
    deliveredCount: 0,
    deliveryOrder: [],
    attachedId: null,
    events: [],
    ship: {
      x: 292,
      y: 668,
      vx: 0,
      vy: 0,
      angle: -0.34,
      angularVelocity: 0,
      fuel: LIMITS.fuel,
      radius: LIMITS.shipRadius,
    },
    debris: DEBRIS_BLUEPRINTS.map((blueprint, index) => ({
      ...blueprint,
      x: blueprint.x,
      y: blueprint.y,
      vx: 0,
      vy: 0,
      angle: index * 0.8,
      spin: 0.12 + index * 0.045,
      state: "free",
      capturedTick: null,
      deliveredTick: null,
    })),
    wind: { active: false, direction: 1, strength: 0, gust: 0 },
    controls: { thrust: 0, turn: 0, capture: false, release: false },
    inputs: [],
    previousCapture: false,
    previousRelease: false,
  };

  state.rngState = nextRandom(state.rngState);
  state.debris.forEach((debris) => {
    state.rngState = nextRandom(state.rngState);
    const jitter = (state.rngState / 0xffffffff - 0.5) * 12;
    debris.angle += jitter * 0.03;
  });
  return state;
}

function normalizeInput(input = {}) {
  return {
    thrust: clamp(Number(input.thrust) || 0, -1, 1),
    turn: clamp(Number(input.turn) || 0, -1, 1),
    capture: Boolean(input.capture),
    release: Boolean(input.release),
  };
}

export class Simulation {
  constructor({ seed = 550 } = {}) {
    this.seed = seed >>> 0;
    this.reset(this.seed);
  }

  reset(seed = this.seed) {
    this.seed = seed >>> 0;
    this.state = makeInitialState(this.seed);
    return this.state;
  }

  getControlProfile() {
    return getControlProfile(this.state);
  }

  getBands() {
    return TRAFFIC_BANDS.map((band) => bandGeometry(band, this.state.time));
  }

  step(input = {}) {
    if (this.state.status !== "active") return this.state;

    const state = this.state;
    const action = normalizeInput(input);
    const before = this.criticalSnapshot();
    state.inputs.push(action);
    state.tick += 1;
    state.time = state.tick * FIXED_DT;
    state.controls = action;
    state.collisionCooldown = Math.max(0, state.collisionCooldown - FIXED_DT);

    this.updateWind();
    this.handleAttachment(action, before);
    this.applyShipControl(action, before);
    this.integrateShip();
    this.updateTowedDebris();
    this.integrateFreeDebris();
    this.resolveWorldBounds();
    this.checkTrafficCollisions(before);
    this.checkNoGoZone(before);
    this.checkFuel(before);
    this.checkMissionComplete(before);

    state.previousCapture = action.capture;
    state.previousRelease = action.release;
    return state;
  }

  repeatRecordedInputs(actions) {
    this.reset(this.seed);
    actions.forEach((action) => this.step(action));
    return this.state;
  }

  criticalSnapshot() {
    const state = this.state;
    const debris = state.attachedId
      ? state.debris.find((item) => item.id === state.attachedId)
      : null;
    const profile = getControlProfile(state);
    return {
      tick: state.tick,
      time: Number(state.time.toFixed(4)),
      status: state.status,
      failureReason: state.failure?.reason ?? null,
      fuel: Number(state.ship.fuel.toFixed(4)),
      collisionCount: state.collisionCount,
      deliveredCount: state.deliveredCount,
      attachedId: state.attachedId,
      totalMass: Number(profile.totalMass.toFixed(3)),
      inertia: Number(profile.inertia.toFixed(3)),
      linearAccel: Number(profile.linearAccel.toFixed(4)),
      angularAccel: Number(profile.angularAccel.toFixed(5)),
      ship: {
        x: Number(state.ship.x.toFixed(4)),
        y: Number(state.ship.y.toFixed(4)),
        vx: Number(state.ship.vx.toFixed(5)),
        vy: Number(state.ship.vy.toFixed(5)),
        angle: Number(state.ship.angle.toFixed(6)),
      },
      tow: debris
        ? {
            id: debris.id,
            x: Number(debris.x.toFixed(4)),
            y: Number(debris.y.toFixed(4)),
            mass: debris.mass,
          }
        : null,
      debris: state.debris.map((item) => ({
        id: item.id,
        state: item.state,
        x: Number(item.x.toFixed(4)),
        y: Number(item.y.toFixed(4)),
      })),
    };
  }

  snapshot() {
    const critical = this.criticalSnapshot();
    return {
      ...critical,
      wind: {
        active: this.state.wind.active,
        direction: this.state.wind.direction,
        strength: Number(this.state.wind.strength.toFixed(4)),
      },
      deliveryOrder: [...this.state.deliveryOrder],
      lastEvents: this.state.events.slice(-8),
    };
  }

  hash() {
    return hashNumber(JSON.stringify(this.criticalSnapshot()));
  }

  updateWind() {
    const state = this.state;
    const cycle = 480;
    const localTick = state.tick % cycle;
    const active = localTick >= 312 && localTick < 474;
    const phase = active ? (localTick - 312) / 162 : 0;
    const strength = active ? Math.sin(phase * Math.PI) : 0;
    const direction = (Math.floor(state.tick / cycle) + (state.seed % 2)) % 2 === 0 ? 1 : -1;
    state.wind = { active, direction, strength, gust: active ? 1 : 0 };
    if (active && !state.previousWindActive) {
      queueEvent(state, "solar-wind", { direction, strength: Number(strength.toFixed(3)) });
    }
    state.previousWindActive = active;
  }

  handleAttachment(action, before) {
    const state = this.state;

    if (action.capture && !state.previousCapture) {
      if (!state.attachedId) {
        const nearest = state.debris
          .filter((item) => item.state === "free")
          .map((item) => ({ item, gap: distance(state.ship, item) }))
          .filter(({ gap }) => gap <= LIMITS.captureRange)
          .sort((a, b) => a.gap - b.gap)[0];
        if (nearest) {
          const debris = nearest.item;
          state.attachedId = debris.id;
          debris.state = "towing";
          debris.capturedTick = state.tick;
          state.ship.fuel = Math.max(0, state.ship.fuel - SHIP.fuelCapture);
          queueEvent(state, "capture", { debrisId: debris.id, mass: debris.mass, gap: Number(nearest.gap.toFixed(2)) });
        } else {
          queueEvent(state, "arm-miss", {});
        }
      }
    }

    if (action.release && !state.previousRelease && state.attachedId) {
      const debris = state.debris.find((item) => item.id === state.attachedId);
      const atStation = distance(state.ship, STATION) <= LIMITS.deliveryRange;
      if (atStation) {
        debris.state = "delivered";
        debris.deliveredTick = state.tick;
        debris.vx = 0;
        debris.vy = 0;
        state.deliveredCount += 1;
        state.deliveryOrder.push(debris.id);
        state.attachedId = null;
        state.ship.fuel = Math.max(0, state.ship.fuel - 0.35);
        queueEvent(state, "deliver", {
          debrisId: debris.id,
          deliveredCount: state.deliveredCount,
        });
      } else {
        debris.state = "free";
        debris.vx = state.ship.vx - Math.cos(state.ship.angle) * 24;
        debris.vy = state.ship.vy - Math.sin(state.ship.angle) * 24;
        state.attachedId = null;
        queueEvent(state, "release", { debrisId: debris.id });
      }
    }
  }

  applyShipControl(action, before) {
    const state = this.state;
    const ship = state.ship;
    const profile = getControlProfile(state);
    const hasFuel = ship.fuel > 0;
    const thrustFactor = action.thrust >= 0 ? action.thrust : action.thrust * SHIP.reverseFactor;
    const burn = hasFuel ? (Math.abs(action.thrust) * SHIP.fuelThrust + Math.abs(action.turn) * SHIP.fuelTurn) * FIXED_DT : 0;
    ship.fuel = Math.max(0, ship.fuel - burn);

    if (hasFuel) {
      const accel = (SHIP.thrust * thrustFactor) / profile.totalMass;
      ship.vx += Math.cos(ship.angle) * accel * FIXED_DT;
      ship.vy += Math.sin(ship.angle) * accel * FIXED_DT;
      ship.angularVelocity += (SHIP.torque / profile.inertia) * action.turn * FIXED_DT;
    }

    if (state.wind.active) {
      const lateralX = -Math.sin(ship.angle) * state.wind.direction;
      const lateralY = Math.cos(ship.angle) * state.wind.direction;
      const windAccel = (SHIP.windForce / profile.totalMass) * state.wind.strength;
      ship.vx += lateralX * windAccel * FIXED_DT;
      ship.vy += lateralY * windAccel * FIXED_DT;
    }
  }

  integrateShip() {
    const ship = this.state.ship;
    ship.vx *= Math.exp(-SHIP.linearDrag * FIXED_DT);
    ship.vy *= Math.exp(-SHIP.linearDrag * FIXED_DT);
    ship.x += ship.vx * FIXED_DT;
    ship.y += ship.vy * FIXED_DT;
    ship.angularVelocity *= Math.exp(-SHIP.angularDrag * FIXED_DT);
    ship.angularVelocity = clamp(ship.angularVelocity, -LIMITS.maxAngularSpeed, LIMITS.maxAngularSpeed);
    ship.angle = wrapAngle(ship.angle + ship.angularVelocity * FIXED_DT);
  }

  updateTowedDebris() {
    const state = this.state;
    if (!state.attachedId) return;
    const ship = state.ship;
    const debris = state.debris.find((item) => item.id === state.attachedId);
    if (!debris) return;

    const towLength = 48 + debris.radius;
    const anchorX = ship.x - Math.cos(ship.angle) * towLength;
    const anchorY = ship.y - Math.sin(ship.angle) * towLength;
    const spring = 28;
    const damping = 7.5;
    const ax = (anchorX - debris.x) * spring - (debris.vx - ship.vx) * damping;
    const ay = (anchorY - debris.y) * spring - (debris.vy - ship.vy) * damping;

    debris.vx += ax * FIXED_DT;
    debris.vy += ay * FIXED_DT;
    debris.x += debris.vx * FIXED_DT;
    debris.y += debris.vy * FIXED_DT;
    debris.angle = ship.angle + Math.PI + Math.sin(state.tick * 0.04) * 0.07;
  }

  integrateFreeDebris() {
    this.state.debris.forEach((debris) => {
      if (debris.state !== "free") return;
      debris.vx *= Math.exp(-0.012 * FIXED_DT);
      debris.vy *= Math.exp(-0.012 * FIXED_DT);
      debris.x += debris.vx * FIXED_DT;
      debris.y += debris.vy * FIXED_DT;
      debris.angle = wrapAngle(debris.angle + debris.spin * FIXED_DT);
    });
  }

  resolveWorldBounds() {
    const ship = this.state.ship;
    const margin = ship.radius + 10;
    if (ship.x < margin || ship.x > WORLD.width - margin) {
      ship.x = clamp(ship.x, margin, WORLD.width - margin);
      ship.vx *= -0.28;
    }
    if (ship.y < margin || ship.y > WORLD.height - margin) {
      ship.y = clamp(ship.y, margin, WORLD.height - margin);
      ship.vy *= -0.28;
    }
  }

  checkTrafficCollisions(before) {
    const state = this.state;
    if (state.status !== "active" || state.collisionCooldown > 0) return;
    const bands = this.getBands();
    const contacts = [];

    if (state.attachedId) {
      const debris = state.debris.find((item) => item.id === state.attachedId);
      if (debris) contacts.push({ point: debris, radius: debris.radius, towed: true });
    }
    contacts.push({ point: state.ship, radius: state.ship.radius, towed: false });

    for (const band of bands) {
      for (const satellite of band.satellites) {
        for (const contact of contacts) {
          const gap = distance(contact.point, satellite);
          if (gap >= contact.radius + satellite.radius + 4) continue;
          state.collisionCount += 1;
          state.collisionCooldown = 0.95;
          const dx = (contact.point.x - satellite.x) / Math.max(1, gap);
          const dy = (contact.point.y - satellite.y) / Math.max(1, gap);
          state.ship.vx += dx * 96;
          state.ship.vy += dy * 96;
          queueEvent(state, "collision", {
            bandId: band.id,
            satelliteId: satellite.id,
            count: state.collisionCount,
            towed: contact.towed,
          });
          if (state.collisionCount >= LIMITS.collisions) {
            this.fail("COLLISION_LIMIT", before);
          }
          return;
        }
      }
    }
  }

  checkNoGoZone(before) {
    const state = this.state;
    if (state.status !== "active") return;
    const inside = distance(state.ship, NO_GO) < NO_GO.radius + state.ship.radius * 0.35;
    if (inside) {
      queueEvent(state, "no-go-breach", {
        zone: "no-go",
        x: Number(state.ship.x.toFixed(2)),
        y: Number(state.ship.y.toFixed(2)),
      });
      this.fail("NO_GO", before);
    }
  }

  checkFuel(before) {
    const state = this.state;
    if (state.status !== "active" || state.ship.fuel > 0) return;
    queueEvent(state, "fuel-empty", { tick: state.tick });
    this.fail("FUEL", before);
  }

  checkMissionComplete(before) {
    const state = this.state;
    if (state.status !== "active" || state.deliveredCount < state.debris.length) return;
    if (distance(state.ship, STATION) > LIMITS.deliveryRange) return;
    state.status = "complete";
    state.success = {
      tick: state.tick,
      time: Number(state.time.toFixed(3)),
      fuelRemaining: Number(state.ship.fuel.toFixed(3)),
      collisions: state.collisionCount,
      deliveryOrder: [...state.deliveryOrder],
      before,
    };
    queueEvent(state, "mission-complete", {
      fuelRemaining: state.success.fuelRemaining,
      collisions: state.collisionCount,
    });
  }

  fail(reason, before) {
    const state = this.state;
    if (state.status !== "active") return;
    state.status = "failed";
    const at = {
      ...this.criticalSnapshot(),
      status: "failed",
      failureReason: reason,
    };
    state.failure = {
      reason,
      label: FAILURE_LABELS[reason] ?? reason,
      tick: state.tick,
      time: Number(state.time.toFixed(3)),
      before,
      at,
    };
    queueEvent(state, "failure", {
      reason,
      label: state.failure.label,
      tick: state.tick,
      fuel: Number(state.ship.fuel.toFixed(3)),
      collisions: state.collisionCount,
      delivered: state.deliveredCount,
      attachedId: state.attachedId,
    });
  }
}
