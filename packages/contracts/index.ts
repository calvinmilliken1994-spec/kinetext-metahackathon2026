// Shared contracts v0.3.0 — owned by the lead. Changing anything here requires a contract review.
// Runtime: Node 24 type stripping, so only erasable TypeScript syntax (no enums, namespaces or parameter properties).
// v0.3 adds: several tested activity engines (packages/contracts/engines.ts), agentic repair revisions,
// teacher-provided sources and labelled demo fault injection. v0.2.0 forces specs remain valid.

import { ENGINES } from './engines.ts';
import type { EngineId } from './engines.ts';

export { ENGINES, ENGINE_IDS, isEngineId, maxTolerance, SEQUENCE_ENGINES, SEQUENCE_ENGINE_IDS, isSequenceEngineId } from './engines.ts';
export type { EngineDescriptor, EngineId, EngineInput, SequenceDescriptor, SequenceEngineId } from './engines.ts';

export const SCHEMA_VERSION = '0.3.0';
/** Schema versions the full schemas accept. 0.2.0 is forces-1d-v1 only (recorded Stage 2 evidence). */
export const ACCEPTED_SCHEMA_VERSIONS = ['0.2.0', '0.3.0'] as const;
export type SchemaVersion = typeof ACCEPTED_SCHEMA_VERSIONS[number];

/** forces-1d-v1 identifiers, kept for Stage 2 code. */
export const ENGINE_ID = 'forces-1d-v1';
export const EQUATION = 'a=F_net/m';

export type Observable = 'position' | 'velocity' | 'acceleration';

export interface Evidence { sourceId: string; quote: string }

/** A licensed source as stored by the system. `text` is the exact content hashed into `sha256`. */
export interface SourceDocument {
  id: string; title: string; locator: string; license: string; attribution: string;
  sha256: string; page?: number; text: string;
}
export type SourceRef = Omit<SourceDocument, 'text'>;

export interface Range<U extends string> { unit: U; min: number; max: number; default: number }
export interface GenRange { min: number; max: number; default: number }

// ---- Per-engine numeric cases. Each case states every engine input plus the expected output. -------------
export interface ForcesCase { massKg: number; netForceN: number; expectedAccelerationMps2: number; tolerance: number }
export interface ProjectileCase {
  horizontalSpeedMps: number; verticalSpeedMps: number; gravityMps2: number; expectedMaxHeightM: number; tolerance: number;
}
export interface LiftCase {
  liftCoefficient: number; airDensityKgM3: number; airspeedMps: number; wingAreaM2: number; expectedLiftN: number; tolerance: number;
}
export interface SoundCase {
  gamma: number; gasConstantJPerKgK: number; temperatureK: number; expectedSpeedMps: number; tolerance: number;
}
export interface CompoundInterestCase {
  principalUSD: number; annualRatePercent: number; compoundsPerYear: number; years: number; expectedAmountUSD: number; tolerance: number;
}
export interface HardyWeinbergCase { alleleFrequencyP: number; expectedHeterozygoteFrequency: number; tolerance: number }
export interface HalfLifeCase { initialAmount: number; halfLife: number; elapsedTime: number; expectedRemaining: number; tolerance: number }
/** Stage 2 name for the forces case. */
export type NumericCase = ForcesCase;
/** Any engine's case (inputs + expected output + tolerance). */
export type ActivityCase = ForcesCase | ProjectileCase | LiftCase | SoundCase | CompoundInterestCase | HardyWeinbergCase | HalfLifeCase;

export type BehavioralTestOf<C> = C & { name: string };
export type PredictionOf<C> = C & { id: string; prompt: string };
export type BehavioralTest = BehavioralTestOf<ForcesCase>;
export type Prediction = PredictionOf<ForcesCase>;
export type AnyBehavioralTest = BehavioralTestOf<ActivityCase>;
export type AnyPrediction = PredictionOf<ActivityCase>;

