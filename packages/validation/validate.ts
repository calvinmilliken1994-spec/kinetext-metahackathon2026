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

import { ENGINES, ENGINE_IDS, isEngineId, maxTolerance } from '../contracts/index.ts';
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
  ValidationCheck,
  ValidationReport,
} from '../contracts/index.ts';
import { fullSchemaFor, sourceAnalysisGenSchema } from '../contracts/schemas.ts';
import { computeOutput } from '../activities/registry.ts';
import { MAX_FRAMES, simulate } from '../activities/forces-1d/engine.ts';
import type { Frame } from '../activities/forces-1d/engine.ts';
import { sha256 } from '../sources/index.ts';

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
const QUOTE_MESSAGE_LIMIT = 60;
const SCHEMA_ERROR_LIMIT = 5;
const TRAJECTORY_TOLERANCE = 1e-9; // absolute + relative
/** R-05: a quote only counts as evidence when it is long and substantive enough to locate. */
const QUOTE_MIN_NORMALIZED_CHARS = 8;
/** N-07: a compact equation ('F=ma') counts from this normalised length when it contains '='. */
const QUOTE_EQUATION_MIN_NORMALIZED_CHARS = 3;
const QUOTE_MIN_LETTER_DIGITS = 3;
const LETTER_DIGIT_PATTERN = /[\p{L}\p{N}]/gu;
/** Stage 5: repair finding messages are display text capped at 300 chars; structured numbers are never capped. */
const FINDING_MESSAGE_LIMIT = 300;

/** Stage 2 range-check ids, kept so recorded forces evidence reports the same ids. */
const FORCES_RANGE_CHECK_IDS: Record<string, string> = {
  massKg: 'semantic.mass-range',
  netForceN: 'semantic.force-range',
};

function rangeCheckId(engine: EngineId, inputKey: string): string {
  const legacy = engine === 'forces-1d-v1' ? FORCES_RANGE_CHECK_IDS[inputKey] : undefined;
  return legacy ?? `semantic.range.${inputKey}`;
}

type CheckBody = Omit<ValidationCheck, 'id' | 'kind'>;
type TextLookup = (sourceId: string) => string | undefined;

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
function hasPublisherAttribution(text: unknown): boolean {
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
        if (!isEngineId(a.activity)) {
          problems.push(`supported=true but activity is "${a.activity}", expected one of ${ENGINE_IDS.join(', ')}`);
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
export function repairFindings(report: ValidationReport, spec?: ActivitySpec): RepairFinding[] {
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
      const detail = firstFailingCase(spec, check.id === 'behavior.tests' ? 'behavioralTests' : 'predictions');
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
 * (Muse review finding 13). Returns the 'repair.no-weakening' check:
 * - fails when the engine changed;
 * - fails when a matched case's tolerance increased (behavioral tests matched
 *   by name, predictions by id), unless 'semantic.tolerance' itself failed on
 *   the previous revision — a failing behavior check never excuses widening
 *   tolerances, because widening is how a repair would cheat behavior.tests;
 * - fails when a simulation range width (max - min) shrank, unless that
 *   range's own check id ('semantic.mass-range' / 'semantic.range.<key>')
 *   failed on the previous revision (a broken range had to be rewritten);
 * - fails when the number of behavioral tests or predictions decreased —
 *   deleting a failing case is weakening, never a repair, so no prior failure
 *   excuses it.
 * Never throws; junk input fails closed.
 */
export function compareRevisions(previous: ActivitySpec, next: ActivitySpec, failedOnPrevious: string[]): ValidationCheck {
  const id = 'repair.no-weakening';
  const kind: CheckKind = 'semantic';
  try {
    const p = previous as unknown as LooseSpec | null | undefined;
    const n = next as unknown as LooseSpec | null | undefined;
    const failed = new Set(Array.isArray(failedOnPrevious) ? failedOnPrevious : []);
    const problems: string[] = [];

    const pe = p?.simulation?.engine;
    const ne = n?.simulation?.engine;
    let sharedEngine: EngineId | undefined;
    if (!isEngineId(pe) || !isEngineId(ne)) {
      problems.push(
        `cannot compare revisions: simulation.engine must be a known engine id on both (previous ${pe === undefined ? 'missing' : JSON.stringify(pe)}, next ${ne === undefined ? 'missing' : JSON.stringify(ne)})`,
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

    // Tolerances: matched cases must not get looser.
    if (!failed.has('semantic.tolerance')) {
      collectToleranceIncreases(pTests, nTests, 'name', 'behavioralTests', problems);
      collectToleranceIncreases(pPreds, nPreds, 'id', 'predictions', problems);
    }

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

    // Case counts: never excused — dropping a failing case is weakening, not repair.
    if (nTests.length < pTests.length) {
      problems.push(`behavioralTests count decreased ${pTests.length} -> ${nTests.length}`);
    }
    if (nPreds.length < pPreds.length) {
      problems.push(`predictions count decreased ${pPreds.length} -> ${nPreds.length}`);
    }

    return problems.length === 0
      ? {
          id,
          kind,
          passed: true,
          message: `no weakening: engine ${String(ne)} unchanged, no matched case tolerance increased, no simulation range width shrank, and the number of behavioral tests (${nTests.length}) and predictions (${nPreds.length}) did not decrease`,
        }
      : {
          id,
          kind,
          passed: false,
          message: `repair weakened the spec: ${problems.join('; ')} (a repair must fix the failing checks without changing the engine, widening tolerances, shrinking slider ranges or dropping cases)`,
        };
  } catch (err) {
    return { id, kind, passed: false, message: `comparison crashed before it could pass or fail cleanly: ${errMsg(err)}` };
  }
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

/** Run one check body so a crash is recorded as a failed check instead of hiding the others. */
function guarded(id: string, kind: CheckKind, body: () => CheckBody): ValidationCheck {
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
function indexSources(sources: SourceDocument[]): { docById: Map<string, SourceDocument>; textOf: TextLookup } {
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

function duplicates(values: string[]): string[] {
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

/** Report every matched case (by name/id) whose tolerance grew. */
function collectToleranceIncreases(
  prev: Record<string, unknown>[],
  next: Record<string, unknown>[],
  keyField: 'name' | 'id',
  list: string,
  problems: string[],
): void {
  const prevByKey = new Map<string, number>();
  for (const c of prev) {
    const k = c[keyField];
    const t = c.tolerance;
    if (typeof k === 'string' && typeof t === 'number' && !prevByKey.has(k)) prevByKey.set(k, t);
  }
  for (const c of next) {
    const k = c[keyField];
    const t = c.tolerance;
    if (typeof k !== 'string' || typeof t !== 'number') continue;
    const pt = prevByKey.get(k);
    if (pt !== undefined && t > pt) {
      problems.push(`${list} "${k}" tolerance increased from ${pt} to ${t}`);
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function truncate(s: string, max: number): string {
  return typeof s === 'string' && s.length > max ? s.slice(0, max) : String(s);
}

function schemaFailureMessage(validate: ValidateFunction, label: string): string {
  const errors = validate.errors ?? [];
  const shown = errors.slice(0, SCHEMA_ERROR_LIMIT).map(e => `${e.instancePath} ${e.message ?? 'invalid'}`.trim());
  const extra = errors.length > shown.length ? ` (+${errors.length - shown.length} more)` : '';
  return shown.length > 0 ? `${label}: ${shown.join('; ')}${extra}` : `${label}: schema validation failed`;
}
