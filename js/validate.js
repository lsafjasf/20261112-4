import { STATE_IDS } from './util.js';
import { PROJECT_FORMAT } from './defaults.js';

const SFX = new Set(['blip', 'tick', 'thud', 'whoosh']);

export function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    return { ok: false, errors: ['project.config 必须是对象'] };
  }
  if (config.format !== PROJECT_FORMAT) {
    errors.push(`format 应为 ${PROJECT_FORMAT}，实际为 ${String(config.format)}`);
  }
  const states = config.states;
  if (!states || typeof states !== 'object') {
    errors.push('缺少 states 定义');
    return { ok: false, errors };
  }
  for (const id of STATE_IDS) {
    validateState(id, states[id], errors);
  }
  const attack = states.attack;
  if (attack && !errors.some((e) => e.startsWith('attack.'))) {
    const sum = attack.chargeFrames + attack.strikeFrames + attack.recoveryFrames;
    if (sum !== attack.frameCount) {
      errors.push(`attack 分段帧数之和 ${sum} 不等于 frameCount ${attack.frameCount}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function validateState(id, st, errors) {
  if (!st || typeof st !== 'object') {
    errors.push(`缺少状态 ${id}`);
    return;
  }
  const num = (key, min, max, integer = false) => {
    const v = st[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(`${id}.${key} 必须是数字`);
    } else if (integer && !Number.isInteger(v)) {
      errors.push(`${id}.${key} 必须是整数`);
    } else if (v < min || v > max) {
      errors.push(`${id}.${key}=${v} 超出允许范围 [${min}, ${max}]`);
    }
  };
  num('frameCount', 1, 64, true);
  num('fps', 1, 60);
  num('transition', 0, 1000);
  num('moveSpeed', -1000, 1000);
  if (typeof st.loop !== 'boolean') errors.push(`${id}.loop 必须是布尔值`);
  if (!Array.isArray(st.events)) {
    errors.push(`${id}.events 必须是数组`);
  } else {
    st.events.forEach((ev, i) => {
      const p = `${id}.events[${i}]`;
      if (!ev || typeof ev !== 'object') {
        errors.push(`${p} 必须是对象`);
        return;
      }
      if (typeof ev.id !== 'string' || !ev.id.trim()) errors.push(`${p}.id 不能为空`);
      if (typeof ev.at !== 'number' || ev.at < 0 || ev.at >= 1) {
        errors.push(`${p}.at 必须位于 [0, 1)`);
      }
      if (!SFX.has(ev.sfx)) errors.push(`${p}.sfx=${String(ev.sfx)} 不受支持`);
    });
  }
  if (id === 'attack') {
    num('chargeFrames', 1, 64, true);
    num('strikeFrames', 1, 64, true);
    num('recoveryFrames', 0, 64, true);
  }
}
