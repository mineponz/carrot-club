import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffClass, formatDiff, tourWeightRowHtml, TOUR_WEIGHT_COLUMNS } from './tour-weight-row.ts';
import type { TourWeightRow } from './tour-weight.ts';

const row: TourWeightRow = {
  id: '7',
  name: 'フィリアプーラの25',
  sire: 'エピファネイア',
  sex: '牡',
  weight: 430,
  tourWeight: 440,
  diff: 10,
};

test('formatDiff: プラスは符号を明示し、マイナス・0はそのまま', () => {
  assert.equal(formatDiff(10), '+10');
  assert.equal(formatDiff(-8), '-8');
  assert.equal(formatDiff(0), '0');
});

test('diffClass: 符号ごとにクラスを返し、nullは空文字', () => {
  assert.equal(diffClass(10), 'diff-up');
  assert.equal(diffClass(-8), 'diff-down');
  assert.equal(diffClass(0), '');
  assert.equal(diffClass(null), '');
});

test('tourWeightRowHtml: 主要データと個別ページへのリンクを含む', () => {
  const html = tourWeightRowHtml(row);
  assert.match(html, /data-horse-id="7"/);
  assert.match(html, /href="\/horses\/7\/"/);
  assert.match(html, />フィリアプーラの25</);
  assert.match(html, /data-col="weight" class="num">430</);
  assert.match(html, /data-col="tourWeight" class="num">440</);
  assert.match(html, /data-col="diff" class="num diff-up">\+10</);
});

test('tourWeightRowHtml: 未計測（tourWeight/diffがnull）は代替表記になる', () => {
  const html = tourWeightRowHtml({ ...row, tourWeight: null, diff: null });
  assert.match(html, /data-col="tourWeight" class="num">未計測/);
  assert.match(html, /data-col="diff" class="num ">−/);
});

test('tourWeightRowHtml: 別年度の接頭辞を渡すとリンク先が変わる', () => {
  const html = tourWeightRowHtml(row, '/2025/horses/');
  assert.match(html, /href="\/2025\/horses\/7\/"/);
});

test('TOUR_WEIGHT_COLUMNS: セルのdata-colと1対1対応する見出しキーを持つ', () => {
  const html = tourWeightRowHtml(row);
  for (const col of TOUR_WEIGHT_COLUMNS) {
    assert.match(html, new RegExp(`data-col="${col.key}"`));
  }
});