// ---- Per-engine simulations (full spec form: ranges carry units). ----------------------------------------
export interface ForcesSimulation {
  engine: 'forces-1d-v1'; equation: 'a=F_net/m';
  massKg: Range<'kg'>; netForceN: Range<'N'>;
  durationS: number; stepS: number;
  scenario: { objectLabel: string; surfaceLabel: string };
  observables: Observable[];
}
export interface ProjectileSimulation {
  engine: 'projectile-v1'; equation: 'y_max=V0^2/(2*g)';
  horizontalSpeedMps: Range<'m/s'>; verticalSpeedMps: Range<'m/s'>; gravityMps2: Range<'m/s^2'>;
  scenario: { objectLabel: string; settingLabel: string };
}
export interface LiftSimulation {
  engine: 'lift-equation-v1'; equation: 'L=Cl*(rho*V^2/2)*A';
  liftCoefficient: Range<'1'>; airDensityKgM3: Range<'kg/m^3'>; airspeedMps: Range<'m/s'>; wingAreaM2: Range<'m^2'>;
  scenario: { objectLabel: string; settingLabel: string };
}
export interface SoundSimulation {
  engine: 'speed-of-sound-v1'; equation: 'a=sqrt(gamma*R*T)';
  gamma: Range<'1'>; gasConstantJPerKgK: Range<'J/(kg*K)'>; temperatureK: Range<'K'>;
  scenario: { objectLabel: string; settingLabel: string };
}
type Scenario2 = { objectLabel: string; settingLabel: string };
export interface CompoundInterestSimulation {
  engine: 'compound-interest-v1'; equation: 'A=P*(1+r/(100*n))^(n*t)';
  principalUSD: Range<'USD'>; annualRatePercent: Range<'%'>; compoundsPerYear: Range<'per year'>; years: Range<'years'>;
  scenario: Scenario2;
}
export interface HardyWeinbergSimulation {
  engine: 'hardy-weinberg-v1'; equation: '2pq, q=1-p'; alleleFrequencyP: Range<'1'>; scenario: Scenario2;
}
export interface HalfLifeSimulation {
  engine: 'half-life-v1'; equation: 'N=N0*(1/2)^(t/T)';
  initialAmount: Range<'1'>; halfLife: Range<'time'>; elapsedTime: Range<'time'>; scenario: Scenario2;
}
export type Simulation =
  | ForcesSimulation | ProjectileSimulation | LiftSimulation | SoundSimulation
  | CompoundInterestSimulation | HardyWeinbergSimulation | HalfLifeSimulation;

export interface Provenance {
  provider: 'meta'; requestedModel: string; returnedModel: string; responseId: string; runId: string;
  promptVersion: string; revision: number; repairOf: number | null; generatedAt: string;
}

export interface Explanation { id: string; text: string; evidence: Evidence[] }
export interface Execution { maxWallTimeMs: number; maxRepairAttempts: number; network: false; generatedCodeAllowed: false }

interface SpecBase {
  schemaVersion: SchemaVersion; id: string; title: string; learningObjectives: string[];
  sources: SourceRef[]; explanations: Explanation[]; execution: Execution; provenance: Provenance;
}
export interface ForcesActivitySpec extends SpecBase {
  simulation: ForcesSimulation; behavioralTests: BehavioralTestOf<ForcesCase>[]; predictions: PredictionOf<ForcesCase>[];
}
export interface ProjectileActivitySpec extends SpecBase {
  simulation: ProjectileSimulation; behavioralTests: BehavioralTestOf<ProjectileCase>[]; predictions: PredictionOf<ProjectileCase>[];
}
export interface LiftActivitySpec extends SpecBase {
  simulation: LiftSimulation; behavioralTests: BehavioralTestOf<LiftCase>[]; predictions: PredictionOf<LiftCase>[];
}
export interface SoundActivitySpec extends SpecBase {
  simulation: SoundSimulation; behavioralTests: BehavioralTestOf<SoundCase>[]; predictions: PredictionOf<SoundCase>[];
}
export interface CompoundInterestActivitySpec extends SpecBase {
  simulation: CompoundInterestSimulation; behavioralTests: BehavioralTestOf<CompoundInterestCase>[]; predictions: PredictionOf<CompoundInterestCase>[];
}
export interface HardyWeinbergActivitySpec extends SpecBase {
  simulation: HardyWeinbergSimulation; behavioralTests: BehavioralTestOf<HardyWeinbergCase>[]; predictions: PredictionOf<HardyWeinbergCase>[];
}
export interface HalfLifeActivitySpec extends SpecBase {
  simulation: HalfLifeSimulation; behavioralTests: BehavioralTestOf<HalfLifeCase>[]; predictions: PredictionOf<HalfLifeCase>[];
}
/** Full activity spec — validated by schemas/activity-spec.full[.<engine>].json plus packages/validation. */
export type ActivitySpec =
  | ForcesActivitySpec | ProjectileActivitySpec | LiftActivitySpec | SoundActivitySpec
  | CompoundInterestActivitySpec | HardyWeinbergActivitySpec | HalfLifeActivitySpec;

