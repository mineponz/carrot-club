import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryVoteColumns, entryVoteRowHtml } from './entry-votes-row.ts';
import type { EntryVoteRow } from './entry-votes.ts';
import type { EntryVoteSnapshot } from '../data/entryVotes2026.ts';

const snapshots: EntryVoteSnapshot[] = [
  { asOf: '9/3', label: '第1回中間発表', byId: {} },
  { asOf: '9/4', label: '第2回中間発表', byId: {} },
];

test('entryVoteColumns: 固定列（No/馬名/父/牡牝）＋各回列を動的生成する', () => {
  const cols = entryVoteColumns(snapshots);
  assert.deepEqual(cols.map((c) => c.key), ['id', 'name', 'sire', 'sex', 'total:0', 'total:1']);
  assert.deepEqual(cols.map((c) => c.label), ['No', '馬名', '父', '牡牝', '9/3 票数', '9/4 票数']);
  // 各回列は total:${i} でソート、SP では募集番号順
  assert.equal(cols[4].sortKey, 'total:0');
  assert.equal(cols[4].spSortKey, 'id');
  assert.equal(cols[5].sortKey, 'total:1');
  // 馬名の SP ソートキーも id
  assert.equal(cols[1].spSortKey, 'id');
});

test('entryVoteColumns: 回が増えれば列も増える', () => {
  const three: EntryVoteSnapshot[] = [...snapshots, { asOf: '9/5', label: '第3回中間発表', byId: {} }];
  const cols = entryVoteColumns(three);
  assert.deepEqual(cols.map((c) => c.key), ['id', 'name', 'sire', 'sex', 'total:0', 'total:1', 'total:2']);
});

const row: EntryVoteRow = {
  id: '7',
  name: 'フィリアプーラの25',
  sire: 'エフフォーリア',
  sex: '牡',
  cells: [{ total: 420, damPriority: 58 }, null],
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

test('entryVoteRowHtml: 全体票数を主、母優票数を小さく併記する', () => {
  const html = entryVoteRowHtml(row);
  assert.match(html, /data-col="total:0" class="num"><span class="vote-total">420<\/span><span class="vote-dam">母優 58<\/span>/);
});

test('entryVoteRowHtml: 未発表回は「—」', () => {
  const html = entryVoteRowHtml(row);
  assert.match(html, /data-col="total:1" class="num">—</);
});

test('entryVoteRowHtml: その回に母優が無ければ母優併記なし', () => {
  const html = entryVoteRowHtml({
    ...row,
    cells: [{ total: 300, damPriority: null }],
  });
  assert.match(html, /data-col="total:0" class="num"><span class="vote-total">300<\/span><\/td>/);
  assert.doesNotMatch(html, /vote-dam/);
});

test('entryVoteRowHtml: 空発表（全 cells が null）でも行は崩れず全セル「—」', () => {
  const html = entryVoteRowHtml({ ...row, cells: [null, null], latestTotal: null });
  assert.match(html, /data-col="total:0" class="num">—</);
  assert.match(html, /data-col="total:1" class="num">—</);
  assert.doesNotMatch(html, /vote-total/);
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
