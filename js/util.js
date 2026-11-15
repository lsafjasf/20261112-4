export const STATE_IDS = ['idle', 'move', 'hit', 'attack'];

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function round6(v) {
  return Math.round(v * 1e6) / 1e6;
}

export function snapshotHash(obj) {
  return fnv1a(JSON.stringify(obj));
}
