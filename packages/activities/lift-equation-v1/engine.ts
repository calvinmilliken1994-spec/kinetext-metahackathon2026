/**
 * lift-equation-v1 — deterministic, closed-form lift equation engine.
 *
 * Pure and browser-safe: no I/O, no dependencies, no Date, no Math.random.
 * All quantities are SI: lift coefficient dimensionless, air density in
 * kg/m^3, airspeed in m/s, wing area in m^2, lift in N.
 *
 * Model:
 *   L = Cl * (rho * V^2 / 2) * A
 * i.e. lift equals the lift coefficient times the dynamic pressure times the
 * wing (planform) area. Closed form — identical on every run and platform.
 *
 * Non-finite or out-of-domain inputs are rejected by throwing a RangeError
 * whose message is a stable code (same policy as forces-1d-v1); the engine
 * never returns NaN. Hard bounds from packages/contracts/engines.ts (e.g.
 * Cl in [-2, 3]) are enforced by the schemas — the engine only enforces the
 * mathematical/physical domain: Cl and V finite (any sign), rho > 0, A > 0
 * (rho = 0 and A = 0 are the degenerate no-lift cases the catalogue excludes
 * via exclusiveMin design narrowings).
 */

export const ENGINE_ID = 'lift-equation-v1';

/** Lift equation inputs. */
export interface LiftInput {
  /** Lift coefficient Cl; must be finite (negative values mean downward lift). */
  liftCoefficient: number;
  /** Air density rho in kg/m^3; must be finite and > 0. */
  airDensityKgM3: number;
  /** Airspeed V in m/s; must be finite (enters as V^2, so the sign is irrelevant). */
  airspeedMps: number;
  /** Wing (planform) area A in m^2; must be finite and > 0. */
  wingAreaM2: number;
}

/**
 * Lift in newtons: L = Cl * rho * V^2 / 2 * A.
 *
 * @throws RangeError('LIFT_COEFFICIENT_NOT_FINITE') if liftCoefficient is not finite.
 * @throws RangeError('AIR_DENSITY_NOT_POSITIVE') unless airDensityKgM3 is finite and > 0.
 * @throws RangeError('AIRSPEED_NOT_FINITE') if airspeedMps is not finite.
 * @throws RangeError('WING_AREA_NOT_POSITIVE') unless wingAreaM2 is finite and > 0.
 */
export function liftOf(input: LiftInput): number {
  if (!Number.isFinite(input.liftCoefficient)) {
    throw new RangeError('LIFT_COEFFICIENT_NOT_FINITE');
  }
  if (!Number.isFinite(input.airDensityKgM3) || input.airDensityKgM3 <= 0) {
    throw new RangeError('AIR_DENSITY_NOT_POSITIVE');
  }
  if (!Number.isFinite(input.airspeedMps)) {
    throw new RangeError('AIRSPEED_NOT_FINITE');
  }
  if (!Number.isFinite(input.wingAreaM2) || input.wingAreaM2 <= 0) {
    throw new RangeError('WING_AREA_NOT_POSITIVE');
  }
  const { liftCoefficient, airDensityKgM3, airspeedMps, wingAreaM2 } = input;
  return liftCoefficient * airDensityKgM3 * airspeedMps * airspeedMps / 2 * wingAreaM2;
}
