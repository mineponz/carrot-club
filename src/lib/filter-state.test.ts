import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countActiveFilters,
  emptyFilterState,
  filterStorageKeyForYear,
  isAllSelected,
  isEmptyFilterState,
  loadFilterState,
  parseFilterState,
  parseMultiValue,
  saveFilterState,
  serializeFilterState,
  serializeMultiValue,
  withAllWhenNoneSelected,
  type FilterState,
} from './filter-state.ts';

/** テスト用の localStorage 代わり。removeItem まで含めて挙動を見る。 */
function createStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

function state(over: Partial<FilterState> = {}): FilterState {
  return { ...emptyFilterState(), ...over };
}

test('filterStorageKeyForYear: 評価と同じく募集年ごとにキーを分ける', () => {
  assert.equal(filterStorageKeyForYear(2026), 'carrot-club:filters:2026');
  assert.notEqual(filterStorageKeyForYear(2026), filterStorageKeyForYear(2025));
});

test('serializeFilterState → parseFilterState で往復できる', () => {
  const original = state({
    values: { 'filter-price-max': '30', 'filter-sire': 'イクイノックス' },
    toggles: { 'filter-dam-priority': true },
    ratings: ['A', 'B'],
    sortKey: 'height',
    sortDirection: 'desc',
  });
  assert.deepEqual(parseFilterState(serializeFilterState(original)), original);
});

test('serializeFilterState: 未入力の欄とオフのチェックは保存しない', () => {
  const saved = JSON.parse(
    serializeFilterState(
      state({ values: { 'filter-name': '', 'filter-bms': ' ' }, toggles: { 'filter-hide-skip': false } })
    )
  );
  assert.deepEqual(saved.values, {});
  assert.deepEqual(saved.toggles, {});
});

test('parseFilterState: 保存が無ければ既定（条件なし・募集番号の昇順）', () => {
  assert.deepEqual(parseFilterState(null), emptyFilterState());
  assert.deepEqual(parseFilterState(''), emptyFilterState());
});

test('parseFilterState: 壊れたJSONでも例外を投げず既定に戻す', () => {
  assert.deepEqual(parseFilterState('{壊れて'), emptyFilterState());
  assert.deepEqual(parseFilterState('"文字列"'), emptyFilterState());
});

test('parseFilterState: 知らない並び順は既定に落とす', () => {
  const restored = parseFilterState('{"sortKey":"unknownKey","sortDirection":"sideways"}');
  assert.equal(restored.sortKey, 'id');
  assert.equal(restored.sortDirection, 'asc');
});

test('parseFilterState: 型が違う値は読み飛ばす（値だけ拾って画面は開ける）', () => {
  const restored = parseFilterState(
    '{"values":{"filter-name":"ブラン","filter-price-min":30},"toggles":{"a":true,"b":"yes"},"ratings":["A",7]}'
  );
  assert.deepEqual(restored.values, { 'filter-name': 'ブラン' });
  assert.deepEqual(restored.toggles, { a: true });
  assert.deepEqual(restored.ratings, ['A']);
});

test('isEmptyFilterState: 条件も並び順も既定なら空', () => {
  assert.equal(isEmptyFilterState(emptyFilterState()), true);
  assert.equal(isEmptyFilterState(state({ ratings: ['A'] })), false);
  assert.equal(isEmptyFilterState(state({ sortDirection: 'desc' })), false);
});

test('countActiveFilters: 条件の数を数える（並び順は含めない）', () => {
  assert.equal(countActiveFilters(emptyFilterState()), 0);
  assert.equal(
    countActiveFilters(
      state({
        values: { 'filter-price-max': '30' },
        toggles: { 'filter-dam-priority': true },
        ratings: ['A', 'B'],
        sortKey: 'height',
      })
    ),
    4
  );
});

test('saveFilterState → loadFilterState で復元できる', () => {
  const store = createStore();
  const key = filterStorageKeyForYear(2026);
  saveFilterState(store, key, state({ values: { 'filter-stable': '木村哲也' } }));
  assert.deepEqual(loadFilterState(store, key).values, { 'filter-stable': '木村哲也' });
});