// ---- What Muse generates (schemas/activity-spec.gen[.<engine>].json). The system adds ids, sources, engine,
// equation, units, execution and provenance. --------------------------------------------------------------
interface GenBase { title: string; learningObjectives: string[]; explanations: Explanation[] }
export interface ForcesGeneratedSpec extends GenBase {
  simulation: {
    massKg: GenRange; netForceN: GenRange; durationS: number; stepS: number;
    scenario: { objectLabel: string; surfaceLabel: string }; observables: Observable[];
  };
  behavioralTests: BehavioralTestOf<ForcesCase>[]; predictions: PredictionOf<ForcesCase>[];
}
export interface ProjectileGeneratedSpec extends GenBase {
  simulation: { horizontalSpeedMps: GenRange; verticalSpeedMps: GenRange; gravityMps2: GenRange; scenario: { objectLabel: string; settingLabel: string } };
  behavioralTests: BehavioralTestOf<ProjectileCase>[]; predictions: PredictionOf<ProjectileCase>[];
}
export interface LiftGeneratedSpec extends GenBase {
  simulation: {
    liftCoefficient: GenRange; airDensityKgM3: GenRange; airspeedMps: GenRange; wingAreaM2: GenRange;
    scenario: { objectLabel: string; settingLabel: string };
  };
  behavioralTests: BehavioralTestOf<LiftCase>[]; predictions: PredictionOf<LiftCase>[];
}
export interface SoundGeneratedSpec extends GenBase {
  simulation: { gamma: GenRange; gasConstantJPerKgK: GenRange; temperatureK: GenRange; scenario: { objectLabel: string; settingLabel: string } };
  behavioralTests: BehavioralTestOf<SoundCase>[]; predictions: PredictionOf<SoundCase>[];
}
export interface CompoundInterestGeneratedSpec extends GenBase {
  simulation: { principalUSD: GenRange; annualRatePercent: GenRange; compoundsPerYear: GenRange; years: GenRange; scenario: Scenario2 };
  behavioralTests: BehavioralTestOf<CompoundInterestCase>[]; predictions: PredictionOf<CompoundInterestCase>[];
}
export interface HardyWeinbergGeneratedSpec extends GenBase {
  simulation: { alleleFrequencyP: GenRange; scenario: Scenario2 };
  behavioralTests: BehavioralTestOf<HardyWeinbergCase>[]; predictions: PredictionOf<HardyWeinbergCase>[];
}
export interface HalfLifeGeneratedSpec extends GenBase {
  simulation: { initialAmount: GenRange; halfLife: GenRange; elapsedTime: GenRange; scenario: Scenario2 };
  behavioralTests: BehavioralTestOf<HalfLifeCase>[]; predictions: PredictionOf<HalfLifeCase>[];
}
export type GeneratedSpec =
  | ForcesGeneratedSpec | ProjectileGeneratedSpec | LiftGeneratedSpec | SoundGeneratedSpec
  | CompoundInterestGeneratedSpec | HardyWeinbergGeneratedSpec | HalfLifeGeneratedSpec;
