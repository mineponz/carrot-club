import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lotteryListCellHtml,
  lotteryStatusRowHtml,
  LOTTERY_STATUS_COLUMNS,
} from './lottery-status-row.ts';
import type { LotteryStatusRow } from './lottery-status.ts';
import type { FrameLotteryResult } from '../data/lotteryStatus2026.ts';

function frame(outcome: FrameLotteryResult['outcome']): FrameLotteryResult {
  return { outcome, note: null };
}

function makeRow(overrides: Partial<LotteryStatusRow> = {}): LotteryStatusRow {
  return {
    id: '1',
    name: 'テスト号',
    sire: 'テストサイアー',
    sex: '牡',
    hasDamPriority: false,
    damPriority: null,
    normal: null,
    remainingShares: null,
    ...overrides,
  };
}

test('lotteryListCellHtml: rowがnull（その年度に情報源が無い）なら「—」', () => {
  assert.equal(lotteryListCellHtml(null), '—');
});

test('lotteryListCellHtml: 母馬優先対象外の馬は通常枠のバッジ1行だけ', () => {
  const html = lotteryListCellHtml(
    makeRow({ hasDamPriority: false, normal: frame({ rank: 'general', lotteryOccurred: true }) }),
  );
  assert.match(html, /class="lottery-badge rank-general occurred">一般抽選</);
  assert.ok(!html.includes('lottery-line-label'));
});

test('lotteryListCellHtml: 母馬優先対象馬は「母優先」「通常」の2行', () => {
  const html = lotteryListCellHtml(
    makeRow({
      hasDamPriority: true,
      damPriority: frame({ rank: 'general', lotteryOccurred: false }),
      normal: frame({ rank: 'general', lotteryOccurred: true }),
    }),
  );
  assert.match(html, /母優先:.*残口あり/);
  assert.match(html, /通常:.*一般抽選/);
  assert.equal((html.match(/lottery-line-label/g) ?? []).length, 2);
});

test('lotteryListCellHtml: 未発表（normalがnull）は「発表待ち」', () => {
  const html = lotteryListCellHtml(makeRow({ normal: null }));
  assert.equal(html, '発表待ち');
});

test('lotteryStatusRowHtml: セルの並びがLOTTERY_STATUS_COLUMNSと一致する', () => {
  const html = lotteryStatusRowHtml(makeRow());
  const cols = [...html.matchAll(/<td data-col="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    cols,
    LOTTERY_STATUS_COLUMNS.map((c) => c.key),
  );
});

test('lotteryStatusRowHtml: 対象外の馬の母馬優先枠セルは「—」', () => {
  const html = lotteryStatusRowHtml(makeRow({ hasDamPriority: false }));
  assert.match(html, /<td data-col="damPriority">—<\/td>/);
});

test('lotteryStatusRowHtml: 残り口数は「◯口」、未確定は「—」', () => {
  const withShares = lotteryStatusRowHtml(makeRow({ remainingShares: 8 }));
  assert.match(withShares, /<td data-col="remainingShares" class="num">8口<\/td>/);
  const withoutShares = lotteryStatusRowHtml(makeRow({ remainingShares: null }));
  assert.match(withoutShares, /<td data-col="remainingShares" class="num">—<\/td>/);
});

test('lotteryStatusRowHtml: 個別ページへのリンクを含む', () => {
  const html = lotteryStatusRowHtml(makeRow({ id: '42' }), '/2026/horses/');
  assert.match(html, /href="\/2026\/horses\/42\/"/);
});
