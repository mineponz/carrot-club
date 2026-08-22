import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countActiveFilters,
  emptyFilterState,
  filterStorageKeyForYear,
  isEmptyFilterState,
  loadFilterState,
  parseFilterState,
  saveFilterState,
  serializeFilterState,
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