/** The generated-spec type for one engine. */
export interface GeneratedSpecByEngine {
  'forces-1d-v1': ForcesGeneratedSpec; 'projectile-v1': ProjectileGeneratedSpec;
  'lift-equation-v1': LiftGeneratedSpec; 'speed-of-sound-v1': SoundGeneratedSpec;
  'compound-interest-v1': CompoundInterestGeneratedSpec; 'hardy-weinberg-v1': HardyWeinbergGeneratedSpec; 'half-life-v1': HalfLifeGeneratedSpec;
}
export interface ActivitySpecByEngine {
  'forces-1d-v1': ForcesActivitySpec; 'projectile-v1': ProjectileActivitySpec;
  'lift-equation-v1': LiftActivitySpec; 'speed-of-sound-v1': SoundActivitySpec;
  'compound-interest-v1': CompoundInterestActivitySpec; 'hardy-weinberg-v1': HardyWeinbergActivitySpec; 'half-life-v1': HalfLifeActivitySpec;
}

/** Muse source analysis (schemas/source-analysis.gen.json). Muse chooses the engine or 'none'. */
export interface SourceAnalysis {
  supported: boolean; activity: EngineId | 'none'; unsupportedReason: string;
  concepts: { id: string; name: string; evidence: Evidence[] }[];
  objectives: string[];
}

export type Stage = 'ingest' | 'analyze' | 'specify' | 'inject' | 'validate' | 'repair' | 'done';
export type StageStatus = 'started' | 'succeeded' | 'failed';

export interface Usage { promptTokens: number; completionTokens: number; reasoningTokens: number; cachedTokens: number }

/** Receipt for one Meta Model API call, copied from the real response. */
export interface MetaReceipt {
  purpose: 'test-live' | 'demo' | 'fake';
  requestedModel: string; returnedModel: string; responseId: string;
  usage: Usage | null; latencyMs: number; estCostUSD: number; finishReason: string; attempts: number;
  /** How estCostUSD was determined (TASK-009 R-04/R-09). Absent on receipts recorded before the fix. */
  costBasis?: 'usage' | 'reservation';
  /** Part of estCostUSD charged at a reservation because an attempt's outcome was uncertain (TASK-009 N-04). */
  reservedUnknownUSD?: number;
}

export interface StageEvent {
  jobId: string; seq: number; stage: Stage; status: StageStatus; at: string;
  model?: string; responseId?: string; usage?: Usage | null; latencyMs?: number; estCostUSD?: number; detail?: string;
  /** Spec revision this event concerns (inject / validate / repair). */
  revision?: number;
}

export type CheckKind = 'schema' | 'semantic' | 'grounding' | 'behavioral';
export interface ValidationCheck { id: string; kind: CheckKind; passed: boolean; message: string; path?: string }
export interface ValidationReport { artifactId: string; revision: number; checks: ValidationCheck[]; publishable: boolean }

// ---- Agentic repair (Stage 5). -------------------------------------------------------------------------
/**
 * One failing deterministic check passed back to Muse. `message` is system-authored but may quote model output,
 * so prompts treat findings as untrusted data. Structured numbers are never truncated (message display is).
 */
export interface RepairFinding {
  id: string; kind: CheckKind; message: string; path?: string;
  /** For numeric checks: the stated value, the engine-computed value and the tolerance used. */
  expected?: number; computed?: number; tolerance?: number;
}
/** Summary of one repair attempt, stored on the job. */
export interface RepairRecord {
  revision: number; repairOf: number;
  /** Check ids that failed on `repairOf`. */
  targeted: string[];
  /** Of `targeted`, the ids that pass on `revision`. */
  fixed: string[];
  /** Check ids failing on `revision` (may include new failures). */
  remaining: string[];
  publishable: boolean;
  /** True when revision 1 contained a system-injected demo fault. Such repairs never count in quality metrics. */
  afterInjectedFault: boolean;
}

// ---- Labelled demo fault injection (system-made, never presented as a model error). ----------------------
export const DEMO_FAULTS = ['wrong-answer', 'fabricated-quote'] as const;
export type DemoFault = typeof DEMO_FAULTS[number];
export interface FaultRecord {
  kind: DemoFault;
  /** JSON path in the generated spec that was changed; the output key depends on the engine,
   *  e.g. "behavioralTests[0].expectedAccelerationMps2" or "behavioralTests[0].expectedLiftN". */
  path: string;
  original: string | number;
  injected: string | number;
  /** The revision the fault was injected into (always the first generated revision). */
  revision: number;
  /**
   * True only when re-validating the faulty revision made the intended check fail (`behavior.tests` for
   * wrong-answer, `grounding.quotes` for fabricated-quote). False means the demo did not demonstrate a catch,
   * and the UI must say so (Stage 5 review S5-04). Absent on records made before that fix.
   */
  effective?: boolean;
}

