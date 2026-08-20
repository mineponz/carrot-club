import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getOrCreateAnonId, ANON_ID_STORAGE_KEY } from './anon-id.ts';
import { isValidAnonId } from './evaluation-api.ts';
import type { KeyValueStore } from './evaluations.ts';

function createMemoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const ID_A = '2f8a1c3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
const ID_B = '9e8d7c6b-5a4f-4e3d-9c2b-1a0f9e8d7c6b';

test('getOrCreateAnonId: 初回は生成して保存する', () => {
  const store = createMemoryStore();
  assert.equal(getOrCreateAnonId(store, () => ID_A), ID_A);
  assert.equal(store.getItem(ANON_ID_STORAGE_KEY), ID_A);
});

test('getOrCreateAnonId: 2回目以降は保存済みのIDを使い回す（呼ぶたびに変わらない）', () => {
  const store = createMemoryStore();
  const first = getOrCreateAnonId(store, () => ID_A);
  const second = getOrCreateAnonId(store, () => ID_B);
  assert.equal(second, first);
});

test('getOrCreateAnonId: 保存値が壊れていたら作り直す（送信が失敗し続けないように）', () => {
  const store = createMemoryStore({ [ANON_ID_STORAGE_KEY]: 'not-a-uuid' });
  assert.equal(getOrCreateAnonId(store, () => ID_A), ID_A);
  assert.equal(store.getItem(ANON_ID_STORAGE_KEY), ID_A);
});

test('匿名IDの保存キーは評価データと別（年度で分けない）', () => {
  assert.equal(ANON_ID_STORAGE_KEY, 'carrot-club:anon-id');
  assert.equal(ANON_ID_STORAGE_KEY.includes('2025'), false);
  assert.equal(ANON_ID_STORAGE_KEY.includes('2026'), false);
});

test('生成したIDはサーバー側の検証を通る形式である', () => {
  const store = createMemoryStore();
  assert.equal(isValidAnonId(getOrCreateAnonId(store, () => ID_A)), true);
});
