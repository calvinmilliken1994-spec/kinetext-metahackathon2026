import type { ThresholdStageGen } from '../contracts/kit.ts';

type StageInput = Pick<
  ThresholdStageGen,
  'total' | 'rule' | 'numerator' | 'denominator' | 'statedCount'
>;

export function requiredCount(stage: StageInput): number {
  const total = stage.total;
  const rule = stage.rule;
  if (!Number.isInteger(total) || total < 1 || total > 100000) {
    throw new RangeError('THRESHOLD_INVALID: total must be an integer 1..100000');
  }
  if (rule === 'majority') {
    return Math.floor(total / 2) + 1;
  }
  if (rule === 'fraction') {
    const n = stage.numerator;
    const d = stage.denominator;
    if (!Number.isInteger(n) || n < 1) {
      throw new RangeError('THRESHOLD_INVALID: numerator must be a positive integer');
    }
    if (!Number.isInteger(d) || d < 1) {
      throw new RangeError('THRESHOLD_INVALID: denominator must be a positive integer');
    }
    const need = Math.ceil((total * n) / d);
    if (!Number.isFinite(need)) {
      throw new RangeError('THRESHOLD_INVALID: required count is not finite');
    }
    return need;
  }
  if (rule === 'count') {
    const s = stage.statedCount;
    if (!Number.isInteger(s) || s < 1 || s > total) {
      throw new RangeError('THRESHOLD_INVALID: statedCount must be an integer 1..total for count rule');
    }
    return s;
  }
  throw new RangeError('THRESHOLD_INVALID: unknown rule');
}

export function stagePasses(stage: StageInput, yes: number): boolean {
  const need = requiredCount(stage);
  if (!Number.isInteger(yes) || yes < 0 || yes > stage.total) {
    throw new RangeError('THRESHOLD_INVALID: yes must be an integer 0..total');
  }
  return yes >= need;
}

const NUM_WORDS: readonly string[] = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
];

const DENOM_SINGULAR: Record<number, string> = {
  2: 'half',
  3: 'third',
  4: 'quarter',
  5: 'fifth',
  6: 'sixth',
  7: 'seventh',
  8: 'eighth',
  9: 'ninth',
  10: 'tenth',
};

const DENOM_PLURAL: Record<number, string> = {
  2: 'halves',
  3: 'thirds',
  4: 'quarters',
  5: 'fifths',
  6: 'sixths',
  7: 'sevenths',
  8: 'eighths',
  9: 'ninths',
  10: 'tenths',
};

export function fractionWords(n: number, d: number): string[] {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError('THRESHOLD_INVALID: numerator must be a positive integer');
  }
  if (!Number.isInteger(d) || d < 1) {
    throw new RangeError('THRESHOLD_INVALID: denominator must be a positive integer');
  }
  if (n === 1 && d === 2) {
    return ['half', 'one-half', 'one half', 'a half', 'a-half', '1/2'];
  }
  if (n === 2 && d === 3) {
    return ['two-thirds', 'two thirds', '2/3'];
  }
  if (n === 3 && d === 4) {
    return ['three-fourths', 'three fourths', 'three-quarters', 'three quarters', '3/4'];
  }
  if (n === 2 && d === 5) {
    return ['two-fifths', 'two fifths', '2/5'];
  }
  if (n === 3 && d === 5) {
    return ['three-fifths', 'three fifths', '3/5'];
  }
  if (n >= 1 && n <= 9 && d >= 2 && d <= 10) {
    const num = NUM_WORDS[n] as string;
    const digit = `${n}/${d}`;
    if (n === 1) {
      if (d === 4) {
        return [
          'one-quarter',
          'one quarter',
          'a-quarter',
          'a quarter',
          'one-fourth',
          'one fourth',
          'a-fourth',
          'a fourth',
          digit,
        ];
      }
      const sing = DENOM_SINGULAR[d] as string;
      return [`one-${sing}`, `one ${sing}`, `a-${sing}`, `a ${sing}`, digit];
    }
    if (d === 4) {
      return [`${num}-quarters`, `${num} quarters`, `${num}-fourths`, `${num} fourths`, digit];
    }
    const plural = DENOM_PLURAL[d] as string;
    return [`${num}-${plural}`, `${num} ${plural}`, digit];
  }
  return [`${n}/${d}`];
}