// ---- Teacher-provided sources. -------------------------------------------------------------------------
export const USER_LICENSES = ['public-domain', 'cc-by', 'cc-by-sa', 'own-work', 'permission-granted'] as const;
export type UserLicense = typeof USER_LICENSES[number];
export interface UserSourceInput {
  title: string; text: string; license: UserLicense; attribution: string; locator?: string;
  /** Teacher confirms the right to process the text with AI models and that it has no personal or student data. */
  rightsConfirmed: true;
}
export const USER_SOURCE_LIMITS = { titleMin: 3, titleMax: 120, attributionMin: 3, attributionMax: 300, textMin: 300, textMax: 8000, locatorMax: 300 } as const;

/** Normalise pasted text exactly once; the stored text and its sha256 are of this normalised form. */
export function normalizeUserText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // Remove control characters except tab and newline.
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .trim();
}

export type UserSourceProblem =
  | 'TITLE_LENGTH' | 'TEXT_LENGTH' | 'ATTRIBUTION_LENGTH' | 'LOCATOR_LENGTH' | 'LICENSE_INVALID' | 'RIGHTS_NOT_CONFIRMED' | 'NOT_AN_OBJECT';

/** Validate a teacher source after normalising its text. Returns the cleaned input or the list of problems. */
export function validateUserSourceInput(raw: unknown): { ok: true; value: UserSourceInput } | { ok: false; problems: UserSourceProblem[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, problems: ['NOT_AN_OBJECT'] };
  const r = raw as Record<string, unknown>;
  const L = USER_SOURCE_LIMITS;
  // Metadata is single-line: any run of whitespace (including newlines) collapses to one space (review S5-03).
  const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim() : '');
  const title = str(r.title);
  const attribution = str(r.attribution);
  const locator = str(r.locator);
  const text = typeof r.text === 'string' ? normalizeUserText(r.text) : '';
  const problems: UserSourceProblem[] = [];
  if (title.length < L.titleMin || title.length > L.titleMax) problems.push('TITLE_LENGTH');
  if (text.length < L.textMin || text.length > L.textMax) problems.push('TEXT_LENGTH');
  if (attribution.length < L.attributionMin || attribution.length > L.attributionMax) problems.push('ATTRIBUTION_LENGTH');
  if (locator.length > L.locatorMax) problems.push('LOCATOR_LENGTH');
  if (!(USER_LICENSES as readonly unknown[]).includes(r.license)) problems.push('LICENSE_INVALID');
  if (r.rightsConfirmed !== true) problems.push('RIGHTS_NOT_CONFIRMED');
  if (problems.length > 0) return { ok: false, problems };
  const value: UserSourceInput = { title, text, license: r.license as UserLicense, attribution, rightsConfirmed: true };
  if (locator !== '') value.locator = locator;
  return { ok: true, value };
}

// ---- Provenance helpers (every revision is numbered the same way). --------------------------------------
type ProvenanceBase = Omit<Provenance, 'revision' | 'repairOf'>;
export function initialProvenance(base: ProvenanceBase): Provenance {
  return { ...base, revision: 1, repairOf: null };
}
export function repairProvenance(base: ProvenanceBase, previousRevision: number): Provenance {
  return { ...base, revision: previousRevision + 1, repairOf: previousRevision };
}

// ---- Assembly. -----------------------------------------------------------------------------------------
export interface AssembleOptions {
  id: string; sources: SourceDocument[]; provenance: Provenance;
  execution?: Execution;
}

const DEFAULT_EXECUTION: Execution = { maxWallTimeMs: 2000, maxRepairAttempts: 2, network: false, generatedCodeAllowed: false };

