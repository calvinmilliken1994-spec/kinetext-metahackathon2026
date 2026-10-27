// Shared contracts v0.2.0 — owned by the lead. Changing anything here requires a contract review.
// Runtime: Node 24 type stripping, so only erasable TypeScript syntax (no enums, namespaces or parameter properties).

export const SCHEMA_VERSION = '0.2.0';
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
export interface NumericCase { massKg: number; netForceN: number; expectedAccelerationMps2: number; tolerance: number }
export interface BehavioralTest extends NumericCase { name: string }
export interface Prediction extends NumericCase { id: string; prompt: string }

export interface Simulation {
  engine: typeof ENGINE_ID; equation: typeof EQUATION;
  massKg: Range<'kg'>; netForceN: Range<'N'>;
  durationS: number; stepS: number;
  scenario: { objectLabel: string; surfaceLabel: string };
  observables: Observable[];
}

export interface Provenance {
  provider: 'meta'; requestedModel: string; returnedModel: string; responseId: string; runId: string;
  promptVersion: string; revision: number; repairOf: number | null; generatedAt: string;
}

/** Full activity spec — validated by schemas/activity-spec.full.json plus packages/validation. */
export interface ActivitySpec {
  schemaVersion: typeof SCHEMA_VERSION; id: string; title: string; learningObjectives: string[];
  sources: SourceRef[];
  explanations: { id: string; text: string; evidence: Evidence[] }[];
  simulation: Simulation; behavioralTests: BehavioralTest[]; predictions: Prediction[];
  execution: { maxWallTimeMs: number; maxRepairAttempts: number; network: false; generatedCodeAllowed: false };
  provenance: Provenance;
}

/** What Muse generates (schemas/activity-spec.gen.json). The system adds ids, sources, execution and provenance. */
export interface GeneratedSpec {
  title: string; learningObjectives: string[];
  explanations: { id: string; text: string; evidence: Evidence[] }[];
  simulation: {
    massKg: { min: number; max: number; default: number };
    netForceN: { min: number; max: number; default: number };
    durationS: number; stepS: number;
    scenario: { objectLabel: string; surfaceLabel: string };
    observables: Observable[];
  };
  behavioralTests: BehavioralTest[]; predictions: Prediction[];
}

/** Muse source analysis (schemas/source-analysis.gen.json). Invariants are checked by packages/validation. */
export interface SourceAnalysis {
  supported: boolean; activity: typeof ENGINE_ID | 'none'; unsupportedReason: string;
  concepts: { id: string; name: string; evidence: Evidence[] }[];
  objectives: string[];
}

export type Stage = 'ingest' | 'analyze' | 'specify' | 'validate' | 'repair' | 'done';
export type StageStatus = 'started' | 'succeeded' | 'failed';

export interface Usage { promptTokens: number; completionTokens: number; reasoningTokens: number; cachedTokens: number }

/** Receipt for one Meta Model API call, copied from the real response. */
export interface MetaReceipt {
  purpose: 'test-live' | 'demo' | 'fake';
  requestedModel: string; returnedModel: string; responseId: string;
  usage: Usage | null; latencyMs: number; estCostUSD: number; finishReason: string; attempts: number;
  /** How estCostUSD was determined (TASK-009 R-04/R-09). Absent on receipts recorded before the fix. */
  costBasis?: 'usage' | 'reservation';
}

export interface StageEvent {
  jobId: string; seq: number; stage: Stage; status: StageStatus; at: string;
  model?: string; responseId?: string; usage?: Usage | null; latencyMs?: number; estCostUSD?: number; detail?: string;
}

export type CheckKind = 'schema' | 'semantic' | 'grounding' | 'behavioral';
export interface ValidationCheck { id: string; kind: CheckKind; passed: boolean; message: string; path?: string }
export interface ValidationReport { artifactId: string; revision: number; checks: ValidationCheck[]; publishable: boolean }

export interface AssembleOptions {
  id: string; sources: SourceDocument[]; provenance: Provenance;
  execution?: ActivitySpec['execution'];
}

/** Combine Muse output with system-owned fields. Never copies source text into the spec. */
export function assembleSpec(gen: GeneratedSpec, opts: AssembleOptions): ActivitySpec {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: opts.id,
    title: gen.title,
    learningObjectives: gen.learningObjectives,
    sources: opts.sources.map(({ text: _text, ...ref }) => ref),
    explanations: gen.explanations,
    simulation: {
      engine: ENGINE_ID,
      equation: EQUATION,
      massKg: { unit: 'kg', ...gen.simulation.massKg },
      netForceN: { unit: 'N', ...gen.simulation.netForceN },
      durationS: gen.simulation.durationS,
      stepS: gen.simulation.stepS,
      scenario: gen.simulation.scenario,
      observables: gen.simulation.observables,
    },
    behavioralTests: gen.behavioralTests,
    predictions: gen.predictions,
    execution: opts.execution ?? { maxWallTimeMs: 2000, maxRepairAttempts: 2, network: false, generatedCodeAllowed: false },
    provenance: opts.provenance,
  };
}
