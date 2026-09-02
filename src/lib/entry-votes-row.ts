/**
 * 「募集申込票数（中間発表）」ページ（`/2026/votes/`）の表1行分のHTML。
 *
 * `tour-weight-row.ts` と同じく、ビルド時（.astro の frontmatter）とブラウザ側の
 * 並べ替え後の再描画の両方から呼ぶ。行のマークアップをここに一本化しないと
 * 初期HTMLと並べ替え後の表がずれる。
 *
 * 列は No・馬名・父・牡牝 ＋ 中間発表の各回。回数は固定ではないので、列定義は
 * `entryVoteColumns(snapshots)` でスナップショット配列から動的に組み立てる。
 * 狭い画面（SP）では No・父・牡牝 を隠し、馬名セルに `.sp-no` / `.sp-line`（父（性））として
 * 畳む（`tour-weight-row.ts` と同じ考え方）。
 */
import type { EntryVoteRow, EntryVoteSortKey } from './entry-votes.ts';
import type { EntryVoteSnapshot } from '../data/entryVotes2026.ts';
import { DEFAULT_DETAIL_BASE_PATH, escapeHtml, horseDetailHref } from './horse-row.ts';

export interface EntryVoteColumn {
  key: string;
  label: string;
  sortKey: EntryVoteSortKey;
  /** 狭い画面でだけ使う代替の並べ替えキー（`tour-weight-row.ts` と同じ仕組み） */
  spSortKey?: EntryVoteSortKey;
  align?: 'num';
}

/**
 * スナップショット配列から列定義を組み立てる。
 * 固定列（No・馬名・父・牡牝）のあとに、各回の全体票数列を `total:${i}` として並べる。
 * SP では No・父 列を隠すため、馬名・各回の見出しからは `spSortKey='id'` で募集番号順に並べる。
 */
export function entryVoteColumns(
  snapshots: readonly EntryVoteSnapshot[],
): readonly EntryVoteColumn[] {
  const fixed: EntryVoteColumn[] = [
    { key: 'id', label: 'No', sortKey: 'id', align: 'num' },
    { key: 'name', label: '馬名', sortKey: 'name', spSortKey: 'id' },
    { key: 'sire', label: '父', sortKey: 'sire' },
    { key: 'sex', label: '牡牝', sortKey: 'sex' },
  ];
  const rounds: EntryVoteColumn[] = snapshots.map((snap, i) => ({
    key: `total:${i}`,
    label: `${snap.asOf} 票数`,
    sortKey: `total:${i}` as EntryVoteSortKey,
    spSortKey: 'id' as EntryVoteSortKey,
    align: 'num' as const,
  }));
  return [...fixed, ...rounds];
}

/** 1回ぶんのセルの中身。未発表は「—」、母優の数字が無ければ母優併記なし。 */
function voteCellHtml(cell: EntryVoteRow['cells'][number]): string {
  if (cell === null) return '—';
  const total = `<span class="vote-total">${cell.total}</span>`;
  const dam =
    cell.damPriority === null
      ? ''
      : `<span class="vote-dam">母優 ${cell.damPriority}</span>`;
  return `${total}${dam}`;
}

export function entryVoteRowHtml(
  row: EntryVoteRow,
  detailBasePath = DEFAULT_DETAIL_BASE_PATH,
): string {
  const name = escapeHtml(row.name);
  const href = escapeHtml(horseDetailHref(row.id, detailBasePath));
  const id = escapeHtml(row.id);
  const sire = escapeHtml(row.sire);
  const sex = escapeHtml(row.sex);

  const roundCells = row.cells
    .map((cell, i) => `  <td data-col="total:${i}" class="num">${voteCellHtml(cell)}</td>`)
    .join('\n');

  return `<tr data-horse-id="${id}">
  <td data-col="id" class="num">${id}</td>
  <td data-col="name" class="horse-name"><span class="sp-no">${id}.</span><a href="${href}">${name}</a><span class="sp-line">${sire}（${sex}）</span></td>
  <td data-col="sire">${sire}</td>
  <td data-col="sex">${sex}</td>
${roundCells}
</tr>`;
}
