// Teacher-source (paste-a-text) form logic and source labels (pure). The limits and the authoritative checks
// are the contract's own (USER_SOURCE_LIMITS, validateUserSourceInput) — the server re-validates every request.

import { DEMO_FAULTS, USER_LICENSES, USER_SOURCE_LIMITS, normalizeUserText, validateUserSourceInput } from '../../../../packages/contracts/index.ts';
import type { DemoFault, UserLicense, UserSourceInput } from '../../../../packages/contracts/index.ts';

/** Readable labels, identical to the labels the server stores (packages/sources USER_LICENSE_LABELS). */
export const LICENSE_LABELS: Readonly<Record<UserLicense, string>> = {
  'public-domain': 'Public domain',
  'cc-by': 'CC BY 4.0',
  'cc-by-sa': 'CC BY-SA 4.0',
  'own-work': "Teacher's own work",
  'permission-granted': 'Permission granted by the rights holder',
};

export function licenseLabel(license: string): string {
  return (LICENSE_LABELS as Record<string, string>)[license] ?? license;
}

export function licenseOptions(): { value: UserLicense; label: string }[] {
  return USER_LICENSES.map((value) => ({ value, label: LICENSE_LABELS[value] }));
}

export const FREE_CREDITS_NOTE =
  'Requests on the free Meta credits may be used to improve Meta’s models — paste only public-domain, openly licensed or your own text.';
export const RIGHTS_LABEL =
  'I have the right to use this text with AI models and it contains no personal or student data';

export interface SourceFormValues {
  title: string;
  text: string;
  license: UserLicense | '';
  attribution: string;
  link: string;
  rights: boolean;
}

export const EMPTY_FORM: SourceFormValues = { title: '', text: '', license: '', attribution: '', link: '', rights: false };

export interface TextCount {
  /** Characters the server will count (after trimming, CRLF → LF and control-character removal). */
  count: number;
  min: number;
  max: number;
  status: 'empty' | 'short' | 'ok' | 'long';
  /** e.g. '1,204 / 8,000 characters' */
  label: string;
  /** Plain-language hint for the status, or null when fine. */
  hint: string | null;
}

export function textCount(text: string): TextCount {
  const { textMin: min, textMax: max } = USER_SOURCE_LIMITS;
  const count = normalizeUserText(text).length;
  const label = `${count.toLocaleString('en-US')} / ${max.toLocaleString('en-US')} characters`;
  if (count === 0) return { count, min, max, status: 'empty', label, hint: `Paste at least ${min} characters.` };
  if (count < min) return { count, min, max, status: 'short', label, hint: `${(min - count).toLocaleString('en-US')} more characters needed (minimum ${min}).` };
  if (count > max) return { count, min, max, status: 'long', label, hint: `${(count - max).toLocaleString('en-US')} characters too many (maximum ${max.toLocaleString('en-US')}). Shorten the text.` };
  return { count, min, max, status: 'ok', label, hint: null };
}

/** True for an absolute http(s) URL. Only such links are ever rendered as hyperlinks. */
export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export type FormField = 'title' | 'text' | 'license' | 'attribution' | 'link' | 'rights' | 'form';
export type FieldProblems = Partial<Record<FormField, string>>;

const L = USER_SOURCE_LIMITS;

/** Plain-language message for a server / contract problem code. */
export function problemMessage(code: string): string {
  switch (code) {
    case 'TITLE_LENGTH': return `The title must be ${L.titleMin}–${L.titleMax} characters.`;
    case 'TEXT_LENGTH': return `The text must be ${L.textMin.toLocaleString('en-US')}–${L.textMax.toLocaleString('en-US')} characters after trimming.`;
    case 'ATTRIBUTION_LENGTH': return `The attribution (author / publisher / who gave permission) must be ${L.attributionMin}–${L.attributionMax} characters.`;
    case 'LOCATOR_LENGTH': return `The link must be at most ${L.locatorMax} characters.`;
    case 'LICENSE_INVALID': return 'Choose one of the license options.';
    case 'RIGHTS_NOT_CONFIRMED': return 'Tick the box to confirm you may use this text with AI models and that it has no personal or student data.';
    case 'NOT_AN_OBJECT': return 'The form data was not understood. Reload the page and try again.';
    default: return `The server rejected the text (${code}).`;
  }
}

const FIELD_OF: Record<string, FormField> = {
  TITLE_LENGTH: 'title', TEXT_LENGTH: 'text', ATTRIBUTION_LENGTH: 'attribution', LOCATOR_LENGTH: 'link',
  LICENSE_INVALID: 'license', RIGHTS_NOT_CONFIRMED: 'rights', NOT_AN_OBJECT: 'form',
};

/** Map problem codes (from validateUserSourceInput or the API's SOURCE_INVALID list) to per-field messages. */
export function problemsByField(codes: readonly string[]): FieldProblems {
  const out: FieldProblems = {};
  for (const code of codes) out[FIELD_OF[code] ?? 'form'] = problemMessage(code);
  return out;
}

export type FormResult = { ok: true; input: UserSourceInput } | { ok: false; problems: FieldProblems };

/**
 * Validate the form exactly like the contract (title / text / attribution / link lengths, licence, rights), plus
 * one extra client-side rule: a link must be an http(s) URL (it is shown as a hyperlink later).
 */
