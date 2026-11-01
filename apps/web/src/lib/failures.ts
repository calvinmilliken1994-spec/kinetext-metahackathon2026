// Why a lesson part was left out, in words a teacher reads (pure). The worker stores a reason such as
// "schema.full, repair.no-weakening: spec failed schema.full: /simulation/scenario/settingLabel must NOT have more than 60
// characters". The card says what went wrong in one plain sentence built from the check ids; the ids and the validator's
// own text are kept only for the technical details. A reason that is already a plain sentence (no check ids) is shown as
// it is. All text passes through cleanDisplayText, so no control or zero-width character from model text is shown.

import { isKitGenComponentId } from '../../../../packages/contracts/kit.ts';
import { cleanDisplayText } from './displayText.ts';

export interface TeacherFailure {
  /** One plain sentence for the teacher. */
  sentence: string;
  /** The check ids the reason names, in order ([] when the reason is already plain words). */
  ids: string[];
  /** The stored reason (cleaned), for the technical details; '' when it is already the sentence. */
  technical: string;
}

interface CheckLike { id: string; passed: boolean; message?: string }

const QUOTED = 'quoted words that are not on the page exactly';
const NUMBERS = 'used numbers that are not on the page';
const COUNTS = 'had too many or too few items';
const FORMAT = 'broke one of our format rules';

/** What Muse's draft did wrong, per check id (Stage 6 kit checks, the analysis checks and the classic activity checks). */
const CLAUSES: Readonly<Record<string, string>> = {
  'schema.full': FORMAT, 'schema.gen': FORMAT, 'schema.analysis': FORMAT,
  'grounding.quotes': QUOTED, 'policy.no-publisher-attribution': 'credited the page’s publisher in its own words',
  'A-05': QUOTED, 'A-07': COUNTS, 'A-10': NUMBERS, 'A-11': 'wrote formatting code instead of plain text',
  'OV-01': QUOTED, 'OV-02': 'explained terms that are not in their quotes', 'OV-04': NUMBERS, 'OV-05': COUNTS,
  'Q-01': QUOTED, 'Q-02': 'gave answers that their quotes do not support', 'Q-03': 'repeated an answer option',
  'Q-04': 'gave the answer away in the question', 'Q-05': 'did not have exactly one right answer per question',
  'Q-06': NUMBERS, 'Q-07': 'offered a wrong option that the quote actually supports',
  'SEQ-01': QUOTED, 'SEQ-02': 'named steps with words that are not in their quotes',
  'SEQ-03': 'put the steps in a different order from the page', 'SEQ-04': 'repeated a step', 'SEQ-05': COUNTS, 'SEQ-06': NUMBERS,
  'SORT-01': QUOTED, 'SORT-02': 'put items in groups the page does not support', 'SORT-03': 'left a group empty',
  'SORT-04': 'repeated an item', 'SORT-05': COUNTS, 'SORT-06': NUMBERS,
  'CM-01': QUOTED, 'CM-02': 'linked ideas that its quotes do not mention', 'CM-03': 'used connecting words the page does not use',
  'CM-04': 'left parts of the map unconnected', 'CM-05': COUNTS, 'CM-06': NUMBERS,
  'CT-01': QUOTED, 'CT-02': 'filled table cells with words that are not in their quotes',
  'CT-03': 'built a table with missing or extra cells', 'CT-04': NUMBERS, 'CT-05': 'hid a table cell the class cannot work out',
  'FE-01': 'used a formula it did not quote from the page', 'FE-02': 'wrote a formula our calculator cannot read',
  'FE-03': 'left a formula letter undefined', 'FE-04': 'gave worked answers our calculator does not agree with',
  'FE-05': 'used a worked example that does not match the page', 'FE-06': 'set slider ranges that do not make sense',
  'FE-07': NUMBERS, 'FE-08': 'a formula that does not match the page’s formula',
  'BAL-01': 'used an equation it did not quote from the page', 'BAL-02': 'wrote chemical formulas our checker cannot read',
  'BAL-03': 'gave an equation that does not balance', 'BAL-04': 'did not use the smallest whole numbers',
  'BAL-05': 'gave an equation with no single balanced answer', 'BAL-07': NUMBERS,
  'BAL-08': 'gave an equation with no single balanced answer', 'BAL-09': QUOTED,
  'timeline.date-grounded': 'gave a date that its quote does not state', 'timeline.case-order': 'gave ordering answers the dates do not support',
  'timeline.approximate-date': 'used an approximate date', 'timeline.distinct-dates': 'gave two events the same date',
  'timeline.unique-ids': 'mixed up its events and questions',
  'LD-01': QUOTED, 'LD-02': 'gave a part a name that is not printed in its label', 'LD-03': 'used a figure that does not belong to this page',
  'LD-04': 'put a number outside its part’s area or on its printed label', 'LD-05': 'marked the printed labels in the wrong places',
  'LD-06': 'put numbers where SAM found no region', 'LD-07': 'marked parts whose regions overlap too much', 'LD-08': NUMBERS, 'LD-09': COUNTS,
  'LD-10': 'left a printed label the page names without a part', 'LD-11': 'marked a part SAM could not outline with confidence',
};
const UNKNOWN = 'failed one of our checks against the page';
const REPAIR = 'repair.no-weakening';

const ID = /^(?:[A-Z]{1,5}-\d{2}|[a-z]+(?:\.[a-z-]+)+)$/;

