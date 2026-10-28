// TASK-003 / TASK-013 — deterministic, engine-generic validation engine.
//
// Every MACHINE-CHECKABLE claim in a generated activity is verified before a
// student sees it; free-form explanation prose is NOT scientifically verified
// and needs teacher review (see the always-passing 'scope.prose-unverified'
// check, TASK-009 R-08). This module runs four layers over Muse output:
//   schema     — structural conformance (Ajv, draft-07) against the full
//                schema of the spec's own engine (fullSchemaFor)
//   semantic   — internal consistency (descriptor-driven ranges, ids, budgets,
//                the per-case tolerance rule, attribution policy)
//   grounding  — references, sha256 integrity and counted verbatim quotes
//                against the licensed source documents
//   behavioral — physics claims re-executed against the deterministic engine
//                registered for the spec (packages/activities/registry.ts)
//
// validateSpec() dispatches on spec.simulation.engine: a missing or unknown
// engine id yields a report containing a single failed 'schema.full' check
// naming the problem, and no other checks run. Check ids and meanings are
// shared across engines (range checks keep the Stage 2 ids
// 'semantic.mass-range'/'semantic.force-range' for forces and use
// 'semantic.range.<inputKey>' elsewhere; forces keeps 'semantic.frame-budget'
// and 'behavior.trajectory').
//
// validateSpec(), validateAnalysis() and compareRevisions() NEVER throw:
// malformed input degrades into failed checks. Checks after the schema gate
// are individually guarded so one crash cannot hide the others.
//
// Cross-check division of labour: refs.sources is the only check that reports
// references which cannot be resolved (an evidence sourceId that is not
// declared, or a declared spec source with no provided document). refs.sha256
// and grounding.quotes skip unresolvable references — publishable=true requires
// refs.sources to pass, so an unverifiable reference can never slip through to
// publication while keeping one root cause reported exactly once.

import { Ajv } from 'ajv';
import type { AnySchemaObject, ValidateFunction } from 'ajv';

import { ACTIVITY_IDS, ENGINES, ENGINE_IDS, isActivityId, isEngineId, maxTolerance } from '../contracts/index.ts';
import type {
  ActivitySpec,
  CheckKind,
  EngineId,
  Explanation,
  Provenance,
  RepairFinding,
  SourceAnalysis,
  SourceDocument,
  SourceRef,
  TimelineActivitySpec,
  ValidationCheck,
  ValidationReport,
} from '../contracts/index.ts';
import { fullSchemaFor, sourceAnalysisGenSchema } from '../contracts/schemas.ts';
import { computeOutput } from '../activities/registry.ts';
import { MAX_FRAMES, simulate } from '../activities/forces-1d/engine.ts';
import type { Frame } from '../activities/forces-1d/engine.ts';
import { sha256 } from '../sources/index.ts';
import { compareTimelineRevisions, validateTimelineSpec } from './timeline.ts';
import type { TimelineCompareContext } from './timeline.ts';

/** Any full activity spec: the seven numeric engines plus the timeline-v1 sequence engine. */
export type AnyActivitySpec = ActivitySpec | TimelineActivitySpec;

const ajv = new Ajv({ allErrors: true });
const analysisSchemaValidate: ValidateFunction = ajv.compile(sourceAnalysisGenSchema as AnySchemaObject);

/** One Ajv compile per engine full schema, on first use (each schema compiled exactly once). */
const specValidators = new Map<EngineId, ValidateFunction>();
function specValidatorFor(engine: EngineId): ValidateFunction {
  let v = specValidators.get(engine);
  if (v === undefined) {
    v = ajv.compile(fullSchemaFor(engine) as AnySchemaObject);
    specValidators.set(engine, v);
  }
  return v;
}

/** NASA's AI-use guidance forbids attributing generated claims to the publisher. */
const PUBLISHER_MENTION = /\bNASA\b|National Aeronautics and Space Administration/i;
/**
 * N-06: attribution wording fails ONLY when it names a source or authority —
 * the trigger phrase (matched case-insensitively) followed within 40 characters
 * by a word starting with a capital letter (case-SENSITIVE: an actual uppercase
 * letter, so lowercase prose never counts) or by "the source|publisher|agency|
 * author|text". Normal physics prose such as "accelerates according to the net
 * force divided by its mass" therefore passes.
 */
const ATTRIBUTION_TRIGGER = /\b(?:according to|endorsed by|approved by|official (?:conclusion|position) of)\b/gi;
const ATTRIBUTION_WINDOW_CHARS = 40;
const CAPITALISED_FOLLOWER = /\b[A-Z]/; // deliberately case-sensitive
const SOURCE_NOUN_FOLLOWER = /\bthe (?:source|publisher|agency|author|text)\b/i;
const CONCEPT_ID_PATTERN = /^[a-z0-9-]{1,40}$/;
export const QUOTE_MESSAGE_LIMIT = 60;
const SCHEMA_ERROR_LIMIT = 5;
const TRAJECTORY_TOLERANCE = 1e-9; // absolute + relative
/** R-05: a quote only counts as evidence when it is long and substantive enough to locate. */
export const QUOTE_MIN_NORMALIZED_CHARS = 8;
/** N-07: a compact equation ('F=ma') counts from this normalised length when it contains '='. */
export const QUOTE_EQUATION_MIN_NORMALIZED_CHARS = 3;
export const QUOTE_MIN_LETTER_DIGITS = 3;
const LETTER_DIGIT_PATTERN = /[\p{L}\p{N}]/gu;
/** Stage 5: repair finding messages are display text capped at 300 chars; structured numbers are never capped. */
const FINDING_MESSAGE_LIMIT = 300;
/** S5-02: the no-weakening failure message lists every violation, capped for display. */
export const COMPARISON_PROBLEM_LIMIT = 12;
export const COMPARISON_MESSAGE_LIMIT = 1200;

/** Stage 2 range-check ids, kept so recorded forces evidence reports the same ids. */
const FORCES_RANGE_CHECK_IDS: Record<string, string> = {
  massKg: 'semantic.mass-range',
  netForceN: 'semantic.force-range',
};

function rangeCheckId(engine: EngineId, inputKey: string): string {
  const legacy = engine === 'forces-1d-v1' ? FORCES_RANGE_CHECK_IDS[inputKey] : undefined;
  return legacy ?? `semantic.range.${inputKey}`;
}

export type CheckBody = Omit<ValidationCheck, 'id' | 'kind'>;
export type TextLookup = (sourceId: string) => string | undefined;

/** The post-gate working view of a spec: the engine's full schema guarantees these shapes. */
interface LooseRange { unit: string; min: number; max: number; default: number }
interface LooseSpec {
  id: string;
  title: string;
  learningObjectives: string[];
  sources: SourceRef[];
  explanations: Explanation[];
  simulation: Record<string, unknown>;
  behavioralTests: Record<string, unknown>[];
  predictions: Record<string, unknown>[];
  provenance: Provenance;
}

