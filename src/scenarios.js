/* Scripted, fully deterministic input sets for the rescue simulation.
   Every entry is { at: tick, cmd: {...} } and can be fed to engine.loadScript. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RescueScenarios = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var winningScript = [
    { at: 2,  cmd: { type: 'EXTRACT', casualty: 'c4' } },
    { at: 3,  cmd: { type: 'DISPATCH', amb: 'AMB1', casualties: ['c3', 'c1'], medpoint: 'M1' } },
    { at: 4,  cmd: { type: 'DISPATCH', amb: 'AMB2', casualties: ['c5', 'c6'], medpoint: 'M2' } },
    { at: 5,  cmd: { type: 'DISPATCH', amb: 'AMB3', casualties: ['c8', 'c9'], medpoint: 'M2' } },
    { at: 150, cmd: { type: 'CLEAR', edge: 'e4' } },
    { at: 300, cmd: { type: 'DISPATCH', amb: 'AMB1', casualties: ['c4', 'c2'], medpoint: 'M1' } },
    { at: 430, cmd: { type: 'EXTRACT', casualty: 'c7' } },
    { at: 620, cmd: { type: 'DISPATCH', amb: 'AMB2', casualties: ['c7'], medpoint: 'M2' } },
    { at: 650, cmd: { type: 'EXTRACT', casualty: 'c10' } },
    { at: 820, cmd: { type: 'DISPATCH', amb: 'AMB3', casualties: ['c10'], medpoint: 'M2' } }
  ];

  /* Repeatable failure scenario:
     - All three ambulances are stacked on block A, leaving B and C waiting.
     - M2 is never used, so its beds stay idle.
     - SAR chases extraction c4 then stays idle; no blocked road is cleared.
     - e8 (B-M2) and e5 (B-C) remain blocked after the later aftershocks,
       forcing long detours while RED casualties exceed their deadlines. */
  var failureScript = [
    { at: 2, cmd: { type: 'EXTRACT', casualty: 'c4' } },
    { at: 3, cmd: { type: 'DISPATCH', amb: 'AMB1', casualties: ['c1'], medpoint: 'M1' } },
    { at: 4, cmd: { type: 'DISPATCH', amb: 'AMB2', casualties: ['c3'], medpoint: 'M1' } },
    { at: 5, cmd: { type: 'DISPATCH', amb: 'AMB3', casualties: ['c2'], medpoint: 'M1' } },
    { at: 400, cmd: { type: 'DISPATCH', amb: 'AMB1', casualties: ['c4'], medpoint: 'M1' } }
  ];

  /* Recovery scenario: exercises every fixed aftershock, clears every blocked
     edge with SAR, and keeps an ambulance moving across the third aftershock
     so the route recalculation is observable. Used with a 1400-tick horizon so
     the post-recovery OBSERVE_TICKS (600) quiet window is fully exercised. */
  var recoveryScript = [
    { at: 2,   cmd: { type: 'EXTRACT', casualty: 'c4' } },
    { at: 3,   cmd: { type: 'DISPATCH', amb: 'AMB1', casualties: ['c3', 'c1'], medpoint: 'M1' } },
    { at: 4,   cmd: { type: 'DISPATCH', amb: 'AMB2', casualties: ['c5'], medpoint: 'M2' } },
    { at: 5,   cmd: { type: 'DISPATCH', amb: 'AMB3', casualties: ['c8', 'c9'], medpoint: 'M2' } },
    { at: 90,  cmd: { type: 'CLEAR', edge: 'e4' } },
    { at: 150, cmd: { type: 'EXTRACT', casualty: 'c7' } },
    { at: 250, cmd: { type: 'EXTRACT', casualty: 'c10' } },
    { at: 380, cmd: { type: 'DISPATCH', amb: 'AMB1', casualties: ['c4'], medpoint: 'M1' } },
    { at: 490, cmd: { type: 'CLEAR', edge: 'e8' } },
    { at: 600, cmd: { type: 'DISPATCH', amb: 'AMB3', casualties: ['c6'], medpoint: 'M2' } },
    { at: 700, cmd: { type: 'REPOSITION', amb: 'AMB2', node: 'B' } },
    { at: 775, cmd: { type: 'DISPATCH', amb: 'AMB2', casualties: ['c10'], medpoint: 'M2' } },
    { at: 790, cmd: { type: 'CLEAR', edge: 'e5' } },
    { at: 1000, cmd: { type: 'DISPATCH', amb: 'AMB3', casualties: ['c2'], medpoint: 'M1' } },
    { at: 1050, cmd: { type: 'DISPATCH', amb: 'AMB1', casualties: ['c7'], medpoint: 'M2' } }
  ];

  return {
    winningScript: winningScript,
    failureScript: failureScript,
    recoveryScript: recoveryScript
  };
});
