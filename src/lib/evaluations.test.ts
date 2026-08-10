import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadEvaluations,
  saveEvaluations,
  getEvaluation,
  updateEvaluation,
  DEFAULT_EVALUATION,
  STORAGE_KEY,
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
  assert.deepEqual(loadEvaluations(store), {});
});

test('loadEvaluations: 壊れたJSONでもエラーを投げず空のマップを返す', () => {
  const store = createMemoryStore();
  store.setItem(STORAGE_KEY, '{not valid json');
  assert.deepEqual(loadEvaluations(store), {});
});

test('saveEvaluations → loadEvaluations で往復できる', () => {
  const store = createMemoryStore();
  const map: EvaluationMap = {
    '2025-001': { rating: 'A', favorite: true, skip: false, memo: 'これは良い' },
  };
  saveEvaluations(store, map);
  assert.deepEqual(loadEvaluations(store), map);
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