/** Replace every whitespace run with a single space, then trim. Case-sensitive; no other folding. */
export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * R-05/N-07: a quote counts as evidence only if its whitespace-normalised form
 * has >= 8 characters and >= 3 letters/digits (\p{L}\p{N}), OR it is a compact
 * equation: it contains '=', its normalised form has >= 3 characters and
 * >= 3 letters/digits (e.g. 'F=ma'). Whitespace-only or trivial quotes used to
 * normalise to strings that match every source; short non-equation spans such
 * as 'm * a' still do not count.
 */
export function quoteCountsAsEvidence(quote: unknown): boolean {
  if (typeof quote !== 'string') {
    return false;
  }
  const normalized = normalizeWhitespace(quote);
  const lettersDigits = normalized.match(LETTER_DIGIT_PATTERN);
  if (lettersDigits === null || lettersDigits.length < QUOTE_MIN_LETTER_DIGITS) {
    return false;
  }
  if (normalized.length >= QUOTE_MIN_NORMALIZED_CHARS) {
    return true;
  }
  // N-07: narrow validated short-form path for compact equations only.
  return normalized.length >= QUOTE_EQUATION_MIN_NORMALIZED_CHARS && normalized.includes('=');
}

/** N-06: true when attribution wording names a source or authority within 40 characters. */
function hasAttributionWording(text: string): boolean {
  for (const m of text.matchAll(ATTRIBUTION_TRIGGER)) {
    const start = (m.index ?? 0) + m[0].length;
    const window = text.slice(start, start + ATTRIBUTION_WINDOW_CHARS);
    if (CAPITALISED_FOLLOWER.test(window) || SOURCE_NOUN_FOLLOWER.test(window)) {
      return true;
    }
  }
  return false;
}

/**
 * True when a generated display string mentions the publisher (fails anywhere)
 * or uses attribution/endorsement wording that names a source or authority
 * (N-06 qualified condition).
 */
export function hasPublisherAttribution(text: unknown): boolean {
  return typeof text === 'string' && (PUBLISHER_MENTION.test(text) || hasAttributionWording(text));
}

/**
 * Verify a kinematic frame list against the closed-form constant-acceleration
 * invariants: at least 2 frames, every value finite, and for each frame
 * v === a*t and x === 0.5*a*t^2 within 1e-9 absolute + 1e-9 relative.
 */
export function checkTrajectory(frames: Frame[]): { passed: boolean; message: string } {
  if (!Array.isArray(frames)) {
    return { passed: false, message: `trajectory is ${typeof frames}, expected an array of frames` };
  }
  if (frames.length < 2) {
    return { passed: false, message: `trajectory has ${frames.length} frame(s), expected at least 2` };
  }
  for (let i = 0; i < frames.length; i++) {
    const fr = frames[i] as Frame | null | undefined;
    const t = fr?.t;
    const x = fr?.x;
    const v = fr?.v;
    const a = fr?.a;
    if (!isFiniteNumber(t) || !isFiniteNumber(x) || !isFiniteNumber(v) || !isFiniteNumber(a)) {
      return {
        passed: false,
        message: `frame ${i} has non-finite values: t=${t}, x=${x}, v=${v}, a=${a} (expected finite numbers)`,
      };
    }
    const vExpected = a * t;
    if (!withinTrajectoryTolerance(v, vExpected)) {
      return {
        passed: false,
        message: `frame ${i} (t=${t}): v=${v}, expected a*t=${a}*${t}=${vExpected} within ${TRAJECTORY_TOLERANCE} absolute + ${TRAJECTORY_TOLERANCE} relative`,
      };
    }
    const xExpected = 0.5 * a * t * t;
    if (!withinTrajectoryTolerance(x, xExpected)) {
      return {
        passed: false,
        message: `frame ${i} (t=${t}): x=${x}, expected 0.5*a*t^2=${xExpected} within ${TRAJECTORY_TOLERANCE} absolute + ${TRAJECTORY_TOLERANCE} relative`,
      };
    }
  }
  return {
    passed: true,
    message: `all ${frames.length} frames are finite and satisfy v=a*t and x=0.5*a*t^2 within ${TRAJECTORY_TOLERANCE}`,
  };
}

/**
 * Validate a full activity spec of ANY registered engine against the provided
 * source documents. Never throws for any input; a missing/unknown engine id or
 * a schema failure short-circuits into a report containing only the failed
 * 'schema.full' check.
 */
