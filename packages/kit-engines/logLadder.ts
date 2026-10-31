export function ladderRatio(factor: number, fromValue: number, toValue: number): number {
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 1 || factor > 1000) {
    throw new RangeError('LADDER_INPUT_INVALID: factor must be a finite number with 1 < factor <= 1000');
  }
  if (typeof fromValue !== 'number' || !Number.isFinite(fromValue)) {
    throw new RangeError('LADDER_INPUT_INVALID: fromValue must be a finite number');
  }
  if (typeof toValue !== 'number' || !Number.isFinite(toValue)) {
    throw new RangeError('LADDER_INPUT_INVALID: toValue must be a finite number');
  }
  const diff = Math.abs(toValue - fromValue);
  const ratio = Math.pow(factor, diff);
  if (!Number.isFinite(ratio)) {
    throw new RangeError('LADDER_INPUT_INVALID: ratio is not finite');
  }
  return ratio;
}

export function ladderDirection(
  increasing: boolean,
  fromValue: number,
  toValue: number,
): 'more' | 'less' {
  if (typeof increasing !== 'boolean') {
    throw new RangeError('LADDER_INPUT_INVALID: increasing must be a boolean');
  }
  if (typeof fromValue !== 'number' || !Number.isFinite(fromValue)) {
    throw new RangeError('LADDER_INPUT_INVALID: fromValue must be a finite number');
  }
  if (typeof toValue !== 'number' || !Number.isFinite(toValue)) {
    throw new RangeError('LADDER_INPUT_INVALID: toValue must be a finite number');
  }
  const up = toValue > fromValue;
  return up === increasing ? 'more' : 'less';
}
