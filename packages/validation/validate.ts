// TASK-003 — deterministic validation engine.
//
// Every MACHINE-CHECKABLE claim in a generated activity is verified before a
// student sees it; free-form explanation prose is NOT scientifically verified
// and needs teacher review (see the always-passing 'scope.prose-unverified'
// check, TASK-009 R-08). This module runs four layers over Muse output:
//   schema     — structural conformance (Ajv, draft-07)
//   semantic   — internal consistency (ranges, ids, budgets, attribution policy)
//   grounding  — references, sha256 integrity and counted verbatim quotes
//                against the licensed source documents
//   behavioral — physics claims re-executed against the closed-form
//                forces-1d-v1 engine
//
// validateSpec() and validateAnalysis() NEVER throw: malformed input degrades
// into failed checks. Checks after the schema gate are individually guarded so
// one crash cannot hide the others.
//
// Cross-check division of labour: refs.sources is the only check that reports
// references which cannot be resolved (an evidence sourceId that is not
// declared, or a declared spec source with no provided document). refs.sha256
// and grounding.quotes skip unresolvable references — publishable=true requires
// refs.sources to pass, so an unverifiable reference can never slip through to
// publication while keeping one root cause reported exactly once.

import { Ajv } from 'ajv';
import type { AnySchemaObject, ValidateFunction } from 'ajv';

import { ENGINE_ID } from '../contracts/index.ts';
import type {
  ActivitySpec,
  CheckKind,
  SourceAnalysis,
  SourceDocument,
  ValidationCheck,
  ValidationReport,
} from '../contracts/index.ts';
import { activitySpecFullSchema, sourceAnalysisGenSchema } from '../contracts/schemas.ts';
import { MAX_FRAMES, accelerationOf, simulate } from '../activities/forces-1d/engine.ts';
import type { Frame } from '../activities/forces-1d/engine.ts';
import { sha256 } from '../sources/index.ts';

const ajv = new Ajv({ allErrors: true });
const specSchemaValidate: ValidateFunction = ajv.compile(activitySpecFullSchema as AnySchemaObject);
const analysisSchemaValidate: ValidateFunction = ajv.compile(sourceAnalysisGenSchema as AnySchemaObject);

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

type CheckBody = Omit<ValidationCheck, 'id' | 'kind'>;
type TextLookup = (sourceId: string) => string | undefined;

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
 * Validate a full activity spec against the provided source documents.
 * Never throws for any input; a schema failure short-circuits into a report
 * containing only the failed 'schema.full' check.
 */