export function validateSpec(spec: unknown, sources: SourceDocument[]): ValidationReport {
  const engineValue = (spec as { simulation?: { engine?: unknown } } | null | undefined)?.simulation?.engine;
  // Stage 5b sequence engines dispatch to their own module (timeline-v1 is deliberately NOT in
  // ENGINE_IDS yet, so the numeric unknown-engine path below stays byte-stable).
  if (engineValue === 'timeline-v1') {
    return validateTimelineSpec(spec, sources);
  }
  if (!isEngineId(engineValue)) {
    const maybeId = (spec as { id?: unknown } | null | undefined)?.id;
    const named = engineValue === undefined ? 'missing' : JSON.stringify(engineValue);
    return {
      artifactId: typeof maybeId === 'string' ? maybeId : 'unknown',
      revision: 1,
      checks: [
        {
          id: 'schema.full',
          kind: 'schema',
          passed: false,
          message: `spec failed schema.full: simulation.engine is ${named}, expected one of ${ENGINE_IDS.join(', ')}`,
        },
      ],
      publishable: false,
    };
  }
  const engine: EngineId = engineValue;
  const schemaValidate = specValidatorFor(engine);

  const { docById, textOf } = indexSources(sources);

  let schemaOk = false;
  try {
    schemaOk = schemaValidate(spec) === true;
  } catch {
    schemaOk = false;
  }
  if (!schemaOk) {
    const maybeId = (spec as { id?: unknown } | null | undefined)?.id;
    return {
      artifactId: typeof maybeId === 'string' ? maybeId : 'unknown',
      revision: 1,
      checks: [
        {
          id: 'schema.full',
          kind: 'schema',
          passed: false,
          message: schemaFailureMessage(schemaValidate, 'spec failed schema.full'),
        },
      ],
      publishable: false,
    };
  }

  // Past the gate the spec has the full shape of its engine (schema-guaranteed).
  const s = spec as LooseSpec;
  const d = ENGINES[engine];
  const sim = s.simulation;
  const scenario = (sim.scenario ?? {}) as Record<string, string>;
  const rangeOf = (key: string): LooseRange => sim[key] as LooseRange;
  const forces = engine === 'forces-1d-v1';

  const checks: ValidationCheck[] = [
    {
      id: 'schema.full',
      kind: 'schema',
      passed: true,
      message: forces
        ? 'spec matches activity-spec.full.json (draft-07)'
        : `spec matches activity-spec.full.${engine}.json (draft-07)`,
    },

    // Per-input range checks, driven by the engine descriptor.
    ...d.inputs.map(input =>
      guarded(rangeCheckId(engine, input.key), 'semantic', () => {
        const r = rangeOf(input.key);
        const problems = rangeProblems(`simulation.${input.key}`, r);
        return problems.length === 0
          ? { passed: true, message: `${input.key} min=${r.min} < max=${r.max} with default=${r.default} inside the range` }
          : { passed: false, message: problems.join('; '), path: `/simulation/${input.key}` };
      }),
    ),

    // Forces-only: the Stage 2 frame budget over the closed-form trajectory.
    ...(forces
      ? [
          guarded('semantic.frame-budget', 'semantic', () => {
            const { durationS, stepS } = sim as unknown as { durationS: number; stepS: number };
            const mass = rangeOf('massKg');
            const net = rangeOf('netForceN');
            try {
              const frames = simulate({ massKg: mass.default, netForceN: net.default, durationS, stepS });
              return { passed: true, message: `default simulation produces ${frames.length} frames, within MAX_FRAMES=${MAX_FRAMES}` };
            } catch (err) {
              if (err instanceof RangeError && err.message === 'TOO_MANY_FRAMES') {
                const n = Math.floor(durationS / stepS + 1e-9);
                const needed = n + 1 + (durationS - n * stepS > 1e-9 ? 1 : 0);
                return {
                  passed: false,
                  message: `default simulation (durationS=${durationS}, stepS=${stepS}) needs ${needed} frames, expected <= MAX_FRAMES=${MAX_FRAMES}`,
                  path: '/simulation',
                };
              }
              return { passed: false, message: `default simulation failed: ${errMsg(err)} (expected it to run within MAX_FRAMES=${MAX_FRAMES})`, path: '/simulation' };
            }
          }),
        ]
      : []),

    guarded('semantic.unique-ids', 'semantic', () => {
      const problems: string[] = [];
      const expDups = duplicates(s.explanations.map(e => e.id));
      if (expDups.length > 0) problems.push(`duplicate explanation ids: ${expDups.join(', ')}`);
      const predDups = duplicates(s.predictions.map(p => String(p.id)));
      if (predDups.length > 0) problems.push(`duplicate prediction ids: ${predDups.join(', ')}`);
      const testDups = duplicates(s.behavioralTests.map(b => String(b.name)));
      if (testDups.length > 0) problems.push(`duplicate behavioral test names: ${testDups.join(', ')}`);
      return problems.length === 0
        ? { passed: true, message: 'explanation ids, prediction ids and behavioral test names are unique' }
        : { passed: false, message: `${problems.join('; ')} (expected all unique)` };
    }),

    guarded('refs.sources', 'grounding', () => {
      const specSourceIds = s.sources.map(src => src.id);
      const specIdSet = new Set(specSourceIds);
      const citedIds = [...new Set(s.explanations.flatMap(ex => ex.evidence.map(ev => ev.sourceId)))];
      const problems: string[] = [];
      const unknownCited = citedIds.filter(id => !specIdSet.has(id));
      if (unknownCited.length > 0) {
        problems.push(`evidence cites sourceId(s) not declared in spec.sources: ${unknownCited.join(', ')} (declared: ${specSourceIds.join(', ') || 'none'})`);
      }
      const missingDocs = specSourceIds.filter(id => !docById.has(id));
      if (missingDocs.length > 0) {
        problems.push(`spec.sources id(s) with no matching document provided: ${missingDocs.join(', ')} (provided: ${[...docById.keys()].join(', ') || 'none'})`);
      }
      return problems.length === 0
        ? { passed: true, message: `all references resolve: ${specSourceIds.length} spec source(s), ${citedIds.length} cited sourceId(s)` }
        : { passed: false, message: problems.join('; '), path: '/sources' };
    }),

    guarded('refs.sha256', 'grounding', () => {
      const problems: string[] = [];
      let verified = 0;
      for (const src of s.sources) {
        const doc = docById.get(src.id);
        if (!doc) continue; // unresolvable references are reported by refs.sources
        verified++;
        if (doc.sha256 !== src.sha256) {
          problems.push(`source "${src.id}": spec sha256 ${src.sha256} != stored document sha256 ${String(doc.sha256)}`);
        }
        const recomputed = typeof doc.text === 'string' ? sha256(doc.text) : undefined;
        if (recomputed !== src.sha256) {
          problems.push(`source "${src.id}": spec sha256 ${src.sha256} != sha256(document.text) ${recomputed ?? '(document has no text)'}`);
        }
      }
      return problems.length === 0
        ? { passed: true, message: `sha256 verified for ${verified} source(s): stored hash and recomputed text hash both match the spec` }
        : { passed: false, message: `${problems.join('; ')} (expected spec sha256 == document sha256 == sha256(document.text))`, path: '/sources' };
    }),

    guarded('grounding.quotes', 'grounding', () => {
      const failures: string[] = [];
      let counted = 0;
      let located = 0;
      for (const ex of s.explanations) {
        let countedForExplanation = 0;
        for (const ev of ex.evidence) {
          counted++;
          if (!quoteCountsAsEvidence(ev.quote)) {
            failures.push(
              `quote "${truncate(ev.quote, QUOTE_MESSAGE_LIMIT)}" (sourceId ${ev.sourceId}, explanation ${ex.id}) does not count as evidence: expected >= ${QUOTE_MIN_NORMALIZED_CHARS} normalised characters with >= ${QUOTE_MIN_LETTER_DIGITS} letters/digits, or a compact equation containing "=" with >= ${QUOTE_EQUATION_MIN_NORMALIZED_CHARS} normalised characters and >= ${QUOTE_MIN_LETTER_DIGITS} letters/digits`,
            );
            continue;
          }
          countedForExplanation++;
          const text = textOf(ev.sourceId);
          if (text === undefined) continue; // unresolvable references are reported by refs.sources
          if (!text.includes(normalizeWhitespace(ev.quote))) {
            failures.push(`"${truncate(ev.quote, QUOTE_MESSAGE_LIMIT)}" (sourceId ${ev.sourceId}, explanation ${ex.id}) not found in the source text`);
          } else {
            located++;
          }
        }
        if (countedForExplanation === 0) {
          failures.push(`explanation "${ex.id}" has no counted evidence quote (expected >= 1)`);
        }
      }
      return failures.length === 0
        ? { passed: true, message: `all ${counted} evidence quote(s) count as evidence (>= ${QUOTE_MIN_NORMALIZED_CHARS} normalised characters with >= ${QUOTE_MIN_LETTER_DIGITS} letters/digits, or a compact "=" equation with >= ${QUOTE_EQUATION_MIN_NORMALIZED_CHARS}) and all ${located} resolvable quote(s) appear in their source text after whitespace normalisation; every explanation has >= 1 counted quote` }
        : { passed: false, message: `${failures.join('; ')} (expected counted verbatim quotes that appear in the source text after whitespace normalisation)`, path: '/explanations' };
    }),

    guarded('behavior.tests', 'behavioral', () => {
      const problems: string[] = [];
      for (const b of s.behavioralTests) {
        const { expected, computed, diff, tolerance } = caseNumbers(engine, b);
        if (diff > tolerance) {
          problems.push(`"${b.name}": expected ${expected}, computeOutput(${inputAssignments(engine, b)}) = ${computed}, |diff| ${diff} > tolerance ${tolerance}`);
        }
      }
      return problems.length === 0
        ? { passed: true, message: `all ${s.behavioralTests.length} behavioral test(s) match ${d.equation} within tolerance` }
        : { passed: false, message: problems.join('; '), path: '/behavioralTests' };
    }),

    guarded('behavior.predictions', 'behavioral', () => {
      const problems: string[] = [];
      for (const p of s.predictions) {
        const { expected, computed, diff, tolerance } = caseNumbers(engine, p);
        if (diff > tolerance) {
          problems.push(`"${p.id}": expected ${expected}, computeOutput(${inputAssignments(engine, p)}) = ${computed}, |diff| ${diff} > tolerance ${tolerance}`);
        }
      }
      return problems.length === 0
        ? { passed: true, message: `all ${s.predictions.length} prediction(s) match ${d.equation} within tolerance` }
        : { passed: false, message: problems.join('; '), path: '/predictions' };
    }),

    // Stage 5 (Muse review finding 5): the schema tolerance maximum is only a
    // coarse guard; per case, the tolerance must also satisfy the engine rule
    // tolerance <= maxTolerance(engine, computed) = max(absMax, relMax*|computed|).
    guarded('semantic.tolerance', 'semantic', () => {
      const problems: string[] = [];
      let firstPath = '/behavioralTests';
      const cases: { list: string; index: number; label: string; rec: Record<string, unknown> }[] = [
        ...s.behavioralTests.map((b, i) => ({ list: 'behavioralTests', index: i, label: `"${b.name}"`, rec: b })),
        ...s.predictions.map((p, i) => ({ list: 'predictions', index: i, label: `"${p.id}"`, rec: p })),
      ];
      for (const c of cases) {
        const { computed, tolerance } = caseNumbers(engine, c.rec);
        const max = maxTolerance(engine, computed);
        if (!(tolerance <= max)) {
          if (problems.length === 0) firstPath = `/${c.list}`;
          problems.push(
            `${c.list}[${c.index}] ${c.label}: tolerance ${tolerance} exceeds maxTolerance('${engine}', computed=${computed}) = ${max} (rule: tolerance <= max(absMax=${d.tolerance.absMax}, relMax=${d.tolerance.relMax}*|computed|))`,
          );
        }
      }
      return problems.length === 0
        ? { passed: true, message: `every case tolerance is <= maxTolerance('${engine}', computed) across ${s.behavioralTests.length} behavioral test(s) and ${s.predictions.length} prediction(s)` }
        : { passed: false, message: problems.join('; '), path: firstPath };
    }),

    guarded('semantic.predictions-in-range', 'semantic', () => {
      const problems: string[] = [];
      for (const p of s.predictions) {
        const rec = p as unknown as Record<string, number>;
        for (const input of d.inputs) {
          const r = rangeOf(input.key);
          const v = rec[input.key];
          if (v < r.min || v > r.max) {
            problems.push(`prediction "${p.id}": ${input.key} ${v} outside slider range [${r.min}, ${r.max}]`);
          }
        }
      }
      return problems.length === 0
        ? { passed: true, message: `all ${s.predictions.length} prediction(s) are reproducible within the simulation slider ranges` }
        : { passed: false, message: `${problems.join('; ')} (expected every prediction to be reachable with the sliders)`, path: '/predictions' };
    }),

    // Forces-only: the animated trajectory must satisfy the closed-form
    // invariants; the other engines carry no duration/step budget in their
    // specs, so there is nothing equivalent to check cheaply (Stage 5 plan).
    ...(forces
      ? [
          guarded('behavior.trajectory', 'behavioral', () => {
            const { durationS, stepS } = sim as unknown as { durationS: number; stepS: number };
            const mass = rangeOf('massKg');
            const net = rangeOf('netForceN');
            let frames: Frame[];
            try {
              frames = simulate({ massKg: mass.default, netForceN: net.default, durationS, stepS });
            } catch (err) {
              return {
                passed: false,
                message: `default simulation could not run for the trajectory check: ${errMsg(err)} (expected frames satisfying v=a*t and x=0.5*a*t^2)`,
                path: '/simulation',
              };
            }
            return { ...checkTrajectory(frames), path: '/simulation' };
          }),
        ]
      : []),

    guarded('policy.no-publisher-attribution', 'semantic', () => {
      const fields: { path: string; text: string }[] = [
        { path: '/title', text: s.title },
        ...s.learningObjectives.map((t, i) => ({ path: `/learningObjectives/${i}`, text: t })),
        ...s.explanations.map((ex, i) => ({ path: `/explanations/${i}/text`, text: ex.text })),
        ...s.predictions.map((p, i) => ({ path: `/predictions/${i}/prompt`, text: String(p.prompt) })),
        ...s.behavioralTests.map((b, i) => ({ path: `/behavioralTests/${i}/name`, text: String(b.name) })),
        // Scenario labels of THIS engine, from the descriptor (objectLabel/surfaceLabel
        // for forces, objectLabel/settingLabel for the others).
        ...d.scenarioKeys.map(key => ({ path: `/simulation/scenario/${key}`, text: scenario[key] })),
      ];
      const hits = fields.filter(f => hasPublisherAttribution(f.text));
      return hits.length === 0
        ? { passed: true, message: 'no generated display field (title, objectives, explanations, prediction prompts, behavioral test names, scenario labels) mentions the publisher or uses attribution/endorsement wording naming a source or authority; evidence quotes are exempt' }
        : {
            passed: false,
            message: `publisher attribution found at ${hits.map(h => `${h.path}: "${truncate(h.text, QUOTE_MESSAGE_LIMIT)}"`).join('; ')} (expected no mention of NASA / "National Aeronautics and Space Administration" anywhere, and no "according to / endorsed by / approved by / official conclusion|position of" wording naming a source or authority — a capitalised word or "the source/publisher/agency/author/text" within ${ATTRIBUTION_WINDOW_CHARS} characters — in generated display fields; NASA's AI-use guidance forbids attributing generated output to NASA)`,
            path: hits[0].path,
          };
    }),

    // R-08: honest scope. Everything above is machine-checked; the explanation
    // WORDING itself is model prose that no deterministic check can verify.
    {
      id: 'scope.prose-unverified',
      kind: 'semantic',
      passed: true,
      message: 'Explanation prose is AI-generated; quotes, numbers and ranges are machine-checked, the wording needs teacher review.',
    },
  ];

  return {
    artifactId: typeof s.id === 'string' ? s.id : 'unknown',
    revision: Number.isInteger(s.provenance?.revision) ? (s.provenance.revision as number) : 1,
    checks,
    publishable: checks.every(c => c.passed),
  };
}