test('saveFilterState: 条件をクリアした状態は保存キーごと消す', () => {
  const store = createStore();
  const key = filterStorageKeyForYear(2026);
  saveFilterState(store, key, state({ ratings: ['A'] }));
  saveFilterState(store, key, emptyFilterState());
  assert.equal(store.map.has(key), false);
  assert.deepEqual(loadFilterState(store, key), emptyFilterState());
});

test('保存キーが年度ごとに分かれていて、別の年の条件を読まない', () => {
  const store = createStore();
  saveFilterState(store, filterStorageKeyForYear(2026), state({ values: { 'filter-sire': 'イクイノックス' } }));
  assert.deepEqual(loadFilterState(store, filterStorageKeyForYear(2025)), emptyFilterState());
});

// --- 複数選択（父・性別）の詰め込み ---

test('serializeMultiValue → parseMultiValue で往復できる', () => {
  const values = ['キズナ', 'Not This Time', 'ドゥラメンテ'];
  assert.deepEqual(parseMultiValue(serializeMultiValue(values)), values);
});

test('parseMultiValue: 空・未保存は空配列', () => {
  assert.deepEqual(parseMultiValue(''), []);
  assert.deepEqual(parseMultiValue(null), []);
  assert.deepEqual(parseMultiValue(undefined), []);
  assert.deepEqual(parseMultiValue(',,'), []);
});

test('parseMultiValue: 単一値（区切り無し）はそのまま1件として読める', () => {
  // <select> で1つだけ選んでいたころに保存された値を、複数選択に変えた後も復元できること
  assert.deepEqual(parseMultiValue('キズナ'), ['キズナ']);
  assert.deepEqual(parseMultiValue('牡'), ['牡']);
});

test('parseMultiValue: 前後の空白は落とし、重複は1件にまとめる', () => {
  assert.deepEqual(parseMultiValue(' キズナ , キズナ ,ハーツクライ'), ['キズナ', 'ハーツクライ']);
});

test('parseMultiValue: 名前に含まれる空白は残す', () => {
  assert.deepEqual(parseMultiValue('Not This Time'), ['Not This Time']);
});

test('countActiveFilters: 複数選んでも1つの絞り込みは1件と数える', () => {
  const s = state({ values: { 'filter-sire': serializeMultiValue(['キズナ', 'ハーツクライ']) } });
  assert.equal(countActiveFilters(s), 1);
});

// --- 「全部外したら全部にチェック」（父の絞り込み） ---

const SIRES = ['キズナ', 'サトノダイヤモンド', 'ドゥラメンテ'];

test('withAllWhenNoneSelected: 1つも選んでいなければ全選択になる', () => {
  assert.deepEqual(withAllWhenNoneSelected([], SIRES), SIRES);
});

test('withAllWhenNoneSelected: 1つでも選んでいればそのまま', () => {
  assert.deepEqual(withAllWhenNoneSelected(['キズナ'], SIRES), ['キズナ']);
  assert.deepEqual(withAllWhenNoneSelected(SIRES, SIRES), SIRES);
});

test('withAllWhenNoneSelected: 元の配列は変えない', () => {
  const selected: string[] = [];
  const result = withAllWhenNoneSelected(selected, SIRES);
  result.push('ハーツクライ');
  assert.deepEqual(selected, []);
  assert.deepEqual(SIRES, ['キズナ', 'サトノダイヤモンド', 'ドゥラメンテ']);
});

test('isAllSelected: 全部選んでいる＝絞っていない', () => {
  assert.equal(isAllSelected(SIRES, SIRES), true);
  // 並び順は問わない
  assert.equal(isAllSelected(['ドゥラメンテ', 'キズナ', 'サトノダイヤモンド'], SIRES), true);
});

test('isAllSelected: 一部だけなら絞り込みとして効いている', () => {
  assert.equal(isAllSelected(['キズナ'], SIRES), false);
  assert.equal(isAllSelected([], SIRES), false);
});

test('isAllSelected: 選択肢が0個のときは false', () => {
  assert.equal(isAllSelected([], []), false);
});

test('isAllSelected: 選択肢に無い値が混ざっていても全部揃っていれば true', () => {
  // その年に居なくなった父が保存データに残っている場合（復元時に読み飛ばされる）
  assert.equal(isAllSelected([...SIRES, 'ハーツクライ'], SIRES), true);
});
