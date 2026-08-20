import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peerBarHtml, peerBreakdownHtml, peerCellHtml, peerSummaryLabel } from './peer-eval.ts';
import { emptyRatingCounts, type RatingCounts } from './evaluation-api.ts';

const COUNTS: RatingCounts = { A: 2, B: 2, C: 1, D: 0, E: 0 };

test('peerSummaryLabel: 人数と内訳を読める文にする', () => {
  assert.equal(peerSummaryLabel(COUNTS), '他の会員5人の評価（A2・B2・C1）');
});

test('peerSummaryLabel: 0票・未取得はどちらも「まだありません」', () => {
  assert.equal(peerSummaryLabel(null), '他の会員の評価はまだありません');
  assert.equal(peerSummaryLabel(emptyRatingCounts()), '他の会員の評価はまだありません');
});

test('peerBarHtml: 0票の評価は段を作らない', () => {
  const html = peerBarHtml(COUNTS);
  assert.match(html, /data-rating="A"/);
  assert.match(html, /data-rating="C"/);
  assert.doesNotMatch(html, /data-rating="D"/);
  assert.doesNotMatch(html, /data-rating="E"/);
});

test('peerBarHtml: 幅は flex-grow で票数の比を表す（端数の丸めを持ち込まない）', () => {
  const html = peerBarHtml(COUNTS);
  assert.match(html, /data-rating="A" style="flex-grow:2"/);
  assert.match(html, /data-rating="C" style="flex-grow:1"/);
  assert.doesNotMatch(html, /%/);
});

test('peerCellHtml: 未取得(undefined)と0票を見た目で区別する', () => {
  assert.match(peerCellHtml(undefined), /peer-loading/);
  assert.match(peerCellHtml(null), /peer-empty/);
  assert.match(peerCellHtml(emptyRatingCounts()), /peer-empty/);
});

test('peerCellHtml: 票があれば棒と合計人数を出す', () => {
  const html = peerCellHtml(COUNTS);
  assert.match(html, /peer-bar/);
  assert.match(html, /<span class="peer-total">5<\/span>/);
  // 棒は装飾なので、読み上げ用に同じ内容のテキストを添える
  assert.match(html, /visually-hidden">他の会員5人の評価（A2・B2・C1）/);
});

test('peerBreakdownHtml: 個別ページはA〜E全段を出す（0票の段も形として意味がある）', () => {
  const html = peerBreakdownHtml(COUNTS);
  for (const r of ['A', 'B', 'C', 'D', 'E']) {
    assert.match(html, new RegExp(`class="peer-key" data-rating="${r}"`));
  }
  assert.match(html, /width:40\.0%/); // A: 2/5
  assert.match(html, /width:0\.0%/); // D・E
  assert.match(html, /他の会員5人が評価しています/);
});

test('peerBreakdownHtml: 0票なら棒を並べず一文で伝える', () => {
  assert.match(peerBreakdownHtml(null), /peer-none/);
  assert.match(peerBreakdownHtml(emptyRatingCounts()), /まだ他の会員の評価がありません/);
});