/**
 * Validate a Muse source analysis against the provided source documents.
 * Never throws for any input; a schema failure short-circuits into a report
 * containing only the failed 'schema.analysis' check. Stage 5 invariant:
 * supported === true for ANY catalogue engine id; supported === false exactly
 * for activity 'none'.
 */
export function validateAnalysis(analysis: unknown, sources: SourceDocument[]): ValidationReport {
  const { docById, textOf } = indexSources(sources);

  let schemaOk = false;
  try {
    schemaOk = analysisSchemaValidate(analysis) === true;
  } catch {
    schemaOk = false;
  }
  if (!schemaOk) {
    return {
      artifactId: 'source-analysis',
      revision: 1,
      checks: [
        {
          id: 'schema.analysis',
          kind: 'schema',
          passed: false,
          message: schemaFailureMessage(analysisSchemaValidate, 'analysis failed schema.analysis'),
        },
      ],
      publishable: false,
    };
  }

  const a = analysis as SourceAnalysis;

  const checks: ValidationCheck[] = [
    { id: 'schema.analysis', kind: 'schema', passed: true, message: 'analysis matches source-analysis.gen.json' },

    guarded('analysis.invariants', 'semantic', () => {
      const problems: string[] = [];
      if (a.supported === true) {
        if (!isActivityId(a.activity)) {
          problems.push(`supported=true but activity is "${a.activity}", expected one of ${ACTIVITY_IDS.join(', ')}`);
        }
        if (a.concepts.length < 1) {
          problems.push(`supported=true but concepts.length is ${a.concepts.length}, expected >= 1`);
        }
        if (a.objectives.length < 1) {
          problems.push(`supported=true but objectives.length is ${a.objectives.length}, expected >= 1`);
        }
      } else {
        if (a.activity !== 'none') {
          problems.push(`supported=false but activity is "${a.activity}", expected "none"`);
        }
        if (typeof a.unsupportedReason !== 'string' || a.unsupportedReason.trim() === '') {
          problems.push(`supported=false but unsupportedReason is ${JSON.stringify(a.unsupportedReason) ?? 'missing'}, expected a non-empty explanation`);
        }
      }
      return problems.length === 0
        ? { passed: true, message: `invariants hold for supported=${a.supported}` }
        : { passed: false, message: problems.join('; ') };
    }),

    guarded('analysis.concept-ids', 'semantic', () => {
      const ids = a.concepts.map(c => c.id);
      const problems: string[] = [];
      const dups = duplicates(ids);
      if (dups.length > 0) problems.push(`duplicate concept ids: ${dups.join(', ')} (expected all unique)`);
      const badFormat = ids.filter(id => !CONCEPT_ID_PATTERN.test(id));
      if (badFormat.length > 0) {
        problems.push(`concept ids not matching /^[a-z0-9-]{1,40}$/: ${badFormat.map(id => `"${id}"`).join(', ')}`);
      }
      return problems.length === 0
        ? { passed: true, message: `all ${ids.length} concept id(s) are unique lowercase-kebab` }
        : { passed: false, message: problems.join('; '), path: '/concepts' };
    }),

    guarded('refs.sources', 'grounding', () => {
      const citedIds = [...new Set(a.concepts.flatMap(c => c.evidence.map(ev => ev.sourceId)))];
      const missing = citedIds.filter(id => !docById.has(id));
      return missing.length === 0
        ? { passed: true, message: `all ${citedIds.length} cited sourceId(s) have matching documents` }
        : {
            passed: false,
            message: `concept evidence cites sourceId(s) with no matching document: ${missing.join(', ')} (provided: ${[...docById.keys()].join(', ') || 'none'})`,
            path: '/concepts',
          };
    }),

    guarded('grounding.quotes', 'grounding', () => {
      const failures: string[] = [];
      let counted = 0;
      let located = 0;
      for (const c of a.concepts) {
        let countedForConcept = 0;
        for (const ev of c.evidence) {
          counted++;
          if (!quoteCountsAsEvidence(ev.quote)) {
            failures.push(
              `quote "${truncate(ev.quote, QUOTE_MESSAGE_LIMIT)}" (sourceId ${ev.sourceId}, concept ${c.id}) does not count as evidence: expected >= ${QUOTE_MIN_NORMALIZED_CHARS} normalised characters with >= ${QUOTE_MIN_LETTER_DIGITS} letters/digits, or a compact equation containing "=" with >= ${QUOTE_EQUATION_MIN_NORMALIZED_CHARS} normalised characters and >= ${QUOTE_MIN_LETTER_DIGITS} letters/digits`,
            );
            continue;
          }
          countedForConcept++;
          const text = textOf(ev.sourceId);
          if (text === undefined) continue; // unresolvable references are reported by refs.sources
          if (!text.includes(normalizeWhitespace(ev.quote))) {
            failures.push(`"${truncate(ev.quote, QUOTE_MESSAGE_LIMIT)}" (sourceId ${ev.sourceId}, concept ${c.id}) not found in the source text`);
          } else {
            located++;
          }
        }
        if (a.supported === true && countedForConcept === 0) {
          failures.push(`concept "${c.id}" has no counted evidence quote (expected >= 1 when supported=true)`);
        }
      }
      return failures.length === 0
        ? { passed: true, message: `all ${counted} concept quote(s) count as evidence (>= ${QUOTE_MIN_NORMALIZED_CHARS} normalised characters with >= ${QUOTE_MIN_LETTER_DIGITS} letters/digits, or a compact "=" equation with >= ${QUOTE_EQUATION_MIN_NORMALIZED_CHARS}) and all ${located} resolvable quote(s) appear in their source text after whitespace normalisation${a.supported === true ? '; every supported concept has >= 1 counted quote' : ''}` }
        : { passed: false, message: `${failures.join('; ')} (expected counted verbatim quotes that appear in the source text after whitespace normalisation)`, path: '/concepts' };
    }),

    guarded('policy.no-publisher-attribution', 'semantic', () => {
      const fields: { path: string; text: string }[] = [
        ...a.concepts.map((c, i) => ({ path: `/concepts/${i}/name`, text: c.name })),
        ...a.objectives.map((t, i) => ({ path: `/objectives/${i}`, text: t })),
        { path: '/unsupportedReason', text: a.unsupportedReason },
      ];
      const hits = fields.filter(f => hasPublisherAttribution(f.text));
      return hits.length === 0
        ? { passed: true, message: 'no generated analysis field (concept names, objectives, unsupportedReason) mentions the publisher or uses attribution/endorsement wording naming a source or authority; evidence quotes are exempt' }
        : {
            passed: false,
            message: `publisher attribution found at ${hits.map(h => `${h.path}: "${truncate(h.text, QUOTE_MESSAGE_LIMIT)}"`).join('; ')} (expected no mention of NASA / "National Aeronautics and Space Administration" anywhere, and no "according to / endorsed by / approved by / official conclusion|position of" wording naming a source or authority — a capitalised word or "the source/publisher/agency/author/text" within ${ATTRIBUTION_WINDOW_CHARS} characters — in generated analysis fields; NASA's AI-use guidance forbids attributing generated output to NASA)`,
            path: hits[0].path,
          };
    }),
  ];

  return {
    artifactId: 'source-analysis',
    revision: 1,
    checks,
    publishable: checks.every(c => c.passed),
  };
}

