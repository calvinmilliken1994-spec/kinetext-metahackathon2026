import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DataTableGen } from '../contracts/kit.ts';
import { answerQuestion, bracketFloors, parseTableNumber, progressiveTax } from './table.ts';

test('parseTableNumber handles the spec cases', () => {
  assert.equal(parseTableNumber('12,104'), 12104);
  assert.equal(parseTableNumber('$640,600'), 640600);
  assert.equal(parseTableNumber('37%'), 37);
  assert.equal(parseTableNumber('-0.5'), -0.5);
  assert.equal(parseTableNumber('−1.2'), -1.2);
  assert.equal(parseTableNumber('1.4'), 1.4);
  assert.equal(parseTableNumber('+5'), 5);
  assert.equal(parseTableNumber('0'), 0);
  assert.equal(parseTableNumber('1,000,000'), 1000000);
  assert.equal(parseTableNumber('  42  '), 42);
});

test('parseTableNumber returns null for text, ranges and ambiguous input', () => {
  assert.equal(parseTableNumber('hello'), null);
  assert.equal(parseTableNumber('10-20'), null);
  assert.equal(parseTableNumber('—'), null);
  assert.equal(parseTableNumber(''), null);
  assert.equal(parseTableNumber('   '), null);
  assert.equal(parseTableNumber('1,2'), null);
  assert.equal(parseTableNumber('12,10'), null);
  assert.equal(parseTableNumber('$'), null);
  assert.equal(parseTableNumber('%'), null);
  assert.equal(parseTableNumber('1.2.3'), null);
  assert.equal(parseTableNumber('1e4'), null);
  assert.equal(parseTableNumber('10 to 20'), null);
  assert.equal(parseTableNumber('--5'), null);
  assert.equal(parseTableNumber('N/A'), null);
});

test('parseTableNumber rejects ceiling phrases as plain numbers', () => {
  assert.equal(parseTableNumber('$12,400 or less'), null);
  assert.equal(parseTableNumber('up to $12,400'), null);
  assert.equal(parseTableNumber('$12,400 and under'), null);
});

test('bracketFloors maps a row-0 ceiling phrase to floor 0', () => {
  assert.deepEqual(bracketFloors(['$12,400 or less', '$50,400', '$105,700']), [0, 50400, 105700]);
  assert.deepEqual(bracketFloors(['up to $12,400', '$50,400']), [0, 50400]);
  assert.deepEqual(bracketFloors(['NOT OVER $12,400', '$50,400']), [0, 50400]);
  assert.deepEqual(bracketFloors(['$12,400 and under', '$50,400']), [0, 50400]);
  assert.deepEqual(bracketFloors(['$12,400 or under', '$50,400']), [0, 50400]);
  assert.deepEqual(bracketFloors(['$0', '$50,400']), [0, 50400]);
});

test('bracketFloors rejects non-first ceilings and non-ascending floors', () => {
  assert.equal(bracketFloors([]), null);
  assert.equal(bracketFloors(['$12,400', '$50,400 or less']), null);
  assert.equal(bracketFloors(['$50,400', '$12,400']), null);
  assert.equal(bracketFloors(['hello', '$50,400']), null);
  assert.deepEqual(bracketFloors(['$12,400 or less', '$12,400']), [0, 12400]);
  assert.equal(bracketFloors(['$12,400 or less', 'not a number']), null);
});

function makePlanetTable(): DataTableGen {
  return {
    schemaVersion: 'data-table-v1',
    title: 'Planets',
    labelHeader: 'Planet',
    columns: [
      { header: 'Moons', unit: '', numeric: true, sourceId: 's1', quote: 'Moons q' },
      { header: 'Note', unit: '', numeric: false, sourceId: 's1', quote: 'Note q' },
    ],
    rows: [
      {
        label: 'Mercury',
        sourceId: 's1',
        quote: 'Mercury q',
        values: [
          { value: '0', sourceId: 's1', quote: 'zero q' },
          { value: 'rocky', sourceId: 's1', quote: 'rocky q' },
        ],
      },
      {
        label: 'Venus',
        sourceId: 's1',
        quote: 'Venus q',
        values: [
          { value: '1', sourceId: 's1', quote: 'one q' },
          { value: 'cloudy', sourceId: 's1', quote: 'cloudy q' },
        ],
      },
      {
        label: 'Earth',
        sourceId: 's1',
        quote: 'Earth q',
        values: [
          { value: '2', sourceId: 's1', quote: 'two q' },
          { value: 'blue', sourceId: 's1', quote: 'blue q' },
        ],
      },
    ],
    questions: [{ id: 'q1', kind: 'lookup', rowIndex: 0, columnIndex: 0 }],
    chartColumnIndex: -1,
    brackets: { enabled: false, rateColumnIndex: -1, overColumnIndex: -1, exampleIncome: 0 },
  };
}

test('answerQuestion lookup returns the cell string', () => {
  const gen = makePlanetTable();
  assert.deepEqual(
    answerQuestion(gen, { id: 'q1', kind: 'lookup', rowIndex: 1, columnIndex: 0 }),
    { rowIndex: 1, value: '1' },
  );
});

test('answerQuestion largest and smallest', () => {
  const gen = makePlanetTable();
  assert.deepEqual(
    answerQuestion(gen, { id: 'q2', kind: 'largest', rowIndex: -1, columnIndex: 0 }),
    { rowIndex: 2, value: '2' },
  );
  assert.deepEqual(
    answerQuestion(gen, { id: 'q3', kind: 'smallest', rowIndex: -1, columnIndex: 0 }),
    { rowIndex: 0, value: '0' },
  );
});