export function validateSourceForm(v: SourceFormValues): FormResult {
  const raw = {
    title: v.title, text: v.text, license: v.license, attribution: v.attribution,
    ...(v.link.trim() !== '' ? { locator: v.link } : {}),
    rightsConfirmed: v.rights,
  };
  const checked = validateUserSourceInput(raw);
  const problems: FieldProblems = checked.ok ? {} : problemsByField(checked.problems);
  if (v.link.trim() !== '' && problems.link === undefined && !isHttpUrl(v.link.trim())) {
    problems.link = 'The link must start with http:// or https:// (or leave it empty).';
  }
  if (checked.ok && Object.keys(problems).length === 0) return { ok: true, input: checked.value };
  return { ok: false, problems };
}

export interface SourceMetaLike {
  title: string;
  license: string;
  kind?: 'library' | 'user' | undefined;
  licenseLabel?: string | undefined;
  /** The source's own attribution text (GET /api/sources); names its publisher for library sources. */
  attribution?: string | undefined;
}

export const TEACHER_TAG = 'Teacher source';

/** License text for a source: teacher sources carry a readable label; library sources keep their own license string. */
export function sourceLicenseText(m: SourceMetaLike): string {
  return m.kind === 'user' ? (m.licenseLabel ?? licenseLabel(m.license)) : m.license;
}

/** Option text in the source select: teacher sources are tagged with their licence; library sources stay as they were. */
export function sourceOptionLabel(m: SourceMetaLike): string {
  return m.kind === 'user' ? `${m.title} — ${TEACHER_TAG} · ${sourceLicenseText(m)}` : m.title;
}

/** Project convention for licensed library sources: "Source material: <publisher>, <work>. …" (see packages/validation). */
const SOURCE_MATERIAL = /Source material:\s*([^,]*)/i;

/** Attribution of texts the project team wrote itself (they have no outside publisher to credit). */
const PROJECT_TEAM_TEXT = /^\s*Written by the Make knowledge interactive project team\b/i;

/**
 * The publisher named in a source's attribution, or null when it names none.
 * "Source material: U.S. Geological Survey, 'Fossils…'" → 'U.S. Geological Survey'; project-team and
 * teacher attributions (and anything without the "Source material:" marker) → null.
 */
export function sourcePublisher(attribution: string | undefined): string | null {
  if (typeof attribution !== 'string') return null;
  const match = SOURCE_MATERIAL.exec(attribution);
  if (match === null) return null;
  const publisher = (match[1] as string).trim().replace(/[.;:]+$/, '').trim();
  return publisher === '' ? null : publisher;
}

/** AI disclosure shown above an activity. Library sources name the publisher their own attribution credits. */
export function disclosureText(m: SourceMetaLike | null | undefined, made = 'Muse Spark 1.3 (Meta)'): string {
  if (m?.kind === 'user') {
    return `AI-generated with ${made} from a teacher-provided text (${sourceLicenseText(m)}). The wording needs teacher review.`;
  }
  const attribution = m?.attribution;
  if (typeof attribution === 'string' && PROJECT_TEAM_TEXT.test(attribution)) {
    return `AI-generated with ${made} from a text written by the project team.`;
  }
  const publisher = sourcePublisher(attribution);
  if (publisher !== null) {
    return `AI-generated with ${made}. Includes material from ${publisher}; ${publisher} has not reviewed or endorsed this lesson.`;
  }
  return `AI-generated with ${made}. The source's publisher has not reviewed or endorsed this lesson.`;
}

// ---- demo fault choice (generate control) --------------------------------------------------------------------

export type DemoChoice = DemoFault | 'none';

export const DEMO_FAULT_LABEL = 'Demo: inject a system-made fault';
export const DEMO_FAULT_HELP =
  'For demonstration only. After Muse writes revision 1, the system itself changes one value or quote (this is not a model error) so you can watch the checks catch it and Muse repair it. Fault runs are labelled and excluded from quality metrics.';

export function demoFaultOptions(): { value: DemoChoice; label: string }[] {
  const names: Record<DemoFault, string> = {
    'wrong-answer': 'Wrong answer (a number is changed)',
    'fabricated-quote': 'Fabricated quote (not in the source)',
  };
  return [{ value: 'none', label: 'None — normal run' }, ...DEMO_FAULTS.map((f) => ({ value: f as DemoChoice, label: names[f] }))];
}

/** The value to send as `demoFault`, or undefined for a normal run. */
export function demoFaultToSend(choice: DemoChoice): DemoFault | undefined {
  return choice === 'none' ? undefined : choice;
}

/** What POST /api/sources answers. `reused` is true when identical text was already stored (review S5-07). */
export interface CreatedSource { id: string; title: string; kind: 'user'; reused?: boolean; licenseLabel?: string; attribution?: string }

/** Plain-language disclosure when the server reused an existing source instead of saving the new metadata. */
export function reuseNotice(created: CreatedSource): string | null {
  if (created.reused !== true) return null;
  const licence = created.licenseLabel !== undefined && created.licenseLabel !== '' ? ` (${created.licenseLabel})` : '';
  return `This text was already saved as “${created.title}”${licence}. Using the existing source; its title, licence and attribution were not changed.`;
}