/* ------------------------------------------------------------------ */
/* Stage 5 repair support                                              */
/* ------------------------------------------------------------------ */

/**
 * Distil a validation report into the findings handed back to Muse for repair.
 * Failed checks only, in report order. `message` is system-authored display
 * text truncated to 300 characters; for behavior.tests / behavior.predictions
 * and when the spec is provided, the FIRST failing case's numbers are attached
 * in full precision (never truncated) together with a case path such as
 * 'behavioralTests[2]'. Never throws.
 */
export function repairFindings(report: ValidationReport, spec?: AnyActivitySpec): RepairFinding[] {
  const findings: RepairFinding[] = [];
  if (typeof report !== 'object' || report === null || !Array.isArray(report.checks)) {
    return findings;
  }
  for (const check of report.checks) {
    if (check.passed) continue;
    const finding: RepairFinding = {
      id: check.id,
      kind: check.kind,
      message: truncate(check.message, FINDING_MESSAGE_LIMIT),
    };
    if (check.path !== undefined) finding.path = check.path;
    if (spec !== undefined && (check.id === 'behavior.tests' || check.id === 'behavior.predictions')) {
      const detail = firstFailingCase(spec as ActivitySpec, check.id === 'behavior.tests' ? 'behavioralTests' : 'predictions');
      if (detail !== undefined) {
        finding.path = detail.path;
        finding.expected = detail.expected;
        finding.computed = detail.computed;
        finding.tolerance = detail.tolerance;
      }
    }
    findings.push(finding);
  }
  return findings;
}

