import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  leftoverYears,
  leftoverNosOf,
  leftoverCountOf,
  leftoverSourceUrlOf,
  isLeftover,
  validateLeftoverNos,
  assertLeftoverNosValid,
  type FirstOfferingLeftoversFile,
} from './first-offering-leftovers.ts';

const FIXTURE: FirstOfferingLeftoversFile = {
  asOf: '2026-09-12',
  sourceByYear: {
    '2022': 'https://example.com/2022',
    '2023': 'https://example.com/2023',
  },
  byYear: {
    '2022': { count: 3, nos: ['1', '18', '34'] },
    '2023': { count: 2, nos: ['5', '12'] },
  },
};

test('leftoverYears: 昇順で年度一覧を返す', () => {
  assert.deepEqual(leftoverYears(FIXTURE), [2022, 2023]);
});

test('leftoverNosOf / leftoverCountOf / leftoverSourceUrlOf: 年度から対応する値を引ける', () => {
  assert.deepEqual(leftoverNosOf(FIXTURE, 2022), ['1', '18', '34']);
  assert.equal(leftoverCountOf(FIXTURE, 2023), 2);
  assert.equal(leftoverSourceUrlOf(FIXTURE, 2022), 'https://example.com/2022');
});

test('leftoverNosOf / leftoverCountOf / leftoverSourceUrlOf: データが無い年度は空扱い', () => {
  assert.deepEqual(leftoverNosOf(FIXTURE, 1999), []);
  assert.equal(leftoverCountOf(FIXTURE, 1999), 0);
  assert.equal(leftoverSourceUrlOf(FIXTURE, 1999), null);
});

test('isLeftover: 対象年度・対象番号ならtrue', () => {
  assert.equal(isLeftover(FIXTURE, 2022, '18'), true);
  assert.equal(isLeftover(FIXTURE, 2022, '99'), false);
  assert.equal(isLeftover(FIXTURE, 2021, '1'), false);
});

test('validateLeftoverNos: countとnos.lengthが一致し、全番号が既知の一覧に含まれれば空配列', () => {
  const known = new Map<number, Set<string>>([
    [2022, new Set(['1', '18', '34', '50'])],
    [2023, new Set(['5', '12', '20'])],
  ]);
  assert.deepEqual(validateLeftoverNos(FIXTURE, known), []);
});

test('validateLeftoverNos: 既知の一覧に無い番号（募集取り下げ等）が混入していたらエラーを返す', () => {
  const known = new Map<number, Set<string>>([
    [2022, new Set(['1', '18'])], // 34が無い＝募集取り下げ番号の混入を検知したい
    [2023, new Set(['5', '12'])],
  ]);
  const errors = validateLeftoverNos(FIXTURE, known);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].year, 2022);
  assert.match(errors[0].message, /34/);
});

test('validateLeftoverNos: countとnos.lengthが食い違うとエラーを返す', () => {
  const broken: FirstOfferingLeftoversFile = {
    ...FIXTURE,
    byYear: { ...FIXTURE.byYear, '2022': { count: 99, nos: ['1', '18', '34'] } },
  };
  const known = new Map<number, Set<string>>([
    [2022, new Set(['1', '18', '34'])],
    [2023, new Set(['5', '12'])],
  ]);
  const errors = validateLeftoverNos(broken, known);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /count/);
});

test('validateLeftoverNos: 既知の一覧そのものが渡されていない年度もエラーになる', () => {
  const known = new Map<number, Set<string>>([[2022, new Set(['1', '18', '34'])]]);
  const errors = validateLeftoverNos(FIXTURE, known);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].year, 2023);
});

test('assertLeftoverNosValid: 整合していれば例外を投げない', () => {
  const known = new Map<number, Set<string>>([
    [2022, new Set(['1', '18', '34'])],
    [2023, new Set(['5', '12'])],
  ]);
  assert.doesNotThrow(() => assertLeftoverNosValid(FIXTURE, known));
});

test('assertLeftoverNosValid: 整合していなければ例外を投げる', () => {
  const known = new Map<number, Set<string>>([
    [2022, new Set(['1'])],
    [2023, new Set(['5', '12'])],
  ]);
  assert.throws(() => assertLeftoverNosValid(FIXTURE, known), /整合性チェックに失敗/);
});
