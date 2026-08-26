import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hiddenColumnsStorageKeyForYear,
  loadHiddenColumns,
  loadShowMemo,
  saveHiddenColumns,
  saveShowMemo,
  showMemoStorageKeyForYear,
} from './view-options.ts';

/** テスト用の localStorage 代わり（filter-state.test.ts と同じ形）。 */
function createStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

test('showMemoStorageKeyForYear: 募集年ごとにキーを分ける', () => {
  assert.equal(showMemoStorageKeyForYear(2026), 'carrot-club:show-memo:2026');
  assert.notEqual(showMemoStorageKeyForYear(2026), showMemoStorageKeyForYear(2025));
});

test('loadShowMemo: 保存が無ければ隠す（既定）', () => {
  const store = createStore();
  assert.equal(loadShowMemo(store, 'k'), false);
});

test('saveShowMemo → loadShowMemo で往復できる', () => {
  const store = createStore();
  saveShowMemo(store, 'k', true);
  assert.equal(loadShowMemo(store, 'k'), true);
});

test('saveShowMemo: 既定（隠す）に戻したらキーごと消す', () => {
  const store = createStore();
  saveShowMemo(store, 'k', true);
  saveShowMemo(store, 'k', false);
  assert.equal(store.map.has('k'), false);
  assert.equal(loadShowMemo(store, 'k'), false);
});

test('loadShowMemo: 壊れた値は隠す側に倒す', () => {
  const store = createStore();
  store.setItem('k', 'yes');
  assert.equal(loadShowMemo(store, 'k'), false);
});

test('hiddenColumnsStorageKeyForYear: 募集年ごとにキーを分ける', () => {
  assert.equal(hiddenColumnsStorageKeyForYear(2026), 'carrot-club:hidden-columns:2026');
  assert.notEqual(hiddenColumnsStorageKeyForYear(2026), hiddenColumnsStorageKeyForYear(2025));
  // メモ列のトグルとは別キーにする（片方を消してももう片方が残るように）
  assert.notEqual(hiddenColumnsStorageKeyForYear(2026), showMemoStorageKeyForYear(2026));
});

test('loadHiddenColumns: 保存が無ければ1列も隠さない（既定＝全列表示）', () => {
  const store = createStore();
  assert.deepEqual(loadHiddenColumns(store, 'k'), new Set());
});

test('saveHiddenColumns → loadHiddenColumns で往復できる', () => {
  const store = createStore();
  saveHiddenColumns(store, 'k', new Set(['sire', 'stable']));
  assert.deepEqual(loadHiddenColumns(store, 'k'), new Set(['sire', 'stable']));
});

test('saveHiddenColumns: 全部表示に戻したらキーごと消す', () => {
  const store = createStore();
  saveHiddenColumns(store, 'k', new Set(['sire']));
  saveHiddenColumns(store, 'k', new Set());
  assert.equal(store.map.has('k'), false);
  assert.deepEqual(loadHiddenColumns(store, 'k'), new Set());
});

test('loadHiddenColumns: 空要素・前後の空白が混ざっていても読める', () => {
  const store = createStore();
  store.setItem('k', ' sire ,, stable,');
  assert.deepEqual(loadHiddenColumns(store, 'k'), new Set(['sire', 'stable']));
});
