/**
 * 抽選ステータスのHTML組み立て（一覧の「抽選」列セル・特設ページの行）。
 *
 * `lottery-status.ts`（ロジック）と分けてあるのは `tour-weight.ts`/`tour-weight-row.ts` と同じ理由
 * （ロジックとマークアップを分離し、両方とも `node --test` で検証できるようにするため）。
 *
 * **注意（依存の向き）**: `horse-row.ts` がこのファイルの `lotteryListCellHtml()` を一覧の
 * 「抽選」列セルとして呼ぶため、このファイルは `horse-row.ts` を import しない
 * （import すると循環参照になる）。`escapeHtml`・個別ページへのリンク組み立てはこのファイル内に
 * 小さく複製している。
 */
import type { FrameLotteryResult } from '../data/lotteryStatus2026.ts';
import { lotteryLabel, type LotteryStatusRow, type LotteryStatusSortKey } from './lottery-status.ts';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 特設ページの個別ページリンクの既定接頭辞（`horse-row.ts` の `DEFAULT_DETAIL_BASE_PATH` と同じ値）。 */
const DEFAULT_DETAIL_BASE_PATH = '/2026/horses/';

function horseDetailHref(horseId: string, detailBasePath = DEFAULT_DETAIL_BASE_PATH): string {
  return `${detailBasePath}${encodeURIComponent(horseId)}/`;
}

/**
 * 結果が確定している枠をバッジHTMLに、「発表待ち」（rank:'mid'）はバッジにせず地の文で返す。
 * クラスは `rank-${ランク}`（濃淡はCSS側。×2が最も濃い）＋ `occurred`（抽選発生・塗りつぶし）
 * か `secured`（一般枠で確保・枠線のみ。最優先ランクにはこの状態は無い＝型上 outcome が
 * `{ rank: 'general', lotteryOccurred: false }` の場合しか secured にならない）のどちらか。
 */
function frameHtml(frame: FrameLotteryResult): string {
  const label = lotteryLabel(frame);
  if (label.rank === 'mid' || frame.outcome === null) return label.text;
  const occurredClass = frame.outcome.lotteryOccurred ? 'occurred' : 'secured';
  return `<span class="lottery-badge rank-${label.rank} ${occurredClass}">${escapeHtml(label.text)}</span>`;
}

/** 通常枠セルの中身。未発表（このsnapshotにまだ載っていない）なら「発表待ち」。 */
function normalCellHtml(row: LotteryStatusRow): string {
  return row.normal === null ? '発表待ち' : frameHtml(row.normal);
}

/** 母馬優先枠セルの中身。対象外の馬は「—」、対象だが未発表は「発表待ち」。 */
function damPriorityCellHtml(row: LotteryStatusRow): string {
  if (!row.hasDamPriority) return '—';
  return row.damPriority === null ? '発表待ち' : frameHtml(row.damPriority);
}

/** 残り口数セルの中身。未確定は「—」。 */
function remainingSharesCellHtml(row: LotteryStatusRow): string {
  return row.remainingShares === null ? '—' : `${row.remainingShares}口`;
}

/**
 * 一覧テーブル「抽選」列の中身（`<td>` の中身だけ。`<td>` 自体は `horse-row.ts` 側が出す）。
 *
 * - `row` が `null`（＝その年度に抽選ステータスの情報源が無い。2025年募集など）→ 「—」。
 * - 母馬優先対象馬は「母優先」「通常」の2行、対象外は通常枠のバッジ1行だけ。
 */
export function lotteryListCellHtml(row: LotteryStatusRow | null): string {
  if (row === null) return '—';
  if (row.hasDamPriority) {
    return (
      `<span class="lottery-line"><span class="lottery-line-label">母優先:</span> ${damPriorityCellHtml(row)}</span>` +
      `<span class="lottery-line"><span class="lottery-line-label">通常:</span> ${normalCellHtml(row)}</span>`
    );
  }
  return normalCellHtml(row);
}

/** 特設ページ（`/2026/lottery/`）の列定義。 */
export const LOTTERY_STATUS_COLUMNS: readonly {
  key: string;
  label: string;
  sortKey: LotteryStatusSortKey;
  spSortKey?: LotteryStatusSortKey;
  align?: 'num';
}[] = [
  { key: 'id', label: 'No', sortKey: 'id', align: 'num' },
  { key: 'name', label: '馬名', sortKey: 'name', spSortKey: 'id' },
  { key: 'sire', label: '父', sortKey: 'sire' },
  { key: 'sex', label: '牡牝', sortKey: 'sex' },
  { key: 'damPriority', label: '母馬優先枠', sortKey: 'damPriority' },
  { key: 'normal', label: '通常枠', sortKey: 'normal' },
  { key: 'remainingShares', label: '残り口数', sortKey: 'remainingShares', align: 'num' },
];

export function lotteryStatusRowHtml(
  row: LotteryStatusRow,
  detailBasePath = DEFAULT_DETAIL_BASE_PATH,
): string {
  const name = escapeHtml(row.name);
  const href = escapeHtml(horseDetailHref(row.id, detailBasePath));
  const id = escapeHtml(row.id);
  const sire = escapeHtml(row.sire);
  const sex = escapeHtml(row.sex);

  return `<tr data-horse-id="${id}">
  <td data-col="id" class="num">${id}</td>
  <td data-col="name" class="horse-name"><span class="sp-no">${id}.</span><a href="${href}">${name}</a><span class="sp-line">${sire}（${sex}）</span></td>
  <td data-col="sire">${sire}</td>
  <td data-col="sex">${sex}</td>
  <td data-col="damPriority">${damPriorityCellHtml(row)}</td>
  <td data-col="normal">${normalCellHtml(row)}</td>
  <td data-col="remainingShares" class="num">${remainingSharesCellHtml(row)}</td>
</tr>`;
}
