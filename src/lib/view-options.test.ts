import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadShowMemo, saveShowMemo, showMemoStorageKeyForYear } from './view-options.ts';

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
