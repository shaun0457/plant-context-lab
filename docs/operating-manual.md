# Operating manual: reactor-cooling subsystem (simulated)

> Simulation only. This manual describes the illustrative lumped model in this demo, not a real plant or the full TEP simulator.

## 1. What the signals mean

| Signal | Meaning | Unit | Nominal | Modelled? |
|---|---|---|---|---|
| `XMEAS(9)` | Reactor temperature, the controlled variable | degC | 120.40 | yes |
| `XMEAS(21)` | Reactor cooling-water outlet temperature | degC | 94.599 | yes |
| `XMV(10)` | Reactor cooling-water flow command, the manipulated variable | % command | 41.106 | yes, adjustable |
| `XMEAS(7)` | Reactor pressure, a lagged function of reactor temperature in this model | kPa gauge | 2705.0 | yes |
| `XMEAS(11)` | Separator temperature, a slower lagged echo of reactor temperature | degC | 80.109 | yes |
| `XMEAS(13)` | Separator pressure, follows reactor pressure | kPa gauge | 2633.7 | yes |
| other XMEAS / XMV | Noisy constants around nominal | various | see page | no |

- A PI loop moves `XMV(10)` to hold `XMEAS(9)` at its 120.40 degC setpoint. More cooling-water flow removes more heat. That holds only within the thermal state and the available utility conditions (knowledge ref `subsystem/control-relation ¶1`).
- **The cooling-water inlet temperature has no instrument.** The proposed tag RCW-IN-TT was rejected in review (`troubleshooting/unverified-instrumentation ¶1`, review-12 REJECT), so an inlet-side disturbance is not directly observable.
- `XMV(10)` range 0–100 % is a command range, not a process alarm or shutdown limit (`tags-and-limits/row-4`).
- `XMEAS(21)` has no specified alarm or shutdown limit (`tags-and-limits/row-3`). Do not infer one.

## 2. Normal operating envelope

Approved limits (see `rules://limits` for ids and sources):

| Signal | Normal upper (ALARM above) | Shutdown (TRIP at or above) | ATTENTION band (demo convention) |
|---|---|---|---|
| `XMEAS(9)` | 150 degC | 175 degC | from 142.6 degC |
| `XMEAS(7)` | 2895 kPa gauge | 3000 kPa gauge | from 2847.5 kPa gauge |

The normal upper limit is not a shutdown threshold. A competing "145 degC" claim was rejected (review-11). Both citations are kept for audit.

Typical undisturbed spread in this model (1st to 99th percentile, loop in AUTO):

- `XMEAS(9)` 120.37 to 120.43 degC
- `XMEAS(21)` 94.51 to 94.71 degC
- `XMV(10)` 40.9 to 41.3 %
- `XMEAS(7)` 2704 to 2706 kPa gauge

PCA monitor: T² and SPE on a 5-sample moving mean of the six modelled signals, with 99 % empirical limits. A score above 1 means a limit is exceeded. The monitor reports variables that contribute, never a fault name.

## 3. Response pattern of a cooling-water inlet temperature step, IDV(4)

What you typically see after a step rise in the cooling-water inlet temperature, with the loop in AUTO:

1. `XMEAS(21)` rises first (within about 1–3 simulated minutes), because the incoming water is warmer.
2. `XMEAS(9)` drifts up slightly, by about +0.4 degC for a +5 degC step and about +0.9 degC for +10 degC, and then returns to setpoint.
3. `XMV(10)` opens. This is the primary response: about +3.8 % for a +5 degC step and about +8.3 % for +10 degC, and it stays at the new operating point while the disturbance lasts.
4. `XMEAS(7)` and `XMEAS(11)` echo the small temperature bump with a lag.
5. The PCA monitor flags SPE within about 2–3 simulated minutes, with `XMEAS(21)` and `XMV(10)` as top contributors: the valve is more open than normal for the observed temperatures. The flag persists while the disturbance lasts, even after the temperatures return to normal.
6. No rule leaves NORMAL. The reactor stays about 29 degC below the normal upper limit.

Interpretation: the controller has compensated. **The usual right answer is no adjustment.** Report that the cooling-water supply should be investigated, for example by asking a human to check inlet temperature locally, because it cannot be observed from the signals.

## 4. Recommended investigation steps

1. Call `get_safety_state`. Note the worst rule state, the PCA score and its contributors, and the snapshot id.
2. If any rule is in TRIP: stop. Recommend no adjustments and escalate to a human.
3. Read `XMEAS(9)` with its unit and source identity, and keep it separate from the coolant outlet reading `XMEAS(21)` (SOP step 2).
4. Compare `XMEAS(9)` with the normal and shutdown limits in the tag table (SOP step 3).
5. When process temperature rises, compare the process and cooling-water outlet readings (troubleshooting/temperature-review): did `XMEAS(21)` move first? Did `XMV(10)` open?
6. Check the loop mode. In AUTO, decide whether the controller has already compensated. In MANUAL, someone has fixed the valve and the temperature can drift, so recommend that a human consider returning to AUTO.
7. Use `get_topology_impact` from `reactor_cooling_water_in` to list where effects could travel. Treat this as hypotheses only.
8. Only if an adjustment is justified, call `simulate_adjustment` first and then `propose_adjustment` with a rationale that cites signal ids, rule ids and the snapshot id. Accept the gate's verdict.

## 5. The adjustment gate (summary)

Every proposal is checked deterministically. The gate rejects it if any of the following holds:

- the XMV is unknown or not modelled (only `XMV(10)`);
- the target is outside 0–100 %;
- the step from the current value is over 10 %-points;
- more than 15 %-points would be applied within 10 simulated minutes;
- any rule is in TRIP;
- a 30-minute branch simulation with the change reaches ALARM or TRIP (if ALARM/TRIP happens anyway without the change, only when the change makes the worst state or a ruled peak worse);
- the change raises the peak of a ruled signal by more than 5 % of its nominal headroom compared with no change;
- the change raises the mean SPE by more than one SPE limit compared with no change, ending above the limit.

An ACCEPT is applied by putting the loop in MANUAL at the target.
