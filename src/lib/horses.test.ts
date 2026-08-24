import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sortHorses,
  filterHorses,
  uniqueValues,
  uniqueSexes,
  valueCounts,
  UNRATED,
  type Horse,
} from './horses.ts';

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
    damAge: 5,
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
    damAge: 12,
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
    damAge: 20,
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

test('filterHorses: 母優先「あり」に絞り込む', () => {
  assert.deepEqual(
    filterHorses(horses, { damPriority: 'has' }).map((h) => h.id),
    ['2', '10'],
  );
});

test('filterHorses: 母優先「なし」に絞り込む', () => {
  assert.deepEqual(
    filterHorses(horses, { damPriority: 'none' }).map((h) => h.id),
    ['1'],
  );
});

test('filterHorses: 母優先が未指定なら絞り込まない（UIの「すべて」）', () => {
  assert.equal(filterHorses(horses, { damPriority: undefined }).length, horses.length);
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

// --- 評価フィルタ（自分が付けたA〜E） ---
//
// 評価は端末ごとのlocalStorage側のデータなので `Horse` には入っていない。
// 呼び出し側が作った「馬ID→評価」の対応表を渡す前提のテスト。
// '10'（うめ号）は対応表に載せず、未評価として扱われることを確かめる。

const ratingByHorseId = { '2': 'A', '1': 'C' } as const;

test('filterHorses: 評価1つで絞り込む', () => {
  assert.deepEqual(
    filterHorses(horses, { ratings: ['A'], ratingByHorseId }).map((h) => h.id),
    ['2'],
  );
});

test('filterHorses: 評価を複数選ぶとOR条件（いずれかが付いていれば残る）', () => {
  assert.deepEqual(
    filterHorses(horses, { ratings: ['A', 'C'], ratingByHorseId }).map((h) => h.id),
    ['2', '1'],
  );
});

test('filterHorses: 選ばれていない評価の馬は残らない', () => {
  assert.deepEqual(filterHorses(horses, { ratings: ['B'], ratingByHorseId }), []);
});

test('filterHorses: 未評価だけに絞り込む', () => {
  assert.deepEqual(
    filterHorses(horses, { ratings: [UNRATED], ratingByHorseId }).map((h) => h.id),
    ['10'],
  );
});

test('filterHorses: 未評価はA〜Eと一緒に選べる', () => {
  assert.deepEqual(
    filterHorses(horses, { ratings: ['A', UNRATED], ratingByHorseId }).map((h) => h.id),
    ['2', '10'],
  );
});

test('filterHorses: 対応表で null の馬は未評価として扱う', () => {
  assert.deepEqual(
    filterHorses(horses, { ratings: [UNRATED], ratingByHorseId: { '2': 'A', '1': null } }).map((h) => h.id),
    ['1', '10'],
  );
});

test('filterHorses: 評価を1つも選んでいなければ全件返す（後方互換）', () => {
  assert.equal(filterHorses(horses, { ratings: [], ratingByHorseId }).length, horses.length);
  assert.equal(filterHorses(horses, { ratingByHorseId }).length, horses.length);
});

test('filterHorses: 対応表が無ければ全馬が未評価扱いになる', () => {
  assert.deepEqual(filterHorses(horses, { ratings: ['A'] }), []);
  assert.equal(filterHorses(horses, { ratings: [UNRATED] }).length, horses.length);
});

test('filterHorses: 評価フィルタは他の条件とAND条件', () => {
  assert.deepEqual(
    filterHorses(horses, { sire: 'キタサンブラック', ratings: ['A', 'C'], ratingByHorseId }).map((h) => h.id),
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

// --- 複数選択（父・性別）と母齢 ---

test('filterHorses: 父を複数選ぶと、いずれかの父の馬が残る（OR）', () => {
  assert.deepEqual(
    filterHorses(horses, { sires: ['キタサンブラック', 'ロードカナロア'] }).map((h) => h.id),
    ['2', '1', '10'],
  );
  assert.deepEqual(
    filterHorses(horses, { sires: ['ロードカナロア'] }).map((h) => h.id),
    ['1'],
  );
});

test('filterHorses: 父の複数選択は完全一致（部分一致では拾わない）', () => {
  assert.deepEqual(filterHorses(horses, { sires: ['キタサン'] }), []);
});

test('filterHorses: 父を1つも選んでいなければ全件返す（後方互換）', () => {
  assert.equal(filterHorses(horses, { sires: [] }).length, horses.length);
  assert.equal(filterHorses(horses, {}).length, horses.length);
});

test('filterHorses: 性別を複数選ぶと、いずれかの性別の馬が残る（OR）', () => {
  assert.deepEqual(
    filterHorses(horses, { sexes: ['牝'] }).map((h) => h.id),
    ['1', '10'],
  );
  assert.equal(filterHorses(horses, { sexes: ['牡', '牝'] }).length, horses.length);
  assert.equal(filterHorses(horses, { sexes: [] }).length, horses.length);
});

test('filterHorses: 性別と父の複数選択はAND条件', () => {
  assert.deepEqual(
    filterHorses(horses, { sexes: ['牝'], sires: ['キタサンブラック'] }).map((h) => h.id),
    ['10'],
  );
});

test('filterHorses: 母齢を下限・上限で絞り込む', () => {
  assert.deepEqual(
    filterHorses(horses, { minDamAge: 12 }).map((h) => h.id),
    ['1', '10'],
  );
  assert.deepEqual(
    filterHorses(horses, { maxDamAge: 12 }).map((h) => h.id),
    ['2', '1'],
  );
  assert.deepEqual(
    filterHorses(horses, { minDamAge: 12, maxDamAge: 12 }).map((h) => h.id),
    ['1'],
  );
});

test('filterHorses: 母齢は境界値を含む', () => {
  assert.equal(filterHorses(horses, { minDamAge: 5, maxDamAge: 20 }).length, horses.length);
  assert.deepEqual(filterHorses(horses, { minDamAge: 21 }), []);
});

test('valueCounts: 選択肢ごとの頭数を数える', () => {
  assert.deepEqual(valueCounts(horses, 'sire'), {
    キタサンブラック: 2,
    ロードカナロア: 1,
  });
});

test('valueCounts: 空文字は数えない', () => {
  const withEmpty = [...horses, makeHorse({ id: '99', stable: '' })];
  assert.ok(!('' in valueCounts(withEmpty, 'stable')));
});

test('uniqueSexes: データにある性別だけを牡→牝→セの順で返す', () => {
  assert.deepEqual(uniqueSexes(horses), ['牡', '牝']);
  assert.deepEqual(uniqueSexes([...horses, makeHorse({ id: '98', sex: 'セ' })]), ['牡', '牝', 'セ']);
  assert.deepEqual(uniqueSexes([]), []);
});
