import { AnimationFSM } from './fsm.js';
import { fnv1a } from './util.js';

export const STEP = 1 / 60;

export function runScenario(config, script, steps = 120) {
  const fsm = new AnimationFSM(config);
  const byTime = new Map();
  for (const item of script) {
    const key = item.t.toFixed(6);
    if (!byTime.has(key)) byTime.set(key, []);
    byTime.get(key).push(item.input);
  }
  const traces = [fsm.snapshot()];
  for (let i = 1; i <= steps; i++) {
    const key = (i * STEP).toFixed(6);
    const inputs = byTime.get(key);
    if (inputs) for (const input of inputs) fsm.input(input);
    traces.push(fsm.update(STEP));
  }
  return {
    traces,
    events: fsm.events,
    traceHash: fnv1a(JSON.stringify(traces)),
    eventHash: fnv1a(JSON.stringify(fsm.events)),
  };
}

export const continuousChain = {
  name: '连续状态切换链',
  steps: 240,
  script: [
    { t: 0.2, input: 'moveStart' },
    { t: 0.8, input: 'attack' },
    { t: 1.0, input: 'hit' },
    { t: 1.6, input: 'moveStart' },
    { t: 1.9, input: 'hit' },
    { t: 2.4, input: 'moveEnd' },
    { t: 2.8, input: 'hit' },
  ],
};

function assert(cond, message) {
  if (!cond) throw new Error('断言失败: ' + message);
}

function assertFrameMonotonic(events) {
  const frames = events.filter((e) => e.type === 'frame');
  let lastByState = new Map();
  for (const ev of frames) {
    const prev = lastByState.get(ev.state);
    if (prev !== undefined) {
      assert(ev.frame === prev + 1 || ev.frame === 0,
        `${ev.state} 帧序连续 (${prev}→${ev.frame})`);
    }
    lastByState.set(ev.state, ev.frame);
  }
}

export const boundarySuite = {
  name: '边界场景',
  cases: [
    {
      id: 'boundary-strike-hit',
      desc: '受击落在 strike 首帧：可打断攻击（非蓄力期不阻挡）',
      script: [
        { t: 0.1, input: 'attack' },
        { t: 0.7, input: 'hit' },
      ],
      steps: 120,
      mutate(config) {
        config.states.attack.chargeFrames = 3;
        config.states.attack.strikeFrames = 4;
        config.states.attack.recoveryFrames = 1;
      },
      check(events, traces, fsmEvents) {
        const blocked = events.filter((e) => e.type === 'hitBlocked');
        assert(blocked.length === 0, '非蓄力期没有错误阻挡');
        assert(events.some((e) => e.type === 'transition' && e.reason === 'hit-interrupt-attack'),
          'strike 期受击成功打断攻击');
        const frameEvents = events.filter((e) => e.type === 'frame' && e.state === 'attack');
        assert(frameEvents.length >= 4, 'attack 帧事件完整触发');
      },
    },
    {
      id: 'boundary-zero-transition',
      desc: '过渡时间为 0：瞬时切换且速度无残留',
      script: [
        { t: 0.2, input: 'moveStart' },
        { t: 0.5, input: 'hit' },
      ],
      steps: 60,
      mutate(config) {
        config.states.hit.transition = 0;
      },
      check(events, traces) {
        const hitFirst = traces.find((tr) => tr.state === 'hit');
        assert(hitFirst && hitFirst.velocity === -30, '进入 hit 后速度立即为该状态速度，无旧速度残留');
        const moveTrace = traces.find((tr) => tr.state === 'move' && !tr.inTransition);
        assert(moveTrace && moveTrace.velocity === 120, '过渡结束后移动速度按配置生效');
      },
    },
    {
      id: 'boundary-event-at-zero',
      desc: '事件点 at=0 必须在进入状态首帧触发且只触发一次',
      script: [{ t: 0.1, input: 'hit' }],
      steps: 60,
      check(events) {
        const impacts = events.filter((e) => e.type === 'sfx' && e.id === 'hit-impact');
        assert(impacts.length === 1, `hit-impact 仅触发 1 次，实际 ${impacts.length}`);
        assert(impacts[0].t <= 0.12, '事件在进入状态的采样点立即触发');
      },
    },
    {
      id: 'boundary-charge-hit-blocked',
      desc: '蓄力阶段连续受击均被阻挡，攻击状态与帧序不中断',
      script: [
        { t: 0.1, input: 'attack' },
        { t: 0.2, input: 'hit' },
        { t: 0.35, input: 'hit' },
      ],
      steps: 90,
      check(events, traces) {
        const blocked = events.filter((e) => e.type === 'hitBlocked');
        assert(blocked.length === 2, `两次蓄力受击均被阻挡，实际 ${blocked.length} 次`);
        const hitTransition = events.some((e) => e.type === 'transition' && e.to === 'hit');
        assert(!hitTransition, '蓄力期间不存在到 hit 的过渡');
        const attackFrames = events.filter((e) => e.type === 'frame' && e.state === 'attack');
        assert(attackFrames.length >= 5, '攻击帧序持续推进未被受击打断');
      },
    },
  ],
};

export const failureSuite = {
  name: '失败场景',
  cases: [
    {
      id: 'failure-bad-fps',
      desc: 'fps=0 的损坏工程：校验拒绝且不构造状态机',
      expectValidationError: 'fps',
      mutate(config) {
        config.states.move.fps = 0;
      },
    },
    {
      id: 'failure-phase-sum',
      desc: '攻击三段帧数之和不等于 frameCount：校验拒绝',
      expectValidationError: '分段帧数',
      mutate(config) {
        config.states.attack.recoveryFrames = 3;
      },
    },
    {
      id: 'failure-bad-event',
      desc: '事件点越界 / 音效名非法：校验拒绝',
      expectValidationError: 'events',
      mutate(config) {
        config.states.idle.events[0].at = 1;
        config.states.idle.events[0].sfx = 'explosion';
      },
    },
    {
      id: 'failure-unknown-input',
      desc: '未知输入名：状态机抛出明确错误',
      script: [],
      steps: 1,
      expectRuntimeError: '未知输入',
      badInput: 'castSpell',
    },
  ],
};

export const normalSuite = {
  name: '普通场景',
  cases: [
    {
      id: 'normal-chain',
      desc: '待机→移动→攻击(蓄力受击被挡)→恢复期移动打断→受击→待机',
      script: continuousChain.script,
      steps: continuousChain.steps,
      check(events, traces) {
        const reasons = events.filter((e) => e.type === 'transition').map((e) => e.reason);
        assert(reasons.includes('move-start'), '存在 move-start');
        assert(reasons.includes('attack-start'), '存在 attack-start');
        assert(events.some((e) => e.type === 'hitBlocked'), '蓄力期受击被阻挡并记录 hitBlocked');
        assert(reasons.includes('recovery-move-interrupt'), '恢复期移动成功打断攻击');
        assert(reasons.includes('hit-interrupt-move'), '移动中可被受击打断');
        assert(traces[traces.length - 1].state === 'idle', '最终回到 idle');
        assertFrameMonotonic(events);
      },
    },
    {
      id: 'normal-hit-idle',
      desc: '受击可直接打断待机',
      script: [{ t: 0.3, input: 'hit' }],
      steps: 90,
      check(events) {
        const tr = events.find((e) => e.type === 'transition');
        assert(tr && tr.from === 'idle' && tr.to === 'hit', 'idle→hit 过渡存在');
      },
    },
  ],
};
