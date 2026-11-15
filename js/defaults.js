import { STATE_IDS } from './util.js';

export const PROJECT_FORMAT = 'asm2d-v1';

function state(id, fps, transition, events, extra = {}) {
  return { id, frameCount: 8, fps, transition, events, ...extra };
}

export function defaultConfig() {
  return {
    format: PROJECT_FORMAT,
    version: 1,
    states: {
      idle: state('idle', 6, 120, [
        { id: 'idle-breath', at: 0.5, sfx: 'blip' },
      ], { loop: true, moveSpeed: 0 }),
      move: state('move', 12, 100, [
        { id: 'move-step', at: 0.125, sfx: 'tick' },
        { id: 'move-step-2', at: 0.625, sfx: 'tick' },
      ], { loop: true, moveSpeed: 120 }),
      hit: state('hit', 14, 80, [
        { id: 'hit-impact', at: 0.0, sfx: 'thud' },
      ], { loop: false, moveSpeed: -30 }),
      attack: state('attack', 10, 120, [
        { id: 'attack-whoosh', at: 0.625, sfx: 'whoosh' },
      ], {
        loop: false,
        moveSpeed: 24,
        chargeFrames: 5,
        strikeFrames: 2,
        recoveryFrames: 1,
      }),
    },
  };
}

export function defaultView() {
  return {
    frameLines: true,
    grid: true,
    eventMarkers: true,
    ghost: true,
    tint: '#7dd3fc',
    zoom: 1,
  };
}

export function defaultProject() {
  return {
    config: defaultConfig(),
    view: defaultView(),
    activeStateOrder: STATE_IDS.slice(),
  };
}