/** The check ids a stored reason starts with ("CT-02, repair.no-weakening: …"), or [] for a plain sentence. */
function reasonIds(reason: string): string[] {
  const colon = reason.indexOf(':');
  if (colon <= 0) return [];
  const ids = reason.slice(0, colon).split(',').map((t) => t.trim());
  return ids.length > 0 && ids.every((t) => ID.test(t)) ? ids : [];
}

/** What the repair tried, from the no-weakening message (its first part, before the rule's own explanation). */
function repairKind(message: string): string {
  const head = message.replace(/^repair weakened the spec:\s*/i, '').split(' (a ')[0] ?? '';
  if (/range/i.test(head) && /shr[ai]nk|narrow/i.test(head)) return 'narrow a slider range';
  if (/tolerance/i.test(head) && /widen|loosen|increas/i.test(head)) return 'loosen a tolerance';
  if (/\bengine\b/i.test(head) && /chang|switch/i.test(head)) return 'switch to a different activity engine';
  if (/\bcase\b/i.test(head) && /renam|replac|delet|remov|rewr/i.test(head)) return 'change a worked case that had already passed its checks';
  if (/^event\b/i.test(head)) return 'change an event that had already passed its checks';
  return 'change something that had already passed its checks';
}

/** 'a', 'a and b', 'a, b and c'. */
function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] as string}`;
}

/** At most two named problems; the rest are counted ("failed 2 more checks"). */
function draftList(ids: readonly string[]): string[] {
  const clauses: string[] = [];
  let extra = 0;
  for (const id of ids) {
    const c = CLAUSES[id] ?? UNKNOWN;
    if (clauses.includes(c)) continue;
    if (clauses.length < 2) clauses.push(c); else extra += 1;
  }
  // 'a formula that does not match …' reads as the object of a verb already used ("wrote … and a formula that …");
  // on its own it needs its verb.
  if (clauses[0] === CLAUSES['FE-08']) clauses[0] = `wrote ${clauses[0]}`;
  if (clauses[1] === CLAUSES['FE-08'] && clauses[0] !== CLAUSES['FE-02']) clauses[1] = `wrote ${clauses[1]}`;
  if (extra > 0) clauses.push(`failed ${extra} more check${extra === 1 ? '' : 's'}`);
  return clauses;
}

/**
 * The teacher's sentence for a part that was left out. `report` is that part's last validation report when the job
 * detail has it: its no-weakening message says what the repair tried; without it the kind of change is not guessed.
 */
export function teacherFailure(reasonRaw: string, report?: { checks: readonly CheckLike[] } | null): TeacherFailure {
  const reason = cleanDisplayText(reasonRaw).replace(/\s+/g, ' ').trim();
  if (reason === '') return { sentence: 'This part did not pass our checks against the page, so it was left out.', ids: [], technical: '' };
  const ids = reasonIds(reason);
  if (ids.length === 0) {
    const plain = /[.!?]$/.test(reason) ? reason : `${reason}.`;
    return { sentence: plain.charAt(0).toUpperCase() + plain.slice(1), ids: [], technical: '' };
  }
  const draft = draftList(ids.filter((id) => id !== REPAIR));
  let sentence: string;
  if (ids.includes(REPAIR)) {
    const fromReport = report?.checks.find((c) => c.id === REPAIR && !c.passed)?.message;
    const message = fromReport ?? (ids[0] === REPAIR ? reason.slice(reason.indexOf(':') + 1) : '');
    const repair = `tried to ${repairKind(cleanDisplayText(message))}, which isn’t allowed`;
    sentence = draft.length === 0
      ? `Muse’s repair ${repair}, so this part was left out.`
      : `Muse’s draft ${listText(draft)}${draft.length > 1 ? ',' : ''} and its repair ${repair}, so this part was left out.`;
  } else {
    sentence = `Muse’s draft ${listText(draft)}, so this part was left out.`;
  }
  return { sentence, ids, technical: reason };
}

export interface ReportLike { checks: readonly CheckLike[] }

/**
 * The last validation report of every lesson part, by spec id: kit parts from the lesson's component reports, the premium
 * activity from the revision the lesson entry names (its no-weakening message says what a repair tried).
 */
export function partReports(detail: {
  lessonData?: { lesson: { components: ReadonlyArray<{ componentId: string; specId: string; revision: number }> } | null; componentReports: Readonly<Record<string, ReportLike>> } | undefined;
  revisions?: ReadonlyArray<{ revision: number; report?: ReportLike | undefined }> | undefined;
}): Record<string, ReportLike> {
  const data = detail.lessonData;
  if (data === undefined) return {};
  const out: Record<string, ReportLike> = { ...data.componentReports };
  for (const entry of data.lesson?.components ?? []) {
    if (isKitGenComponentId(entry.componentId)) continue;
    const report = detail.revisions?.find((r) => r.revision === entry.revision)?.report;
    if (report !== undefined) out[entry.specId] = report;
  }
  return out;
}

/** The validator's words without the leading check ids (they are listed on their own line in the technical details). */
export function technicalMessage(f: Pick<TeacherFailure, 'ids' | 'technical'>): string {
  if (f.ids.length === 0) return f.technical;
  const cut = f.technical.indexOf(':');
  return cut < 0 ? f.technical : f.technical.slice(cut + 1).trim();
}