test('answerQuestion largest and smallest on a bracket over column compare floors', () => {
  const cell = (value: string): { value: string; sourceId: string; quote: string } => ({ value, sourceId: 's1', quote: `${value} q` });
  const gen: DataTableGen = {
    schemaVersion: 'data-table-v1',
    title: 'Brackets',
    labelHeader: 'Bracket',
    columns: [
      { header: 'rate', unit: '%', numeric: true, sourceId: 's1', quote: 'rate q' },
      { header: 'over', unit: '$', numeric: true, sourceId: 's1', quote: 'over q' },
    ],
    rows: [
      { label: '10%', sourceId: 's1', quote: 'row q', values: [cell('10%'), cell('$12,400 or less')] },
      { label: '12%', sourceId: 's1', quote: 'row q', values: [cell('12%'), cell('$12,400')] },
      { label: '22%', sourceId: 's1', quote: 'row q', values: [cell('22%'), cell('$50,400')] },
    ],
    questions: [],
    chartColumnIndex: -1,
    brackets: { enabled: true, rateColumnIndex: 0, overColumnIndex: 1, exampleIncome: 100000 },
  };
  assert.deepEqual(
    answerQuestion(gen, { id: 'b1', kind: 'largest', rowIndex: -1, columnIndex: 1 }),
    { rowIndex: 2, value: '$50,400' },
  );
  assert.deepEqual(
    answerQuestion(gen, { id: 'b2', kind: 'smallest', rowIndex: -1, columnIndex: 1 }),
    { rowIndex: 0, value: '$12,400 or less' },
  );
  assert.deepEqual(
    answerQuestion(gen, { id: 'b3', kind: 'lookup', rowIndex: 0, columnIndex: 1 }),
    { rowIndex: 0, value: '$12,400 or less' },
  );
  const descending: DataTableGen = {
    ...gen,
    rows: [...gen.rows].reverse(),
  };
  assert.equal(
    answerQuestion(descending, { id: 'b4', kind: 'largest', rowIndex: -1, columnIndex: 1 }),
    null,
  );
});

test('answerQuestion returns null for ties, non-numeric columns and bad indices', () => {
  const gen = makePlanetTable();
  assert.equal(
    answerQuestion(gen, { id: 'q4', kind: 'largest', rowIndex: -1, columnIndex: 1 }),
    null,
  );
  const tied = makePlanetTable();
  tied.rows[2]!.values[0] = { value: '1', sourceId: 's1', quote: 'one q' };
  assert.equal(
    answerQuestion(tied, { id: 'q5', kind: 'largest', rowIndex: -1, columnIndex: 0 }),
    null,
  );
  assert.equal(
    answerQuestion(gen, { id: 'q6', kind: 'lookup', rowIndex: 9, columnIndex: 0 }),
    null,
  );
  assert.equal(
    answerQuestion(gen, { id: 'q7', kind: 'largest', rowIndex: 0, columnIndex: 0 }),
    null,
  );
});

test('progressiveTax works the three-bracket example by hand', () => {
  const brackets = [
    { rate: 10, over: 0 },
    { rate: 20, over: 10000 },
    { rate: 30, over: 20000 },
  ];
  const result = progressiveTax(brackets, 30000);
  assert.equal(result.total, 6000);
  assert.deepEqual(result.parts, [
    { rate: 10, from: 0, to: 10000, tax: 1000 },
    { rate: 20, from: 10000, to: 20000, tax: 2000 },
    { rate: 30, from: 20000, to: 30000, tax: 3000 },
  ]);
});

test('progressiveTax on the IRS bottom-bracket floors hand-checks at 16712 on 100000', () => {
  const floors = bracketFloors(['$12,400 or less', '$50,400', '$105,700', '$201,775', '$256,225', '$640,600']);
  assert.deepEqual(floors, [0, 50400, 105700, 201775, 256225, 640600]);
  const brackets = [
    { rate: 10, over: 0 },
    { rate: 12, over: 12400 },
    { rate: 22, over: 50400 },
    { rate: 24, over: 105700 },
    { rate: 32, over: 201775 },
    { rate: 35, over: 256225 },
    { rate: 37, over: 640600 },
  ];
  const result = progressiveTax(brackets, 100000);
  assert.equal(result.total, 16712);
  assert.deepEqual(result.parts, [
    { rate: 10, from: 0, to: 12400, tax: 1240 },
    { rate: 12, from: 12400, to: 50400, tax: 4560 },
    { rate: 22, from: 50400, to: 100000, tax: 10912 },
  ]);
});

test('progressiveTax handles partial brackets and rejects bad input', () => {
  assert.equal(progressiveTax([{ rate: 10, over: 0 }], 5000).total, 500);
  assert.deepEqual(progressiveTax([{ rate: 10, over: 0 }], 0).parts, []);
  assert.throws(() => progressiveTax([], 1000), /BRACKETS_INVALID/);
  assert.throws(
    () =>
      progressiveTax(
        [
          { rate: 10, over: 10000 },
          { rate: 20, over: 0 },
        ],
        15000,
      ),
    /BRACKETS_INVALID/,
  );
  assert.throws(() => progressiveTax([{ rate: 101, over: 0 }], 1000), /BRACKETS_INVALID/);
  assert.throws(() => progressiveTax([{ rate: 10, over: 0 }], -5), /BRACKETS_INVALID/);
}
);

test('Set A (B2-04a): parseTableNumber reads U+2212, U+FF0D and U+FE63 as minus and no longer reads fullwidth F or low line', () => {
  assert.equal(parseTableNumber('\u22125'), -5);
  assert.equal(parseTableNumber('\uFF0D5'), -5);
  assert.equal(parseTableNumber('\uFE635.5%'), -5.5);
  assert.equal(parseTableNumber('\uFF265'), null);
  assert.equal(parseTableNumber('\uFF3F12'), null);
})
