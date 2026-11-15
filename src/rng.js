// 确定性伪随机数：mulberry32。同 seed + 同调用序列 => 同结果。
// 引擎只通过 rng() 取随机数，因此可以整局复现。
export function createRng(seed) {
  let a = seed >>> 0;
  const state = {
    get seed() {
      return seed >>> 0;
    },
    get cursor() {
      return a >>> 0;
    },
    // 序列化后用游标恢复，保证暂停/重置后的随机序列一致。
    restore(cursor) {
      a = cursor >>> 0;
    },
    next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    // 阈值判定，便于事件日志记录。
    chance(p) {
      const value = this.next();
      return { hit: value < p, value: Number(value.toFixed(6)) };
    },
  };
  return state;
}
