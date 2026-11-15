export function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export class SeededRandom {
  constructor(seed) {
    const numeric = typeof seed === "number" ? seed : Number.parseInt(hashString(String(seed)).slice(0, 8), 16);
    this.state = numeric >>> 0;
    this.next = mulberry32(this.state);
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }

  int(min, maxInclusive) {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  pick(items) {
    return items[Math.floor(this.next() * items.length)];
  }

  fork(salt) {
    return new SeededRandom((this.state ^ Number.parseInt(hashString(String(salt)).slice(0, 8), 16)) >>> 0);
  }
}

export function stableHash(value) {
  return hashString(JSON.stringify(value));
}

export function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
