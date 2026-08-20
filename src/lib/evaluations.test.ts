import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadEvaluations,
  saveEvaluations,
  getEvaluation,
  isEmptyEvaluation,
  updateEvaluation,
  DEFAULT_EVALUATION,
  STORAGE_KEY,
  storageKeyForYear,
  type KeyValueStore,
  type EvaluationMap,
} from './evaluations.ts';

/** テスト用のインメモリ KeyValueStore（localStorageの最小互換実装） */
function createMemoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

test('loadEvaluations: 何も保存されていなければ空のマップを返す', () => {
  const store = createMemoryStore();
  assert.deepEqual(loadEvaluations(store, STORAGE_KEY), {});
});

test('loadEvaluations: 壊れたJSONでもエラーを投げず空のマップを返す', () => {
  const store = createMemoryStore();
  store.setItem(STORAGE_KEY, '{not valid json');
  assert.deepEqual(loadEvaluations(store, STORAGE_KEY), {});
});

test('saveEvaluations → loadEvaluations で往復できる', () => {
  const store = createMemoryStore();
  const map: EvaluationMap = {
    '2025-001': { rating: 'A', favorite: true, skip: false, memo: 'これは良い' },
  };
  saveEvaluations(store, STORAGE_KEY, map);
  assert.deepEqual(loadEvaluations(store, STORAGE_KEY), map);
});

test('storageKeyForYear: 募集年ごとに別のキーになる（既存の2025キーは従来のまま）', () => {
  assert.equal(storageKeyForYear(2025), 'carrot-club:evaluations:2025');
  assert.equal(storageKeyForYear(2025), STORAGE_KEY);
  assert.notEqual(storageKeyForYear(2026), storageKeyForYear(2025));
});

test('年度が違えば同じ馬IDでも評価が混ざらない', () => {
  const store = createMemoryStore();
  saveEvaluations(store, storageKeyForYear(2025), {
    '1': { rating: 'A', favorite: false, skip: false, memo: '2025年のNo.1' },
  });
  saveEvaluations(store, storageKeyForYear(2026), {
    '1': { rating: 'E', favorite: false, skip: false, memo: '2026年のNo.1' },
  });
  assert.equal(getEvaluation(loadEvaluations(store, storageKeyForYear(2025)), '1').memo, '2025年のNo.1');
  assert.equal(getEvaluation(loadEvaluations(store, storageKeyForYear(2026)), '1').memo, '2026年のNo.1');
});

test('getEvaluation: 未評価の馬にはデフォルト値を返す', () => {
  assert.deepEqual(getEvaluation({}, '2025-999'), DEFAULT_EVALUATION);
});

test('getEvaluation: 既存の評価があればそれを返す', () => {
  const map: EvaluationMap = {
    '2025-001': { rating: 'B', favorite: false, skip: true, memo: '保留' },
  };
  assert.deepEqual(getEvaluation(map, '2025-001'), map['2025-001']);
});

test('updateEvaluation: 未評価の馬に部分更新すると、他フィールドはデフォルト値のまま追加される', () => {
  const updated = updateEvaluation({}, '2025-001', { rating: 'A' });
  assert.deepEqual(updated['2025-001'], { ...DEFAULT_EVALUATION, rating: 'A' });
});

test('updateEvaluation: 既存評価の一部フィールドだけ更新する', () => {
  const map: EvaluationMap = {
    '2025-001': { rating: 'A', favorite: false, skip: false, memo: '' },
  };
  const updated = updateEvaluation(map, '2025-001', { favorite: true });
  assert.deepEqual(updated['2025-001'], { rating: 'A', favorite: true, skip: false, memo: '' });
});

test('updateEvaluation: 元のマップを変更しない（イミュータブル）', () => {
  const map: EvaluationMap = {};
  const updated = updateEvaluation(map, '2025-001', { rating: 'C' });
  assert.deepEqual(map, {});
  assert.notEqual(updated, map);
});

test('updateEvaluation: 他の馬の評価に影響しない', () => {
  const map: EvaluationMap = {
    '2025-001': { rating: 'A', favorite: false, skip: false, memo: '' },
  };
  const updated = updateEvaluation(map, '2025-002', { rating: 'B' });
  assert.deepEqual(updated['2025-001'], map['2025-001']);
  assert.deepEqual(updated['2025-002'], { ...DEFAULT_EVALUATION, rating: 'B' });
});

test('isEmptyEvaluation: 何も入っていない評価だけ true（アップロード対象から外すため）', () => {
  assert.equal(isEmptyEvaluation(DEFAULT_EVALUATION), true);
  assert.equal(isEmptyEvaluation({ ...DEFAULT_EVALUATION, rating: 'A' }), false);
  assert.equal(isEmptyEvaluation({ ...DEFAULT_EVALUATION, favorite: true }), false);
  assert.equal(isEmptyEvaluation({ ...DEFAULT_EVALUATION, skip: true }), false);
  // A〜Eを付けていなくてもメモがあれば同期する（「気になるので後で調べる」の類）
  assert.equal(isEmptyEvaluation({ ...DEFAULT_EVALUATION, memo: 'あとで調べる' }), false);
});
