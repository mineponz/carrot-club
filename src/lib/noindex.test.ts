import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNoindexPath, NOINDEX_PATH_PREFIXES } from '../consts.ts';

test('isNoindexPath: 既存の転記ページ（馬個別・ツアー後馬体重・募集申込票数）は noindex', () => {
  assert.equal(isNoindexPath('/2026/horses/1/'), true);
  assert.equal(isNoindexPath('/2025/horses/93/'), true);
  assert.equal(isNoindexPath('/2026/tour-weight/'), true);
  assert.equal(isNoindexPath('/2026/votes/'), true);
});

test('isNoindexPath: 抽選ステータス一覧 /2026/lottery/ は noindex（2026-09-12追加）', () => {
  assert.equal(isNoindexPath('/2026/lottery/'), true);
  assert.equal(isNoindexPath('/2026/lottery/foo/'), true); // 前方一致
});

test('isNoindexPath: 出資馬の個別ページ /my-horses/<slug>/ は noindex（2026-09-12追加）', () => {
  assert.equal(isNoindexPath('/my-horses/eir/'), true);
  assert.equal(isNoindexPath('/my-horses/some-other-horse/'), true);
});

test('isNoindexPath: /my-horses/ 一覧そのものは index のまま', () => {
  assert.equal(isNoindexPath('/my-horses/'), false);
});

test('isNoindexPath: /my-horses/article/* （自作記事）は index のまま', () => {
  assert.equal(isNoindexPath('/my-horses/article/sweet-lydia/'), false);
  assert.equal(isNoindexPath('/my-horses/article/'), false);
});

test('isNoindexPath: トップ・記事・about・privacy は index のまま', () => {
  assert.equal(isNoindexPath('/'), false);
  assert.equal(isNoindexPath('/2026/'), false);
  assert.equal(isNoindexPath('/articles/height/'), false);
  assert.equal(isNoindexPath('/about/'), false);
  assert.equal(isNoindexPath('/privacy/'), false);
  assert.equal(isNoindexPath('/disclaimer/'), false);
});

test('isNoindexPath: 前方一致だが接頭辞そのものではない紛らわしいパスを誤って拾わない', () => {
  // "/my-horses" は末尾スラッシュ無しなので接頭辞に一致しない（normalizePathを通さない生のpathname判定のため）
  assert.equal(isNoindexPath('/my-horsesx/'), false);
});

test('NOINDEX_PATH_PREFIXES: 2026-09-12時点で期待する接頭辞が揃っている', () => {
  assert.deepEqual(NOINDEX_PATH_PREFIXES, [
    '/2025/horses/',
    '/2026/horses/',
    '/2026/tour-weight/',
    '/2026/votes/',
    '/2026/lottery/',
  ]);
});
