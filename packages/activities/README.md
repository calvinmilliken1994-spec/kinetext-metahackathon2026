# Activity components

Tested, allowlisted activity engines. v0.1 allows only the `forces-1d-v1`
component below — no arbitrary generated code.

## forces-1d-v1 (`forces-1d/engine.ts`)

Deterministic, closed-form 1D motion engine for a body of constant mass
under a constant net force (Newton's second law). It powers interactive
"what happens if you change the force/mass?" activities built from a
source text.

**Units (SI throughout):** mass `kg`, force `N`, acceleration `m/s^2`,
time `s`, position `m`, velocity `m/s`.

**How it works.** Every state is evaluated with the closed-form
constant-acceleration solution — `a = F/m`, `v = v0 + a*t`,
`x = x0 + v0*t + ½·a·t²` — at times `t = i*stepS` (never by repeated
addition, so times cannot drift). No numerical integration, no I/O, no
randomness, no `Date`: results are bit-identical across runs, platforms,
and between `simulate` and `stateAt`. The module is pure and
browser-safe (no `node:` imports, no dependencies).

**Exported API.**

| Export | Kind | Meaning |
| --- | --- | --- |
| `ENGINE_ID` | `const = 'forces-1d-v1'` | Component identifier for schema pinning. |
| `MAX_FRAMES` | `const = 3001` | Hard cap on frames per simulation. |
| `Frame` | interface | `{ t, x, v, a }` — one kinematic sample. |
| `SimulationInput` | interface | `{ massKg, netForceN, durationS, stepS, x0?, v0? }`; `x0`/`v0` default to 0. |
| `accelerationOf(massKg, netForceN)` | function | `F/m`. |
| `stateAt(input, t)` | function | Closed-form `Frame` at time `t`, clamped into `[0, durationS]`. |
| `simulate(input)` | function | `Frame[]` at `t = i*stepS`, `i = 0..floor(durationS/stepS + 1e-9)`. If the last sampled time is more than `1e-9` below `durationS`, one final frame at exactly `t = durationS` is appended. |

**Validation (all `RangeError`, message = code).**

| Code | Thrown when |
| --- | --- |
| `MASS_NOT_POSITIVE` | `massKg` is not finite and > 0. |
| `FORCE_NOT_FINITE` | `netForceN` is not finite. |
| `DURATION_NOT_POSITIVE` | `durationS` is not finite and > 0. |
| `STEP_NOT_POSITIVE` | `stepS` is not finite and > 0. |
| `INITIAL_STATE_NOT_FINITE` | `x0` or `v0` is given and not finite. |
| `TOO_MANY_FRAMES` | The frame count (including a possible appended final frame) would exceed `MAX_FRAMES` — checked before allocating. |

**Limits.** Max 3001 frames per run (e.g. 30 s at 0.01 s steps). Constant
mass and constant net force only. `stateAt` accepts any `t` but clamps it
into the run's `[0, durationS]` window.

**Tests.** `forces-1d/engine.test.ts` (`node --test`): sign of acceleration,
zero-force uniform motion, tiny-mass extremes, frame counts and the
`MAX_FRAMES` boundary, non-divisible durations, every error code,
determinism, per-frame kinematic invariants, and `stateAt`/`simulate`
consistency including clamping.
