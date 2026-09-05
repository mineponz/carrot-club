import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_HOSTNAME,
  LEGACY_HOSTNAME,
  redirectTarget,
  redirectTargetForHost,
} from './redirects.ts';
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

test('redirectTarget: 年度なしの募集申込票数ページも年度付きへ301', () => {
  assert.equal(redirectTarget('/votes/'), '/2026/votes/');
  assert.equal(redirectTarget('/votes'), '/2026/votes/');
  assert.equal(redirectTarget('/votes/index.html'), '/2026/votes/');
});

test('redirectTarget: 年度なしの抽選ステータス一覧ページも年度付きへ301', () => {
  assert.equal(redirectTarget('/lottery/'), '/2026/lottery/');
  assert.equal(redirectTarget('/lottery'), '/2026/lottery/');
  assert.equal(redirectTarget('/lottery/index.html'), '/2026/lottery/');
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
  assert.equal(redirectTarget('/2026/votes/'), null);
  assert.equal(redirectTarget('/2026/lottery/'), null);
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

test('redirectTargetForHost: 旧ドメイン＋旧パスは1ホップで正本ドメイン・正本パスへ', () => {
  // ここが2段（旧ドメイン→新ドメインの旧パス→正本）になると、ドメイン移行前から
  // 張られている古い被リンクほど遠回りになる
  assert.deepEqual(redirectTargetForHost(LEGACY_HOSTNAME, '/horses/1/'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/2026/horses/1/',
  });
  assert.deepEqual(redirectTargetForHost(LEGACY_HOSTNAME, '/tour-weight/'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/2026/tour-weight/',
  });
  assert.deepEqual(redirectTargetForHost(LEGACY_HOSTNAME, '/lottery/'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/2026/lottery/',
  });
  assert.deepEqual(redirectTargetForHost(LEGACY_HOSTNAME, '/2026/'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/',
  });
});

test('redirectTargetForHost: 旧ドメインはパスが正本でもホスト名を直すため必ず転送する', () => {
  assert.deepEqual(redirectTargetForHost(LEGACY_HOSTNAME, '/2026/horses/1/'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/2026/horses/1/',
  });
  assert.deepEqual(redirectTargetForHost(LEGACY_HOSTNAME, '/2025/horses/7/'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/2025/horses/7/',
  });
  assert.deepEqual(redirectTargetForHost(LEGACY_HOSTNAME, '/articles/height/'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/articles/height/',
  });
  // APIも旧ドメイン宛なら新ドメインへ寄せる（パスはそのまま）
  assert.deepEqual(redirectTargetForHost(LEGACY_HOSTNAME, '/api/evaluations'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/api/evaluations',
  });
});

test('redirectTargetForHost: 正本ドメインでは旧パスだけを見る', () => {
  assert.deepEqual(redirectTargetForHost(CANONICAL_HOSTNAME, '/horses/1/'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/2026/horses/1/',
  });
  // 正本パスは転送しない＝チェーンを作らない
  assert.equal(redirectTargetForHost(CANONICAL_HOSTNAME, '/2026/horses/1/'), null);
  assert.equal(redirectTargetForHost(CANONICAL_HOSTNAME, '/'), null);
  assert.equal(redirectTargetForHost(CANONICAL_HOSTNAME, '/2025/'), null);
  assert.equal(redirectTargetForHost(CANONICAL_HOSTNAME, '/articles/height/'), null);
  // APIを飲み込まない（301を返すとハンドラに届かなくなる）
  assert.equal(redirectTargetForHost(CANONICAL_HOSTNAME, '/api/evaluations'), null);
  assert.equal(redirectTargetForHost(CANONICAL_HOSTNAME, '/api/evaluations/summary'), null);
});

test('redirectTargetForHost: 旧ドメインの全IDが1ホップで正本に着く', () => {
  for (const horse of horses2026) {
    const hit = redirectTargetForHost(LEGACY_HOSTNAME, `/horses/${horse.id}/`);
    assert.deepEqual(hit, {
      hostname: CANONICAL_HOSTNAME,
      pathname: `/2026/horses/${horse.id}/`,
    });
    // 転送先をもう一度かけても null＝チェーンが伸びない
    assert.equal(redirectTargetForHost(hit!.hostname, hit!.pathname), null);
  }
});
