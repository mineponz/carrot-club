import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryVoteColumns, entryVoteRowHtml } from './entry-votes-row.ts';
import type { EntryVoteRow } from './entry-votes.ts';
import type { EntryVoteSnapshot } from '../data/entryVotes2026.ts';

const snapshots: EntryVoteSnapshot[] = [
  { asOf: '9/3', label: '第1回中間発表', byId: {} },
  { asOf: '9/4', label: '第2回中間発表', byId: {} },
];

test('entryVoteColumns: 固定列（No/馬名/父/牡牝）と回ごとの列グループ（最優先・総票数）を返す', () => {
  const cols = entryVoteColumns(snapshots);
  assert.deepEqual(cols.fixed.map((c) => c.key), ['id', 'name', 'sire', 'sex']);
  assert.deepEqual(cols.fixed.map((c) => c.label), ['No', '馬名', '父', '牡牝']);

  assert.equal(cols.rounds.length, 2);
  assert.equal(cols.rounds[0].asOf, '9/3');
  assert.deepEqual(cols.rounds[0].columns.map((c) => c.key), ['top:0', 'total:0']);
  assert.deepEqual(cols.rounds[0].columns.map((c) => c.label), ['最優先', '総票数']);
  assert.deepEqual(cols.rounds[0].columns.map((c) => c.sortKey), ['top:0', 'total:0']);

  assert.equal(cols.rounds[1].asOf, '9/4');
  assert.deepEqual(cols.rounds[1].columns.map((c) => c.key), ['top:1', 'total:1']);
});

test('entryVoteColumns: 回が増えれば列グループも増える', () => {
  const three: EntryVoteSnapshot[] = [...snapshots, { asOf: '9/5', label: '第3回中間発表', byId: {} }];
  const cols = entryVoteColumns(three);
  assert.equal(cols.rounds.length, 3);
  assert.deepEqual(cols.rounds[2].columns.map((c) => c.key), ['top:2', 'total:2']);
});

test('entryVoteColumns: 回の列に spSortKey は付かない（SPでも自分自身のキーで並べ替える）', () => {
  const cols = entryVoteColumns(snapshots);
  for (const round of cols.rounds) {
    for (const col of round.columns) {
      assert.equal(col.spSortKey, undefined);
    }
  }
});

const row: EntryVoteRow = {
  id: '7',
  name: 'フィリアプーラの25',
  sire: 'エフフォーリア',
  sex: '牡',
  cells: [{ total: 420, topPriority: 100, damPriority: 58 }, null],
  latestTotal: 420,
};

test('entryVoteRowHtml: No・馬名・個別ページリンク・父・牡牝を含む', () => {
  const html = entryVoteRowHtml(row);
  assert.match(html, /data-horse-id="7"/);
  assert.match(html, /href="\/2026\/horses\/7\/"/);
  assert.match(html, />フィリアプーラの25</);
  assert.match(html, /data-col="sire">エフフォーリア</);
  assert.match(html, /data-col="sex">牡</);
});

test('entryVoteRowHtml: 最優先・総票数を別セルで出す（最優先が先）', () => {
  const html = entryVoteRowHtml(row);
  assert.match(html, /<td data-col="top:0" class="num">100<\/td>\s*<td data-col="total:0" class="num">420<\/td>/);
});

test('entryVoteRowHtml: 未発表回は両セルとも「—」', () => {
  const html = entryVoteRowHtml(row);
  assert.match(html, /<td data-col="top:1" class="num">—<\/td>\s*<td data-col="total:1" class="num">—<\/td>/);
});

test('entryVoteRowHtml: 最優先の数字が無ければ最優先セルだけ「—」', () => {
  const html = entryVoteRowHtml({
    ...row,
    cells: [{ total: 300, topPriority: null, damPriority: null }],
  });
  assert.match(html, /<td data-col="top:0" class="num">—<\/td>\s*<td data-col="total:0" class="num">300<\/td>/);
});

test('entryVoteRowHtml: 空発表（全 cells が null）でも行は崩れず全セル「—」', () => {
  const html = entryVoteRowHtml({ ...row, cells: [null, null], latestTotal: null });
  assert.match(html, /<td data-col="top:0" class="num">—<\/td>\s*<td data-col="total:0" class="num">—<\/td>/);
  assert.match(html, /<td data-col="top:1" class="num">—<\/td>\s*<td data-col="total:1" class="num">—<\/td>/);
});

test('entryVoteRowHtml: 別年度の接頭辞を渡すとリンク先が変わる', () => {
  const html = entryVoteRowHtml(row, '/2025/horses/');
  assert.match(html, /href="\/2025\/horses\/7\/"/);
});

test('entryVoteRowHtml: SP 用に No・父・牡牝を馬名セルへ畳む（.sp-no / .sp-line は「父（性）」）', () => {
  const html = entryVoteRowHtml(row);
  assert.match(html, /<span class="sp-no">7\.<\/span>/);
  assert.match(html, /<span class="sp-line">エフフォーリア（牡）<\/span>/);
});
