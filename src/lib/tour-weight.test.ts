import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tourWeightRows, sortTourWeightRows, type TourWeightRow } from './tour-weight.ts';
import type { Horse } from './horses.ts';

function makeHorse(overrides: Partial<Horse> & Pick<Horse, 'id'>): Horse {
  return {
    name: `テスト号${overrides.id}`,
    sex: '牡',
    netkeibaUrl: 'https://example.com/',
    sire: 'テストサイアー',
    broodmareSire: 'テスト母父',
    damAge: 8,
    damParity: 3,
    birthDate: '2024-03-01',
    stable: 'テスト厩舎',
    pricePerShare: 20,
    height: 158,
    chestGirth: 178,
    caretGirth: 20,
    weight: 440,
    sibling: '',
    damPriority: false,
    surgery: '',
    xSearchUrl: 'https://x.com/search',
    damUrl: '',
    ...overrides,
  };
}

test('tourWeightRows: 対応表の値から増減を計算する', () => {
  const horses = [makeHorse({ id: '1', weight: 420 }), makeHorse({ id: '2', weight: 468 })];
  const rows = tourWeightRows(horses, { '1': 430, '2': 460 });
  assert.equal(rows[0].tourWeight, 430);
  assert.equal(rows[0].diff, 10);
  assert.equal(rows[1].tourWeight, 460);
  assert.equal(rows[1].diff, -8);
});

test('tourWeightRows: 対応表に無い・値がnullの馬はtourWeight/diffともnull', () => {
  const horses = [makeHorse({ id: '1', weight: 420 }), makeHorse({ id: '2', weight: 468 })];
  const rows = tourWeightRows(horses, { '1': null });
  assert.equal(rows[0].tourWeight, null);
  assert.equal(rows[0].diff, null);
  assert.equal(rows[1].tourWeight, null);
  assert.equal(rows[1].diff, null);
});

const rows: TourWeightRow[] = [
  { id: '1', name: 'あお号', sire: 'キタサンブラック', sex: '牡', weight: 440, tourWeight: 450, diff: 10 },
  { id: '2', name: 'いろは号', sire: 'キズナ', sex: '牝', weight: 420, tourWeight: 410, diff: -10 },
  { id: '3', name: 'うめ号', sire: 'キズナ', sex: '牡', weight: 430, tourWeight: null, diff: null },
];

test('sortTourWeightRows: 数値キーの昇順・降順', () => {
  const asc = sortTourWeightRows(rows, 'weight', 'asc');
  assert.deepEqual(asc.map((r) => r.id), ['2', '3', '1']);
  const desc = sortTourWeightRows(rows, 'weight', 'desc');
  assert.deepEqual(desc.map((r) => r.id), ['1', '3', '2']);
});

test('sortTourWeightRows: nullの行（未計測）は昇順・降順どちらでも末尾', () => {
  const asc = sortTourWeightRows(rows, 'diff', 'asc');
  assert.deepEqual(asc.map((r) => r.id), ['2', '1', '3']);
  const desc = sortTourWeightRows(rows, 'diff', 'desc');
  assert.deepEqual(desc.map((r) => r.id), ['1', '2', '3']);
});

test('sortTourWeightRows: 元の配列を変更しない', () => {
  const copy = [...rows];
  sortTourWeightRows(rows, 'diff', 'desc');
  assert.deepEqual(rows, copy);
});

test('sortTourWeightRows: 文字列キー（馬名）は日本語の並び順で比較する', () => {
  const asc = sortTourWeightRows(rows, 'name', 'asc');
  assert.deepEqual(asc.map((r) => r.name), ['あお号', 'いろは号', 'うめ号']);
});
