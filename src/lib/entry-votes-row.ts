/**
 * 「募集申込票数（中間発表）」ページ（`/2026/votes/`）の表1行分のHTML。
 *
 * `tour-weight-row.ts` と同じく、ビルド時（.astro の frontmatter）とブラウザ側の
 * 並べ替え後の再描画の両方から呼ぶ。行のマークアップをここに一本化しないと
 * 初期HTMLと並べ替え後の表がずれる。
 *
 * 列は No・馬名・父・牡牝 ＋ 中間発表の各回。各回は「最優先」「総票数」の2列に分かれる
 * （母優先より最優先を重視する指標として先に出す。母優先の数字は個別ページの facts にだけ出す）。
 * 回数は固定ではないので、列定義は `entryVoteColumns(snapshots)` でスナップショット配列から
 * 動的に組み立てる。見出しは2段（1段目に回のラベルをcolspan=2でまたがせ、2段目に最優先・総票数）。
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

/** 1回ぶんの列グループ（見出し1段目の colspan=2 ラベル＋2段目の最優先・総票数列）。 */
export interface EntryVoteRoundColumns {
  /** 見出し1段目のラベル（例 '9/3'） */
  asOf: string;
  columns: readonly [EntryVoteColumn, EntryVoteColumn];
}

export interface EntryVoteColumns {
  /** No・馬名・父・牡牝。見出し1段目に rowspan=2 で出す固定列 */
  fixed: readonly EntryVoteColumn[];
  /** 回ごとの列グループ */
  rounds: readonly EntryVoteRoundColumns[];
}

/**
 * スナップショット配列から列定義を組み立てる。
 * 固定列（No・馬名・父・牡牝）は見出し1段目に rowspan=2 で出す。
 * 各回は見出し1段目に asOf（例 '9/3'）を colspan=2 で、2段目に「最優先」「総票数」を出す
 * （最優先を先に置き、母優先より重視する指標であることを列の並びでも示す）。
 * SP では No・父・牡牝 列を隠すため、馬名見出しからは `spSortKey='id'` で募集番号順に並べる
 * （最優先・総票数は SP でも列のまま残るので、そのまま自分自身のキーで並べ替えられる）。
 */
export function entryVoteColumns(snapshots: readonly EntryVoteSnapshot[]): EntryVoteColumns {
  const fixed: EntryVoteColumn[] = [
    { key: 'id', label: 'No', sortKey: 'id', align: 'num' },
    { key: 'name', label: '馬名', sortKey: 'name', spSortKey: 'id' },
    { key: 'sire', label: '父', sortKey: 'sire' },
    { key: 'sex', label: '牡牝', sortKey: 'sex' },
  ];
  const rounds: EntryVoteRoundColumns[] = snapshots.map((snap, i) => ({
    asOf: snap.asOf,
    columns: [
      { key: `top:${i}`, label: '最優先', sortKey: `top:${i}` as EntryVoteSortKey, align: 'num' as const },
      { key: `total:${i}`, label: '総票数', sortKey: `total:${i}` as EntryVoteSortKey, align: 'num' as const },
    ],
  }));
  return { fixed, rounds };
}

/** 最優先セルの中身。未発表・数字が無ければ「—」。 */
function topPriorityCellHtml(cell: EntryVoteRow['cells'][number]): string {
  if (cell === null || cell.topPriority === null) return '—';
  return `${cell.topPriority}`;
}

/** 総票数セルの中身。未発表なら「—」。 */
function totalCellHtml(cell: EntryVoteRow['cells'][number]): string {
  if (cell === null) return '—';
  return `${cell.total}`;
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
    .map(
      (cell, i) =>
        `  <td data-col="top:${i}" class="num">${topPriorityCellHtml(cell)}</td>\n  <td data-col="total:${i}" class="num">${totalCellHtml(cell)}</td>`,
    )
    .join('\n');

  return `<tr data-horse-id="${id}">
  <td data-col="id" class="num">${id}</td>
  <td data-col="name" class="horse-name"><span class="sp-no">${id}.</span><a href="${href}">${name}</a><span class="sp-line">${sire}（${sex}）</span></td>
  <td data-col="sire">${sire}</td>
  <td data-col="sex">${sex}</td>
${roundCells}
</tr>`;
}
