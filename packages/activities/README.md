# Activity components

Tested, allowlisted activity engines — no arbitrary generated code. Since
Stage 5 (TASK-012) the catalogue holds four engines (`forces-1d-v1`,
`projectile-v1`, `lift-equation-v1`, `speed-of-sound-v1`; descriptors in
`packages/contracts/engines.ts`) plus `registry.ts`, the single dispatch
point used by validation and the UI.

All engines are pure, deterministic and browser-safe (no I/O, no `Date`, no
randomness), and all reject non-finite or out-of-domain inputs by **throwing
a `RangeError` whose message is a stable code** (documented per engine); no
function ever returns `NaN`. Hard bounds from the catalogue are enforced by
the JSON schemas — engines only enforce their mathematical domain.

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

## projectile-v1 (`projectile-v1/engine.ts`)

Deterministic, closed-form ballistic flight (no drag) launched from level
ground: `x = U0*t`, `y = V0*t - g*t^2/2`, checked output
`y_max = V0^2/(2*g)`, flight time `2*V0/g` (LEVEL-LANDING assumption — launch
and landing heights are equal; frames clamp at `y >= 0`).

| Export | Kind | Meaning |
| --- | --- | --- |
| `ENGINE_ID` | `const = 'projectile-v1'` | Component identifier. |
| `MAX_FRAMES` | `const = 3001` | Hard cap on frames per simulation. |
| `ProjectileInput` | interface | `{ horizontalSpeedMps (U0), verticalSpeedMps (V0), gravityMps2 (g) }`. |
| `ProjectileFrame` | interface | `{ t, x, y }` — one trajectory sample, `y >= 0`. |
| `maxHeightOf(input)` | function | `V0^2/(2*g)` — the checked output (reads `verticalSpeedMps`, `gravityMps2`). |
| `flightTimeOf(input)` | function | `2*V0/g` (level landing). |
| `stateAt(input, t)` | function | Closed-form frame at `t`, clamped into `[0, flightTime]`. |
| `simulate(input, stepS)` | function | Frames at `t = i*stepS` up to landing; appends one exact landing frame when the last sample is more than `1e-9` short of it. |

Error codes (`RangeError`): `VERTICAL_SPEED_NOT_POSITIVE` (V0 not finite or
<= 0), `GRAVITY_NOT_POSITIVE` (g not finite or <= 0),
`HORIZONTAL_SPEED_NOT_FINITE`, `TIME_NOT_FINITE`, `STEP_NOT_POSITIVE`,
`TOO_MANY_FRAMES` (checked before allocation).

## lift-equation-v1 (`lift-equation-v1/engine.ts`)

`L = Cl * (rho * V^2 / 2) * A` — lift coefficient times dynamic pressure
times wing area. Checked output: `liftOf(input)` in N. Static scene (wing +
lift arrow, sliders) — no frames.

| Export | Kind | Meaning |
| --- | --- | --- |
| `ENGINE_ID` | `const = 'lift-equation-v1'` | Component identifier. |
| `LiftInput` | interface | `{ liftCoefficient (Cl), airDensityKgM3 (rho), airspeedMps (V), wingAreaM2 (A) }`. |
| `liftOf(input)` | function | `Cl*rho*V^2/2*A`. |

Error codes: `LIFT_COEFFICIENT_NOT_FINITE`, `AIR_DENSITY_NOT_POSITIVE` (rho
finite and > 0), `AIRSPEED_NOT_FINITE` (sign irrelevant: V enters as V^2),
`WING_AREA_NOT_POSITIVE` (A finite and > 0).

## speed-of-sound-v1 (`speed-of-sound-v1/engine.ts`)

`a = sqrt(gamma * R * T)` for a calorically perfect ideal gas. Checked
output: `speedOfSoundOf(input)` in m/s. With gamma=1.4, R=287 J/(kg*K),
T=288.15 K this gives 340.2626... m/s (the often-quoted 340.29 m/s uses
R=287.05).

| Export | Kind | Meaning |
| --- | --- | --- |
| `ENGINE_ID` | `const = 'speed-of-sound-v1'` | Component identifier. |
| `SoundInput` | interface | `{ gamma, gasConstantJPerKgK (R), temperatureK (T) }`. |
| `speedOfSoundOf(input)` | function | `sqrt(gamma*R*T)`. |
| `wavefrontRadiusAt(input, t)` | function | `a*t` (t clamped to >= 0) for the UI wavefront animation. |

Error codes: `GAMMA_NEGATIVE` (gamma finite and >= 0; the catalogue's
gamma > 1 narrowing is schema-enforced), `GAS_CONSTANT_NOT_POSITIVE` (R
finite and > 0), `TEMPERATURE_NEGATIVE` (T finite and >= 0),
`TIME_NOT_FINITE`.

## Registry (`registry.ts`)

Single dispatch point over the catalogue — reads each engine's input keys
from `ENGINES` (packages/contracts), never from the case's own type:

| Export | Meaning |
| --- | --- |
| `computeOutput(engine, caseOrInputs)` | Recomputes the engine's checked output from any object carrying the descriptor's input keys (a behavioral test, a prediction, a case, or a slider state). Throws `RangeError('UNKNOWN_ENGINE:<id>')` for ids outside the catalogue; missing keys read as `NaN` and trip the engine's own error codes. |
| `inputKeys(engine)` / `outputKey(engine)` | The descriptor's input keys / checked-output key (e.g. `expectedLiftN`). |
| `inputsOf(engine, caseOrInputs)` | The extracted `Record<string, number>` of descriptor inputs. |

**Tests (new engines).** `projectile-v1/engine.test.ts`,
`lift-equation-v1/engine.test.ts`, `speed-of-sound-v1/engine.test.ts`,
`registry.test.ts` (`node --test`): known values (V0=20, g=9.8 →
20.408163265306122 m; Cl=0.5, rho=1.225, V=50, A=16 → 12250 N; gamma=1.4,
R=287, T=288.15 → 340.2626485525556 m/s), edge clamps (`y >= 0`,
`t ∈ [0, flightTime]`, `t >= 0`), the `MAX_FRAMES` boundary (3001 frames
pass, 3002 throw), every error code, determinism, and registry dispatch
consistency with the direct engine calls.