/** Recompute the first case whose |expected - computed| exceeds its tolerance. */
function firstFailingCase(
  spec: ActivitySpec,
  list: 'behavioralTests' | 'predictions',
): { path: string; expected: number; computed: number; tolerance: number } | undefined {
  try {
    const engine = (spec as { simulation?: { engine?: unknown } } | null | undefined)?.simulation?.engine;
    if (!isEngineId(engine)) return undefined;
    const cases = (spec as unknown as Record<string, unknown>)[list];
    if (!Array.isArray(cases)) return undefined;
    for (let i = 0; i < cases.length; i++) {
      const rec = cases[i];
      if (typeof rec !== 'object' || rec === null) continue;
      const { expected, computed, diff, tolerance } = caseNumbers(engine, rec as Record<string, unknown>);
      if (diff > tolerance) {
        return { path: `${list}[${i}]`, expected, computed, tolerance };
      }
    }
  } catch {
    return undefined; // a finding without numbers still carries id/kind/message/path
  }
  return undefined;
}

/**
 * Guard a repair revision against WEAKENING the spec instead of fixing it
 * (Muse review finding 13; Stage 5 review S5-01/S5-02). `baseline` is the
 * IMMUTABLE obligation set — in the worker always revision 1 — so a rejected
 * weakening can never become the next baseline and be laundered by repeating
 * it. Rules, each scoped per case/field (a global failing check id never
 * grants unrelated relaxations):
 * - the engine must be unchanged;
 * - case identity is (name, occurrence index among the baseline cases with
 *   that name) for behavioral tests and (id, occurrence) for predictions
 *   (S5-08): the k-th baseline case named X must match the k-th case named X
 *   in the repair, so EVERY occurrence of a duplicated baseline name/id is its
 *   own obligation — renaming, replacing, deleting or reordering cases never
 *   removes the comparison obligation. The single rename exception (S5-09): a
 *   baseline case whose own name/id violates the publisher-attribution policy
 *   (the exact patterns of 'policy.no-publisher-attribution') may be renamed —
 *   matched by its position in the list — to a name/id that does not violate
 *   the policy and is not another baseline name/id; its numeric content stays
 *   under the same rules. No other rename is allowed, so a baseline whose
 *   duplicate name needs a uniqueness rename fails closed into human review;
 * - per case: `next.tolerance <= baseline.tolerance` ALWAYS (no exceptions — a
 *   tolerance failure is fixed by lowering it, and a failing behavior check
 *   never excuses widening);
 * - per case: inputs and expected output unchanged unless that SPECIFIC
 *   baseline case was wrong (|expected - computeOutput| > tolerance, or
 *   tolerance > maxTolerance(engine, computed)) or — for a prediction — its
 *   inputs were outside the baseline ranges;
 * - per input range: the width (max - min) must not shrink unless that range's
 *   OWN check id ('semantic.mass-range' / 'semantic.force-range' for forces,
 *   'semantic.range.<key>' elsewhere) failed on the baseline;
 * - adding cases is allowed.
 * The failure message lists every violation (capped for display). The pass
 * message is byte-stable: recorded live evidence stores it verbatim and
 * tests/e2e/stage5-evidence.test.ts recomputes and compares it.
 * Never throws; junk input fails closed.
 *
 * Stage 5b: when either revision's simulation.engine is 'timeline-v1', the comparison dispatches to
 * compareTimelineRevisions (packages/validation/timeline.ts) — sequence-engine rules (frozen grounded
 * events, no added events, count within [5, baseline], case identity by (name/id, occurrence)) with
 * the numeric rules untouched. `timeline` optionally carries the source documents and the baseline
 * findings for an exact recomputation of which events passed date grounding on the baseline.
 */
export function compareRevisions(
  baseline: AnyActivitySpec,
  next: AnyActivitySpec,
  failedOnBaseline: string[],
  timeline?: TimelineCompareContext,
): ValidationCheck {
  const id = 'repair.no-weakening';
  const kind: CheckKind = 'semantic';
  try {
    const engines = [baseline, next].map(
      spec => (spec as { simulation?: { engine?: unknown } } | null | undefined)?.simulation?.engine,
    );
    if (engines.includes('timeline-v1')) {
      return compareTimelineRevisions(baseline, next, failedOnBaseline, timeline);
    }
    const p = baseline as unknown as LooseSpec | null | undefined;
    const n = next as unknown as LooseSpec | null | undefined;
    const failed = new Set(Array.isArray(failedOnBaseline) ? failedOnBaseline : []);
    const problems: string[] = [];

    const pe = p?.simulation?.engine;
    const ne = n?.simulation?.engine;
    let sharedEngine: EngineId | undefined;
    if (!isEngineId(pe) || !isEngineId(ne)) {
      problems.push(
        `cannot compare revisions: simulation.engine must be a known engine id on both (baseline ${pe === undefined ? 'missing' : JSON.stringify(pe)}, next ${ne === undefined ? 'missing' : JSON.stringify(ne)})`,
      );
    } else if (pe !== ne) {
      problems.push(`engine changed from ${pe} to ${ne}`);
    } else {
      sharedEngine = pe;
    }

    const pTests = looseList(p, 'behavioralTests');
    const nTests = looseList(n, 'behavioralTests');
    const pPreds = looseList(p, 'predictions');
    const nPreds = looseList(n, 'predictions');

    // Case identity, tolerances and content — matched by stable name/id.
    compareCases(sharedEngine, p, pTests, nTests, 'name', 'behavioralTests', false, problems);
    compareCases(sharedEngine, p, pPreds, nPreds, 'id', 'predictions', true, problems);

    // Range widths: comparable only while the engine (and so the input keys) is the same.
    if (sharedEngine !== undefined) {
      for (const input of ENGINES[sharedEngine].inputs) {
        const pr = p?.simulation?.[input.key];
        const nr = n?.simulation?.[input.key];
        if (!isLooseRange(pr) || !isLooseRange(nr)) continue;
        const previousWidth = pr.max - pr.min;
        const nextWidth = nr.max - nr.min;
        if (nextWidth < previousWidth && !failed.has(rangeCheckId(sharedEngine, input.key))) {
          problems.push(
            `simulation.${input.key} range width shrank from ${previousWidth} to ${nextWidth} ([${pr.min}, ${pr.max}] -> [${nr.min}, ${nr.max}])`,
          );
        }
      }
    }

    if (problems.length === 0) {
      return {
        id,
        kind,
        passed: true,
        message: `no weakening: engine ${String(ne)} unchanged, no matched case tolerance increased, no simulation range width shrank, and the number of behavioral tests (${nTests.length}) and predictions (${nPreds.length}) did not decrease`,
      };
    }
    const shown = problems.slice(0, COMPARISON_PROBLEM_LIMIT);
    const hidden = problems.length - shown.length;
    const list =
      truncate(shown.join('; '), COMPARISON_MESSAGE_LIMIT) +
      (hidden > 0 ? ` (+${hidden} more violation(s))` : '');
    return {
      id,
      kind,
      passed: false,
      message: `repair weakened the spec: ${list} (a repair must fix the failing checks without changing the engine, renaming/replacing/deleting any baseline case occurrence, widening any tolerance, rewriting a case that passed on the baseline, or shrinking slider ranges; only a baseline name/id that itself violates the publisher-attribution policy may be renamed, to a policy-compliant key that is not another baseline name/id)`,
    };
  } catch (err) {
    return { id, kind, passed: false, message: `comparison crashed before it could pass or fail cleanly: ${errMsg(err)}` };
  }
}

