import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortHorses, filterHorses, uniqueValues, type Horse } from './horses.ts';

function makeHorse(overrides: Partial<Horse> & Pick<Horse, 'id'>): Horse {
  return {
    name: `テスト号${overrides.id}`,
    sex: '牡',
    netkeibaUrl: 'https://example.com/',
    sire: 'テストサイアー',
    broodmareSire: 'テスト母父',
    damAge: 8,
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

const horses: Horse[] = [
  makeHorse({
    id: '2',
    name: 'あお号',
    sex: '牡',
    sire: 'キタサンブラック',
    broodmareSire: 'キングカメハメハ',
    stable: '黒岩陽一',
    birthDate: '2024-05-02',
    pricePerShare: 20,
    height: 158,
    caretGirth: 20.5,
    weight: 447,
    damPriority: true,
    surgery: '',
  }),
  makeHorse({
    id: '1',
    name: 'いろは号',
    sex: '牝',
    sire: 'ロードカナロア',
    broodmareSire: 'ディープブリランテ',
    stable: '田中博康',
    birthDate: '2024-01-05',
    pricePerShare: 40,
    height: 162,
    caretGirth: 21.5,
    weight: 486,
    damPriority: false,
    surgery: '',
  }),
  makeHorse({
    id: '10',
    name: 'うめ号',
    sex: '牝',
    sire: 'キタサンブラック',
    broodmareSire: 'サンデーサイレンス',
    stable: '木村哲也',
    birthDate: '2024-03-20',
    pricePerShare: 15,
    height: 154,
    caretGirth: 19.0,
    weight: 400,
    damPriority: true,
    surgery: '左飛節OCD除去手術 (2025/5/19)',
  }),
];

// --- ソート ---

test('sortHorses: 数値キーを昇順ソートする', () => {
  assert.deepEqual(
    sortHorses(horses, 'height', 'asc').map((h) => h.id),
    ['10', '2', '1'],
  );
});

test('sortHorses: 数値キーを降順ソートする', () => {
  assert.deepEqual(
    sortHorses(horses, 'weight', 'desc').map((h) => h.id),
    ['1', '2', '10'],
  );
});

test('sortHorses: 一口価格でソートできる', () => {
  assert.deepEqual(
    sortHorses(horses, 'pricePerShare', 'asc').map((h) => h.id),
    ['10', '2', '1'],
  );
});

test('sortHorses: 生年月日（文字列）を昇順ソートする', () => {
  assert.deepEqual(
    sortHorses(horses, 'birthDate', 'asc').map((h) => h.id),
    ['1', '10', '2'],
  );
});

test('sortHorses: idは文字列だが番号として比較する（"10" が "2" より後）', () => {
  assert.deepEqual(
    sortHorses(horses, 'id', 'asc').map((h) => h.id),
    ['1', '2', '10'],
  );
});

test('sortHorses: 元の配列を変更しない', () => {
  const original = [...horses];
  sortHorses(horses, 'height', 'asc');
  assert.deepEqual(horses, original);
});

// --- フィルタ ---

test('filterHorses: 父名の部分一致で絞り込む', () => {
  assert.deepEqual(
    filterHorses(horses, { sire: 'キタサンブラック' }).map((h) => h.id),
    ['2', '10'],
  );
});

test('filterHorses: マッチしない父名では0件になる', () => {
  assert.deepEqual(filterHorses(horses, { sire: 'エピファネイア' }), []);
});

test('filterHorses: 厩舎名の部分一致で絞り込む', () => {
  assert.deepEqual(
    filterHorses(horses, { stable: '木村' }).map((h) => h.id),
    ['10'],
  );
});

test('filterHorses: 性別で絞り込む', () => {
  assert.deepEqual(
    filterHorses(horses, { sex: '牝' }).map((h) => h.id),
    ['1', '10'],
  );
});

test('filterHorses: 一口価格の範囲で絞り込む', () => {
  assert.deepEqual(
    filterHorses(horses, { minPrice: 16, maxPrice: 30 }).map((h) => h.id),
    ['2'],
  );
});

test('filterHorses: 体高の範囲で絞り込む', () => {
  assert.deepEqual(
    filterHorses(horses, { minHeight: 156, maxHeight: 160 }).map((h) => h.id),
    ['2'],
  );
});

test('filterHorses: 管囲の範囲で絞り込む', () => {
  assert.deepEqual(
    filterHorses(horses, { minCaretGirth: 20, maxCaretGirth: 21 }).map((h) => h.id),
    ['2'],
  );
});

test('filterHorses: 管囲は0.1cm刻みの小数でも境界値を含む', () => {
  assert.deepEqual(
    filterHorses(horses, { minCaretGirth: 20.5 }).map((h) => h.id),
    ['2', '1'],
  );
});

test('filterHorses: 母優先のみに絞り込む', () => {
  assert.deepEqual(
    filterHorses(horses, { damPriorityOnly: true }).map((h) => h.id),
    ['2', '10'],
  );
});

test('filterHorses: 手術・既往歴のある馬を除外する', () => {
  assert.deepEqual(
    filterHorses(horses, { excludeSurgery: true }).map((h) => h.id),
    ['2', '1'],
  );
});

test('filterHorses: 条件未指定なら全件返す', () => {
  assert.equal(filterHorses(horses, {}).length, horses.length);
});

test('filterHorses: 複数条件はAND条件', () => {
  assert.deepEqual(
    filterHorses(horses, { sire: 'キタサンブラック', excludeSurgery: true }).map((h) => h.id),
    ['2'],
  );
});

// --- フィルタ選択肢 ---

test('uniqueValues: 重複を除いて昇順に返す', () => {
  assert.deepEqual(uniqueValues(horses, 'sire'), ['キタサンブラック', 'ロードカナロア']);
});

test('uniqueValues: 空文字は選択肢に含めない', () => {
  const withEmpty = [...horses, makeHorse({ id: '99', stable: '' })];
  assert.ok(!uniqueValues(withEmpty, 'stable').includes(''));
});
