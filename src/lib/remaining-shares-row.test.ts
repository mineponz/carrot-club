import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remainingSharesCellHtml } from './remaining-shares-row.ts';
import type { RemainingSharesRow } from './remaining-shares.ts';

test('remainingSharesCellHtml: rowがnull（情報源の無い年度）は「—」', () => {
  assert.equal(remainingSharesCellHtml(null), '—');
});

test('remainingSharesCellHtml: 未発表（hasRemaining: null）は「発表待ち」', () => {
  const row: RemainingSharesRow = { id: '1', hasRemaining: null, shares: null };
  assert.equal(remainingSharesCellHtml(row), '発表待ち');
});

test('remainingSharesCellHtml: 対象外（満口）は「—」', () => {
  const row: RemainingSharesRow = { id: '1', hasRemaining: false, shares: null };
  assert.equal(remainingSharesCellHtml(row), '—');
});

test('remainingSharesCellHtml: 対象で口数未発表は「あり」バッジ', () => {
  const row: RemainingSharesRow = { id: '9', hasRemaining: true, shares: null };
  assert.equal(remainingSharesCellHtml(row), '<span class="remaining-badge">あり</span>');
});

test('remainingSharesCellHtml: 実数が出ている馬は「N口」バッジ', () => {
  const row: RemainingSharesRow = { id: '9', hasRemaining: true, shares: { kind: 'exact', count: 12 } };
  assert.equal(remainingSharesCellHtml(row), '<span class="remaining-badge">12口</span>');
});

// クラブが実数を出すのは残口100口（地方入厩予定馬は25口）以下の馬だけ。
test('remainingSharesCellHtml: 実数が出ない馬は「N口以上」バッジ', () => {
  const row: RemainingSharesRow = { id: '9', hasRemaining: true, shares: { kind: 'atLeast', count: 100 } };
  assert.equal(remainingSharesCellHtml(row), '<span class="remaining-badge">100口以上</span>');
});