/**
 * Per-list preservation (S5-02, S5-08, S5-09). Case identity is
 * (key, occurrence index among the baseline cases with that key): the k-th
 * baseline case named X must match the k-th case named X in the repair, so
 * every occurrence of a duplicated baseline name/id stays its own obligation —
 * deleting a duplicate, replacing it under a new name, or reordering
 * duplicates to swap their content all fail. Per matched pair the tolerance
 * never increases and inputs/expected output are frozen unless that specific
 * baseline case was wrong.
 *
 * The single rename exception (S5-09): a baseline case whose own key violates
 * the publisher-attribution policy (hasPublisherAttribution — the exact
 * patterns of 'policy.no-publisher-attribution') may be renamed; it is then
 * matched by its position in the list, and the new key must not violate the
 * policy and must not equal another baseline key of the same list (no
 * impersonation of a preserved case). Clean name matches always take priority
 * over positional ones. Every other rename stays a 'missing from the repair'
 * violation, so a duplicate needing a uniqueness rename fails closed.
 *
 * A baseline key appearing MORE often in the repair than in the baseline makes
 * occurrence identity ambiguous (and fails semantic.unique-ids anyway) and is
 * reported; novel keys are additions and allowed. Content rules need the
 * shared engine; identity is checked even without one (the engine violation
 * is already listed).
 */
function compareCases(
  engine: EngineId | undefined,
  baseline: LooseSpec | null | undefined,
  prev: Record<string, unknown>[],
  next: Record<string, unknown>[],
  keyField: 'name' | 'id',
  list: string,
  isPrediction: boolean,
  problems: string[],
): void {
  const nextByKey = new Map<string, Record<string, unknown>[]>();
  for (const c of next) {
    const k = c[keyField];
    if (typeof k !== 'string') continue;
    const bucket = nextByKey.get(k);
    if (bucket === undefined) {
      nextByKey.set(k, [c]);
    } else {
      bucket.push(c);
    }
  }
  const baselineCountByKey = new Map<string, number>();
  for (const c of prev) {
    const k = c[keyField];
    if (typeof k !== 'string') continue;
    baselineCountByKey.set(k, (baselineCountByKey.get(k) ?? 0) + 1);
  }

  /** Tolerance + content rules for one matched baseline/next pair (S5-02 rules 3–4). */
  const comparePair = (bc: Record<string, unknown>, nc: Record<string, unknown>, k: string): void => {
    // Tolerance: never increased, no exceptions (S5-02 rule 3).
    const bt = bc.tolerance;
    const nt = nc.tolerance;
    if (!isFiniteNumber(bt) || !isFiniteNumber(nt)) {
      problems.push(
        `${list} "${k}" tolerance must be a finite number on both revisions (baseline ${String(bt)}, next ${String(nt)})`,
      );
    } else if (nt > bt) {
      problems.push(`${list} "${k}" tolerance increased from ${bt} to ${nt} (a tolerance failure is fixed by lowering it, never by widening)`);
    }

    // Content: frozen unless THIS baseline case was wrong (S5-02 rule 4).
    if (engine === undefined) return;
    const changes: string[] = [];
    for (const input of ENGINES[engine].inputs) {
      if (!Object.is(bc[input.key], nc[input.key])) {
        changes.push(`${input.key} ${fmtValue(bc[input.key])} -> ${fmtValue(nc[input.key])}`);
      }
    }
    const outputKey = ENGINES[engine].output.key;
    if (!Object.is(bc[outputKey], nc[outputKey])) {
      changes.push(`${outputKey} ${fmtValue(bc[outputKey])} -> ${fmtValue(nc[outputKey])}`);
    }
    if (changes.length > 0 && !baselineCaseWasWrong(engine, baseline, bc, isPrediction)) {
      problems.push(
        `${list} "${k}" changed (${changes.join(', ')}) even though the case passed its own checks on the baseline (only a case that was wrong on the baseline may change)`,
      );
    }
  };

  /** S5-08: a duplicated baseline key names WHICH occurrence is missing. */
  const missingMessage = (k: string, occurrence: number): string => {
    const count = baselineCountByKey.get(k) ?? 1;
    const label = count === 1 ? `"${k}"` : `"${k}" (occurrence ${occurrence + 1} of ${count})`;
    return `${list} ${label} from the baseline is missing from the repair (renaming, replacing or deleting a baseline case is weakening, never a repair)`;
  };

  // Pass 1 — identity is (key, occurrence). A policy-violating baseline key
  // without a name match is deferred to the positional rename exception
  // (pass 2), so clean name matches always take priority.
  const claimed = new Set<Record<string, unknown>>();
  const deferred: { index: number; bc: Record<string, unknown>; key: string; occurrence: number }[] = [];
  const occurrenceSeen = new Map<string, number>();
  for (let i = 0; i < prev.length; i++) {
    const bc = prev[i];
    const k = bc[keyField];
    if (typeof k !== 'string') {
      problems.push(`${list}[${i}] has no usable ${keyField} in the baseline, so its preservation cannot be verified`);
      continue;
    }
    const occurrence = occurrenceSeen.get(k) ?? 0;
    occurrenceSeen.set(k, occurrence + 1);
    const bucket = nextByKey.get(k) ?? [];
    if (occurrence < bucket.length) {
      const nc = bucket[occurrence];
      claimed.add(nc);
      comparePair(bc, nc, k);
      continue;
    }
    if (hasPublisherAttribution(k)) {
      deferred.push({ index: i, bc, key: k, occurrence });
      continue;
    }
    problems.push(missingMessage(k, occurrence));
  }

  // Pass 2 — S5-09: a baseline case whose own key violates the publisher
  // policy may be renamed, matched by its position in the list.
  for (const d of deferred) {
    const nc: Record<string, unknown> | undefined = next[d.index];
    const nk = nc?.[keyField];
    if (nc === undefined || claimed.has(nc) || typeof nk !== 'string' || nk === d.key) {
      problems.push(missingMessage(d.key, d.occurrence));
      continue;
    }
    if (hasPublisherAttribution(nk)) {
      problems.push(
        `${list}[${d.index}] "${d.key}" violates the publisher-attribution policy and may be renamed to fix it, but the repair renames it to "${nk}", which violates the policy too`,
      );
      continue;
    }
    if (baselineCountByKey.has(nk)) {
      problems.push(
        `${list}[${d.index}] "${d.key}" violates the publisher-attribution policy and may be renamed to fix it, but only to a ${keyField} that is not another baseline ${keyField}; the repair renames it to "${nk}"`,
      );
      continue;
    }
    claimed.add(nc);
    comparePair(d.bc, nc, d.key);
  }

  // A baseline key appearing more often in the repair than in the baseline
  // makes occurrence identity ambiguous; novel keys are additions and allowed.
  for (const [k, bCount] of baselineCountByKey) {
    const nCount = (nextByKey.get(k) ?? []).length;
    if (nCount > bCount) {
      problems.push(
        bCount === 1
          ? `${list} "${k}" appears ${nCount} times in the repair, expected exactly once`
          : `${list} "${k}" appears ${nCount} times in the repair, expected exactly ${bCount} (one per baseline occurrence)`,
      );
    }
  }
}

