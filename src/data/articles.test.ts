import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analysisArticles,
  sweetLydiaRelated,
  SWEET_LYDIA_HREF,
  relatedArticlesFor,
} from './articles.ts';

const known = new Set(analysisArticles.map((a) => a.href));

function check(href: string, related: unknown) {
  assert.ok(Array.isArray(related), `${href}: related が無い`);
  const list = related as string[];
  assert.equal(list.length, 3, `${href}: related は3本ちょうど`);
  assert.equal(new Set(list).size, 3, `${href}: related に重複`);
  assert.ok(!list.includes(href), `${href}: 自分自身を含む`);
  for (const h of list) assert.ok(known.has(h), `${href}: 関連先 ${h} が analysisArticles に無い`);
}

test('全記事が related を持ち、3本・自分自身なし・実在hrefのみ', () => {
  for (const a of analysisArticles) check(a.href, a.related);
});

test('sweet-lydia の関連3本も同じ条件を満たす', () => {
  check(SWEET_LYDIA_HREF, sweetLydiaRelated);
});

test('relatedArticlesFor は未定義ページで例外', () => {
  assert.equal(relatedArticlesFor(SWEET_LYDIA_HREF).length, 3);
  assert.throws(() => relatedArticlesFor('/articles/nope/'));
});