/** Simulation fields besides the engine inputs and `scenario` that each engine keeps from the generated spec. */
const ENGINE_EXTRAS: Record<EngineId, readonly string[]> = {
  'forces-1d-v1': ['durationS', 'stepS', 'observables'],
  'projectile-v1': [],
  'lift-equation-v1': [],
  'speed-of-sound-v1': [],
  'compound-interest-v1': [],
  'hardy-weinberg-v1': [],
  'half-life-v1': [],
};

/**
 * Combine Muse output with system-owned fields for the given engine. Never copies source text into the spec.
 * Ranges get the descriptor units; engine and equation come from the catalogue, never from the model; any
 * simulation field the engine does not define is dropped. `execution` and `provenance` are system-owned.
 */
export function assembleSpec<E extends EngineId>(gen: GeneratedSpecByEngine[E], engine: E, opts: AssembleOptions): ActivitySpecByEngine[E] {
  const d = ENGINES[engine];
  const g = gen.simulation as unknown as Record<string, unknown>;
  const simulation: Record<string, unknown> = { engine: d.id, equation: d.equation };
  for (const input of d.inputs) simulation[input.key] = { unit: input.unit, ...(g[input.key] as GenRange) };
  simulation.scenario = g.scenario;
  for (const key of ENGINE_EXTRAS[engine]) simulation[key] = g[key];
  return {
    schemaVersion: SCHEMA_VERSION,
    id: opts.id,
    title: gen.title,
    learningObjectives: gen.learningObjectives,
    sources: opts.sources.map(({ text: _text, ...ref }) => ref),
    explanations: gen.explanations,
    simulation,
    behavioralTests: gen.behavioralTests,
    predictions: gen.predictions,
    execution: opts.execution ?? DEFAULT_EXECUTION,
    provenance: opts.provenance,
  } as unknown as ActivitySpecByEngine[E];
}

// ---- timeline-v1 (Stage 5b, sequence engine). --------------------------------------------------------------
// Every date must be stated in one sentence unit of a verbatim quote (packages/validation); ordering answers
// are recomputed from the dates. Month/day 0 = "not stated" (structured output needs every key present).

export interface TimelineEvent {
  id: string;
  /** Short learner-facing name, 1-80 characters. */
  label: string;
  /** Integer year, -3000..2100, never 0; negative = BCE. */
  year: number;
  /** 1-12, or 0 when the source does not state it. */
  month: number;
  /** 1-31, or 0 when not stated; a day requires a month. */
  day: number;
  /** 1-2 verbatim quotes: one date unit, optionally one description. */
  evidence: Evidence[];
}
/** "Which happened first?" — earlierEventId is the expected answer, recomputed from the dates. */
export interface TimelineCase { earlierEventId: string; laterEventId: string }
export interface TimelineScenario { subjectLabel: string; settingLabel: string }
export interface TimelineSimulation { engine: 'timeline-v1'; events: TimelineEvent[]; scenario: TimelineScenario }
export interface TimelineActivitySpec extends SpecBase {
  simulation: TimelineSimulation; behavioralTests: BehavioralTestOf<TimelineCase>[]; predictions: PredictionOf<TimelineCase>[];
}
export interface TimelineGeneratedSpec extends GenBase {
  simulation: { events: TimelineEvent[]; scenario: TimelineScenario };
  behavioralTests: BehavioralTestOf<TimelineCase>[]; predictions: PredictionOf<TimelineCase>[];
}

/** Combine Muse output with system-owned fields for timeline-v1 (same rules as assembleSpec). */
export function assembleTimelineSpec(gen: TimelineGeneratedSpec, opts: AssembleOptions): TimelineActivitySpec {
  const g = gen.simulation;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: opts.id,
    title: gen.title,
    learningObjectives: gen.learningObjectives,
    sources: opts.sources.map(({ text: _text, ...ref }) => ref),
    explanations: gen.explanations,
    simulation: { engine: 'timeline-v1', events: g.events, scenario: g.scenario },
    behavioralTests: gen.behavioralTests,
    predictions: gen.predictions,
    execution: opts.execution ?? DEFAULT_EXECUTION,
    provenance: opts.provenance,
  };
}
