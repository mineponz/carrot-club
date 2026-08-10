import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortHorses, filterHorses, type Horse } from './horses.ts';

const horses: Horse[] = [
  {
    id: 'a',
    name: 'あお号',
    sire: 'サンデーサイレンス',
    broodmareSire: 'ノーザンテースト',
    birthDate: '2024-02-10',
    height: 158,
    chestGirth: 178,
    caretGirth: 19.5,
    weight: 420,
    damAge: 8,
    siblingInfo: '兄に重賞勝ち馬',
  },
  {
    id: 'b',
    name: 'いろは号',
    sire: 'ディープインパクト',
    broodmareSire: 'キングカメハメハ',
    birthDate: '2024-01-05',
    height: 162,
    chestGirth: 182,
    caretGirth: 20.1,
    weight: 450,
    damAge: 5,
    siblingInfo: '初仔',
  },
  {
    id: 'c',
    name: 'うめ号',
    sire: 'ディープインパクト',
    broodmareSire: 'サンデーサイレンス',
    birthDate: '2024-03-20',
    height: 155,
    chestGirth: 175,
    caretGirth: 19.0,
    weight: 400,
    damAge: 11,
    siblingInfo: '姉が牝馬三冠',
  },
];

test('sortHorses: 数値キーを昇順ソートする', () => {
  const sorted = sortHorses(horses, 'height', 'asc');
  assert.deepEqual(
    sorted.map((h) => h.id),
    ['c', 'a', 'b'],
  );
});

test('sortHorses: 数値キーを降順ソートする', () => {
  const sorted = sortHorses(horses, 'weight', 'desc');
  assert.deepEqual(
    sorted.map((h) => h.id),
    ['b', 'a', 'c'],
  );
});

test('sortHorses: 文字列キー（生年月日）を昇順ソートする', () => {
  const sorted = sortHorses(horses, 'birthDate', 'asc');
  assert.deepEqual(
    sorted.map((h) => h.id),
    ['b', 'a', 'c'],
  );
});

test('sortHorses: 元の配列を変更しない', () => {
  const original = [...horses];
  sortHorses(horses, 'height', 'asc');
  assert.deepEqual(horses, original);
});

test('filterHorses: 父名の部分一致で絞り込む', () => {
  const filtered = filterHorses(horses, { sire: 'ディープインパクト' });
  assert.deepEqual(
    filtered.map((h) => h.id),
    ['b', 'c'],
  );
});

test('filterHorses: マッチしない父名では0件になる', () => {
  const filtered = filterHorses(horses, { sire: 'キタサンブラック' });
  assert.deepEqual(filtered, []);
});

test('filterHorses: 体高の範囲で絞り込む', () => {
  const filtered = filterHorses(horses, { minHeight: 156, maxHeight: 160 });
  assert.deepEqual(
    filtered.map((h) => h.id),
    ['a'],
  );
});

test('filterHorses: 生年月日の範囲で絞り込む', () => {
  const filtered = filterHorses(horses, { bornAfter: '2024-02-01', bornBefore: '2024-03-01' });
  assert.deepEqual(
    filtered.map((h) => h.id),
    ['a'],
  );
});

test('filterHorses: 条件未指定なら全件返す', () => {
  const filtered = filterHorses(horses, {});
  assert.equal(filtered.length, horses.length);
});

test('filterHorses: 複数条件はAND条件', () => {
  const filtered = filterHorses(horses, { sire: 'ディープインパクト', minWeight: 420 });
  assert.deepEqual(
    filtered.map((h) => h.id),
    ['b'],
  );
});
