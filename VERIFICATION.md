# Verification Record

Generated from seed `7319` on 2026-11-15.

## Fixed map

- Layout hash: `465a39d2`
- Reachability: `7/7` (`HOME`, artifacts `A/B/C`, route nodes `R1/R2/R3`)
- Same-seed world reconstruction: obstacles, artifacts and route nodes are byte-identical after JSON normalization.

## Three samples, then return failure

- Simulation duration: `96.2 s`
- Scans: `4`, route nodes surveyed: `R1/R2/R3`, hull segments seen: `12/12`
- Samples: `A/B/C = SAMPLED`
- Collision fault at `T+85.1 s`
- Failure at `T+96.2 s`, phase `RETURN`, reason `BATTERY_DEPLETED`

Fault snapshot:

| State | O2 | Battery | Arm | Impact speed |
| --- | ---: | ---: | ---: | ---: |
| Before | 92.536% | 59.191% | 49.000% | 41.43 kn |
| After | 91.436% | 54.391% | 41.127% | 41.43 kn |
| Delta | -1.100 | -4.800 | -7.873 | recorded |

The active fault is `PROPULSION-LEAK` with battery and oxygen leak rates. The replayed collision is caused by the risky shortcut on the return leg, not by a scripted final-state assignment.

## Same-input dual run

`runDoubleAudit(7319)` executes the complete failure scenario twice and compares:

```text
sameLayout            true
sameInputDigest       true
sameMissionSequence   true
sameResourceTimeline  true
sameFinalResult       true
sameFailure           true
```

- Mission events compared: `15`
- Resource timeline samples compared: `97`
- Final result in both runs: `failed / RETURN / BATTERY_DEPLETED`, `3/3` artifacts sampled.

## Recovery and fixed observation window

- Collision fault at `T+6.233 s`
- Emergency recovery completed at `T+7.067 s`
- Observation window: exactly `300` fixed ticks = `10.000 s`
- At observation end: active fault `null`, battery leak `0`, oxygen leak `0`, active pings `0`, active sampling `null`, pending timers `0`, active audio voices `0`
- Oxygen and battery continue to decrease only from the normal life-support load; arm durability remains unchanged.
- Core runtime remains finite and `running`; ROV velocity remains zero after recovery.

## Reproduce

```bash
npm test
npm run audit
```