/**
 * True when the specific baseline case was demonstrably wrong: its stated
 * output misses the deterministic recomputation beyond its tolerance, its
 * tolerance exceeded maxTolerance(engine, computed), or — for a prediction —
 * its inputs were outside the baseline slider ranges. A case that cannot be
 * recomputed counts as wrong (it could never be shown correct).
 */
function baselineCaseWasWrong(
  engine: EngineId,
  baseline: LooseSpec | null | undefined,
  bc: Record<string, unknown>,
  isPrediction: boolean,
): boolean {
  try {
    const rec = bc as Record<string, number>;
    const computed = computeOutput(engine, rec);
    const expected = rec[ENGINES[engine].output.key];
    const tolerance = rec.tolerance;
    if (!isFiniteNumber(expected) || !isFiniteNumber(tolerance)) {
      return true;
    }
    if (Math.abs(expected - computed) > tolerance) {
      return true;
    }
    if (tolerance > maxTolerance(engine, computed)) {
      return true;
    }
  } catch {
    return true;
  }
  if (isPrediction) {
    for (const input of ENGINES[engine].inputs) {
      const r = baseline?.simulation?.[input.key];
      const v = (bc as Record<string, number>)[input.key];
      if (isLooseRange(r) && typeof v === 'number' && (v < r.min || v > r.max)) {
        return true;
      }
    }
  }
  return false;
}

function fmtValue(v: unknown): string {
  return typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' ? String(v) : JSON.stringify(v) ?? String(v);
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

/** Run one check body so a crash is recorded as a failed check instead of hiding the others. */
export function guarded(id: string, kind: CheckKind, body: () => CheckBody): ValidationCheck {
  try {
    return { id, kind, ...body() };
  } catch (err) {
    return { id, kind, passed: false, message: `check crashed before it could pass or fail cleanly: ${errMsg(err)}` };
  }
}

/** Stated output vs deterministic recomputation for one case of the given engine. */
function caseNumbers(
  engine: EngineId,
  c: Record<string, unknown>,
): { expected: number; computed: number; diff: number; tolerance: number } {
  const rec = c as Record<string, number>; // the schema gate guarantees numbers
  const expected = rec[ENGINES[engine].output.key];
  const computed = computeOutput(engine, rec);
  return { expected, computed, diff: Math.abs(expected - computed), tolerance: rec.tolerance };
}

/** 'massKg=2, netForceN=4' — the descriptor's input keys as an assignment list. */
function inputAssignments(engine: EngineId, c: Record<string, unknown>): string {
  const rec = c as Record<string, number>;
  return ENGINES[engine].inputs.map(i => `${i.key}=${rec[i.key]}`).join(', ');
}

/** Index caller-provided documents by id and memoise their whitespace-normalised text. */
export function indexSources(sources: SourceDocument[]): { docById: Map<string, SourceDocument>; textOf: TextLookup } {
  const docById = new Map<string, SourceDocument>();
  const list = Array.isArray(sources) ? sources.filter(d => typeof d === 'object' && d !== null) : [];
  for (const d of list) {
    if (typeof d.id === 'string' && !docById.has(d.id)) docById.set(d.id, d);
  }
  const cache = new Map<string, string>();
  const textOf: TextLookup = (sourceId: string): string | undefined => {
    const doc = docById.get(sourceId);
    if (!doc || typeof doc.text !== 'string') return undefined;
    let text = cache.get(sourceId);
    if (text === undefined) {
      text = normalizeWhitespace(doc.text);
      cache.set(sourceId, text);
    }
    return text;
  };
  return { docById, textOf };
}

function rangeProblems(label: string, r: { min: number; max: number; default: number }): string[] {
  const problems: string[] = [];
  if (!(r.min < r.max)) {
    problems.push(`${label}.min (${r.min}) must be < ${label}.max (${r.max})`);
  }
  if (!(r.min <= r.default && r.default <= r.max)) {
    problems.push(`${label}.default (${r.default}) must satisfy ${label}.min (${r.min}) <= default <= ${label}.max (${r.max})`);
  }
  return problems;
}

function withinTrajectoryTolerance(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= TRAJECTORY_TOLERANCE + TRAJECTORY_TOLERANCE * Math.abs(expected);
}

export function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dups.add(v);
    seen.add(v);
  }
  return [...dups];
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function isLooseRange(r: unknown): r is LooseRange {
  return typeof r === 'object' && r !== null && isFiniteNumber((r as LooseRange).min) && isFiniteNumber((r as LooseRange).max);
}

function looseList(spec: LooseSpec | null | undefined, key: 'behavioralTests' | 'predictions'): Record<string, unknown>[] {
  const v = (spec as unknown as Record<string, unknown> | null | undefined)?.[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null);
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function truncate(s: string, max: number): string {
  return typeof s === 'string' && s.length > max ? s.slice(0, max) : String(s);
}

export function schemaFailureMessage(validate: ValidateFunction, label: string): string {
  const errors = validate.errors ?? [];
  const shown = errors.slice(0, SCHEMA_ERROR_LIMIT).map(e => `${e.instancePath} ${e.message ?? 'invalid'}`.trim());
  const extra = errors.length > shown.length ? ` (+${errors.length - shown.length} more)` : '';
  return shown.length > 0 ? `${label}: ${shown.join('; ')}${extra}` : `${label}: schema validation failed`;
}
