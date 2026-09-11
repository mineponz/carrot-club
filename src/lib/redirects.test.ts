import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BARE_HOSTNAME,
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

test('redirectTargetForHost: 裸ドメイン＋旧パスは1ホップで正本ドメイン・正本パスへ', () => {
  // ここが2段（裸ドメイン→裸ドメインの旧パス→正本、のようなもの）になると意味が無い
  assert.deepEqual(redirectTargetForHost(BARE_HOSTNAME, '/horses/1/'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/2026/horses/1/',
  });
  assert.deepEqual(redirectTargetForHost(BARE_HOSTNAME, '/tour-weight/'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/2026/tour-weight/',
  });
  assert.deepEqual(redirectTargetForHost(BARE_HOSTNAME, '/lottery/'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/2026/lottery/',
  });
  assert.deepEqual(redirectTargetForHost(BARE_HOSTNAME, '/2026/'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/',
  });
});

test('redirectTargetForHost: 裸ドメインはパスが正本でもホスト名を直すため必ず転送する', () => {
  assert.deepEqual(redirectTargetForHost(BARE_HOSTNAME, '/'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/',
  });
  assert.deepEqual(redirectTargetForHost(BARE_HOSTNAME, '/2026/horses/1/'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/2026/horses/1/',
  });
  assert.deepEqual(redirectTargetForHost(BARE_HOSTNAME, '/articles/height/'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/articles/height/',
  });
  // APIも裸ドメイン宛なら新ドメインへ寄せる（パスはそのまま）
  assert.deepEqual(redirectTargetForHost(BARE_HOSTNAME, '/api/evaluations'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/api/evaluations',
  });
});

test('redirectTargetForHost: 裸ドメインの /ads.txt だけは301せずそのまま（AdSenseがルートドメインを見るため）', () => {
  assert.equal(redirectTargetForHost(BARE_HOSTNAME, '/ads.txt'), null);
  // 正本ドメイン・旧ドメインの ads.txt は対象外の挙動確認（正本は素通し、旧ドメインは新ドメインへ）
  assert.equal(redirectTargetForHost(CANONICAL_HOSTNAME, '/ads.txt'), null);
  assert.deepEqual(redirectTargetForHost(LEGACY_HOSTNAME, '/ads.txt'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/ads.txt',
  });
});

test('redirectTargetForHost: 裸ドメインの全IDが1ホップで正本に着く', () => {
  for (const horse of horses2026) {
    const hit = redirectTargetForHost(BARE_HOSTNAME, `/horses/${horse.id}/`);
    assert.deepEqual(hit, {
      hostname: CANONICAL_HOSTNAME,
      pathname: `/2026/horses/${horse.id}/`,
    });
    // 転送先をもう一度かけても null＝チェーンが伸びない
    assert.equal(redirectTargetForHost(hit!.hostname, hit!.pathname), null);
  }
});

test('redirectTargetForHost: 存在しないパスも裸ドメインならホスト名だけ寄せて正本へ渡す（404はASSETS側の仕事）', () => {
  assert.deepEqual(redirectTargetForHost(BARE_HOSTNAME, '/no-such-page/'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/no-such-page/',
  });
});

test('redirectTargetForHost: 末尾スラッシュ無しの正本パスも末尾スラッシュを補って1ホップにする（2026-09-12発見: 補わないとASSETS側の307で2ホップになっていた）', () => {
  const cases: [string, string][] = [
    ['/my-horses/eir', '/my-horses/eir/'],
    ['/articles/height', '/articles/height/'],
    ['/2026/lottery', '/2026/lottery/'],
    ['/2026/horses/1', '/2026/horses/1/'],
    ['/my-horses', '/my-horses/'],
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(
      redirectTargetForHost(BARE_HOSTNAME, input),
      { hostname: CANONICAL_HOSTNAME, pathname: expected },
      `BARE_HOSTNAME: ${input}`,
    );
    assert.deepEqual(
      redirectTargetForHost(LEGACY_HOSTNAME, input),
      { hostname: CANONICAL_HOSTNAME, pathname: expected },
      `LEGACY_HOSTNAME: ${input}`,
    );
  }
});

test('redirectTargetForHost: 末尾スラッシュ補完の対象外（ルート・API・拡張子付き・既に末尾スラッシュ付き）は変えない', () => {
  assert.deepEqual(redirectTargetForHost(BARE_HOSTNAME, '/'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/',
  });
  assert.deepEqual(redirectTargetForHost(LEGACY_HOSTNAME, '/'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/',
  });
  // APIは末尾スラッシュを持たない設計なので付けない
  assert.deepEqual(redirectTargetForHost(BARE_HOSTNAME, '/api/evaluations'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/api/evaluations',
  });
  assert.deepEqual(redirectTargetForHost(LEGACY_HOSTNAME, '/api/evaluations/summary'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/api/evaluations/summary',
  });
  // 拡張子付きは付けない（裸ドメインのads.txtは301そのものが無い。別テストで確認済み）
  assert.deepEqual(redirectTargetForHost(LEGACY_HOSTNAME, '/ads.txt'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/ads.txt',
  });
  assert.deepEqual(redirectTargetForHost(LEGACY_HOSTNAME, '/sitemap-index.xml'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/sitemap-index.xml',
  });
  // 既に末尾スラッシュ付きのものはそのまま
  assert.deepEqual(redirectTargetForHost(BARE_HOSTNAME, '/my-horses/eir/'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/my-horses/eir/',
  });
});

test('redirectTargetForHost: /index.html 明示指定は末尾スラッシュ補完の対象外（拡張子付き扱いのため従来どおり）', () => {
  // ルート直下の /index.html はどの正本パスにも一致せず（redirectTarget が null を返す）、
  // 拡張子付き（.html）扱いなので末尾スラッシュは付かない。ホスト名だけ寄せて転送する。
  assert.deepEqual(redirectTargetForHost(BARE_HOSTNAME, '/index.html'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/index.html',
  });
  assert.deepEqual(redirectTargetForHost(LEGACY_HOSTNAME, '/index.html'), {
    hostname: CANONICAL_HOSTNAME,
    pathname: '/index.html',
  });
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