export function validateSpec(spec: unknown, sources: SourceDocument[]): ValidationReport {
  const { docById, textOf } = indexSources(sources);

  let schemaOk = false;
  try {
    schemaOk = specSchemaValidate(spec) === true;
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
          message: schemaFailureMessage(specSchemaValidate, 'spec failed schema.full'),
        },
      ],
      publishable: false,
    };
  }

  const s = spec as ActivitySpec;
  const sim = s.simulation;

  const checks: ValidationCheck[] = [
    { id: 'schema.full', kind: 'schema', passed: true, message: 'spec matches activity-spec.full.json (draft-07)' },

    guarded('semantic.mass-range', 'semantic', () => {
      const problems = rangeProblems('simulation.massKg', sim.massKg);
      return problems.length === 0
        ? { passed: true, message: `massKg min=${sim.massKg.min} < max=${sim.massKg.max} with default=${sim.massKg.default} inside the range` }
        : { passed: false, message: problems.join('; '), path: '/simulation/massKg' };
    }),

    guarded('semantic.force-range', 'semantic', () => {
      const problems = rangeProblems('simulation.netForceN', sim.netForceN);
      return problems.length === 0
        ? { passed: true, message: `netForceN min=${sim.netForceN.min} < max=${sim.netForceN.max} with default=${sim.netForceN.default} inside the range` }
        : { passed: false, message: problems.join('; '), path: '/simulation/netForceN' };
    }),

    guarded('semantic.frame-budget', 'semantic', () => {
      const { durationS, stepS } = sim;
      try {
        const frames = simulate({ massKg: sim.massKg.default, netForceN: sim.netForceN.default, durationS, stepS });
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

    guarded('semantic.unique-ids', 'semantic', () => {
      const problems: string[] = [];
      const expDups = duplicates(s.explanations.map(e => e.id));
      if (expDups.length > 0) problems.push(`duplicate explanation ids: ${expDups.join(', ')}`);
      const predDups = duplicates(s.predictions.map(p => p.id));
      if (predDups.length > 0) problems.push(`duplicate prediction ids: ${predDups.join(', ')}`);
      const testDups = duplicates(s.behavioralTests.map(b => b.name));
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
        const computed = accelerationOf(b.massKg, b.netForceN);
        const diff = Math.abs(b.expectedAccelerationMps2 - computed);
        if (diff > b.tolerance) {
          problems.push(`"${b.name}": expected ${b.expectedAccelerationMps2}, accelerationOf(massKg=${b.massKg}, netForceN=${b.netForceN}) = ${computed}, |diff| ${diff} > tolerance ${b.tolerance}`);
        }
      }
      return problems.length === 0
        ? { passed: true, message: `all ${s.behavioralTests.length} behavioral test(s) match a=F/m within tolerance` }
        : { passed: false, message: problems.join('; '), path: '/behavioralTests' };
    }),

    guarded('behavior.predictions', 'behavioral', () => {
      const problems: string[] = [];
      for (const p of s.predictions) {
        const computed = accelerationOf(p.massKg, p.netForceN);
        const diff = Math.abs(p.expectedAccelerationMps2 - computed);
        if (diff > p.tolerance) {
          problems.push(`"${p.id}": expected ${p.expectedAccelerationMps2}, accelerationOf(massKg=${p.massKg}, netForceN=${p.netForceN}) = ${computed}, |diff| ${diff} > tolerance ${p.tolerance}`);
        }
      }
      return problems.length === 0
        ? { passed: true, message: `all ${s.predictions.length} prediction(s) match a=F/m within tolerance` }
        : { passed: false, message: problems.join('; '), path: '/predictions' };
    }),

    guarded('semantic.predictions-in-range', 'semantic', () => {
      const problems: string[] = [];
      for (const p of s.predictions) {
        if (p.massKg < sim.massKg.min || p.massKg > sim.massKg.max) {
          problems.push(`prediction "${p.id}": massKg ${p.massKg} outside slider range [${sim.massKg.min}, ${sim.massKg.max}]`);
        }
        if (p.netForceN < sim.netForceN.min || p.netForceN > sim.netForceN.max) {
          problems.push(`prediction "${p.id}": netForceN ${p.netForceN} outside slider range [${sim.netForceN.min}, ${sim.netForceN.max}]`);
        }
      }
      return problems.length === 0
        ? { passed: true, message: `all ${s.predictions.length} prediction(s) are reproducible within the simulation slider ranges` }
        : { passed: false, message: `${problems.join('; ')} (expected every prediction to be reachable with the sliders)`, path: '/predictions' };
    }),

    guarded('behavior.trajectory', 'behavioral', () => {
      let frames: Frame[];
      try {
        frames = simulate({
          massKg: sim.massKg.default,
          netForceN: sim.netForceN.default,
          durationS: sim.durationS,
          stepS: sim.stepS,
        });
      } catch (err) {
        return {
          passed: false,
          message: `default simulation could not run for the trajectory check: ${errMsg(err)} (expected frames satisfying v=a*t and x=0.5*a*t^2)`,
          path: '/simulation',
        };
      }
      return { ...checkTrajectory(frames), path: '/simulation' };
    }),

    guarded('policy.no-publisher-attribution', 'semantic', () => {
      const fields: { path: string; text: string }[] = [
        { path: '/title', text: s.title },
        ...s.learningObjectives.map((t, i) => ({ path: `/learningObjectives/${i}`, text: t })),
        ...s.explanations.map((ex, i) => ({ path: `/explanations/${i}/text`, text: ex.text })),
        ...s.predictions.map((p, i) => ({ path: `/predictions/${i}/prompt`, text: p.prompt })),
        ...s.behavioralTests.map((b, i) => ({ path: `/behavioralTests/${i}/name`, text: b.name })),
        { path: '/simulation/scenario/objectLabel', text: sim.scenario.objectLabel },
        { path: '/simulation/scenario/surfaceLabel', text: sim.scenario.surfaceLabel },
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
 * containing only the failed 'schema.analysis' check.
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
        if (a.activity !== ENGINE_ID) {
          problems.push(`supported=true but activity is "${a.activity}", expected "${ENGINE_ID}"`);
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
