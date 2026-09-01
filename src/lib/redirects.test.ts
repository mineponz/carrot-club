import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redirectTarget } from './redirects.ts';
import { horses2026 } from '../data/horses2026.ts';

test('redirectTarget: 年度なしの個別ページは年度付きへ301（末尾スラッシュ付き）', () => {
  assert.equal(redirectTarget('/horses/1/'), '/2026/horses/1/');
  assert.equal(redirectTarget('/horses/93/'), '/2026/horses/93/');
});

test('redirectTarget: 末尾スラッシュ無し・index.html 付きも同じ正本URLへ寄せる', () => {
  assert.equal(redirectTarget('/horses/1'), '/2026/horses/1/');
  assert.equal(redirectTarget('/horses/1/index.html'), '/2026/horses/1/');
});

test('redirectTarget: 年度なしのツアー後馬体重ページも年度付きへ301', () => {
  assert.equal(redirectTarget('/tour-weight/'), '/2026/tour-weight/');
  assert.equal(redirectTarget('/tour-weight'), '/2026/tour-weight/');
  assert.equal(redirectTarget('/tour-weight/index.html'), '/2026/tour-weight/');
});

test('redirectTarget: /2026/ は最新年度の別名なので一覧トップへ301', () => {
  assert.equal(redirectTarget('/2026/'), '/');
  assert.equal(redirectTarget('/2026'), '/');
  assert.equal(redirectTarget('/2026/index.html'), '/');
});

test('redirectTarget: 正本URLはリダイレクトしない（301のチェーンを作らない）', () => {
  // ここが null でなくなると /horses/1/ → /2026/horses/1/ → … と多段になる
  assert.equal(redirectTarget('/2026/horses/1/'), null);
  assert.equal(redirectTarget('/2026/tour-weight/'), null);
  assert.equal(redirectTarget('/'), null);
});

test('redirectTarget: 過去年度（/2025/）は無傷', () => {
  assert.equal(redirectTarget('/2025/'), null);
  assert.equal(redirectTarget('/2025/horses/7/'), null);
});

test('redirectTarget: 記事・API・404 は素通しする', () => {
  assert.equal(redirectTarget('/articles/'), null);
  assert.equal(redirectTarget('/articles/height/'), null);
  assert.equal(redirectTarget('/api/evaluations'), null);
  assert.equal(redirectTarget('/api/evaluations/summary'), null);
  assert.equal(redirectTarget('/404/'), null);
});

test('redirectTarget: id の無い /horses/ 自体はリダイレクトしない（404のまま）', () => {
  assert.equal(redirectTarget('/horses/'), null);
  assert.equal(redirectTarget('/horses'), null);
});

test('redirectTarget: 個別ページより下の階層は個別ページではないのでリダイレクトしない', () => {
  assert.equal(redirectTarget('/horses/1/foo/'), null);
  assert.equal(redirectTarget('/horses/1/foo/bar/'), null);
});

test('redirectTarget: 2026年募集馬の全IDが1ホップで正本URLに着く', () => {
  for (const horse of horses2026) {
    const target = redirectTarget(`/horses/${horse.id}/`);
    assert.equal(target, `/2026/horses/${horse.id}/`);
    // 転送先をもう一度かけても null＝チェーンが伸びない
    assert.equal(redirectTarget(target!), null);
  }
});
