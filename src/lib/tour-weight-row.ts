/**
 * ツアー後馬体重ページ（`/tour-weight/`）の表1行分のHTML。
 *
 * ビルド時（.astroのfrontmatter）とブラウザ側の並べ替え後の再描画の両方から呼ぶ。
 * `horse-row.ts`（一覧ページ本体）と同じ理由で、行のマークアップをここに一本化する
 * （二重管理にすると初期HTMLと並べ替え後の表がずれる）。
 *
 * 列は No・馬名・父・性・募集時馬体重・ツアー後馬体重・増減の7つ。狭い画面
 * （`max-width: 40rem`）では一覧ページと同じ考え方で No・父・性の3列を隠し、
 * 馬名セルに `.sp-no` / `.sp-line` として畳む。残る4列（馬名・募集時・ツアー後・増減）
 * だけならSP幅でも横スクロール無しで並ぶので、馬体重の比較がその場で見える。
 */
import type { TourWeightRow, TourWeightSortKey } from './tour-weight.ts';
import { DEFAULT_DETAIL_BASE_PATH, escapeHtml, horseDetailHref } from './horse-row.ts';

/**
 * `spSortKey` は狭い画面でだけ使う代替の並べ替えキー（一覧ページと同じ仕組み）。
 * SPでは No 列を隠して馬名セルに畳んでいるため、馬名見出しから押せる並べ替えを
 * No（募集番号）に差し替える。
 */
export const TOUR_WEIGHT_COLUMNS: readonly {
  key: string;
  label: string;
  sortKey: TourWeightSortKey;
  spSortKey?: TourWeightSortKey;
  align?: 'num';
}[] = [
  { key: 'id', label: 'No', sortKey: 'id', align: 'num' },
  { key: 'name', label: '馬名', sortKey: 'name', spSortKey: 'id' },
  { key: 'sire', label: '父', sortKey: 'sire' },
  { key: 'sex', label: '性', sortKey: 'sex' },
  { key: 'weight', label: '募集時', sortKey: 'weight', align: 'num' },
  { key: 'tourWeight', label: 'ツアー後', sortKey: 'tourWeight', align: 'num' },
  { key: 'diff', label: '増減', sortKey: 'diff', align: 'num' },
];

/** 増減の表示（+10 / -8 / 0）。プラスは符号を明示し、マイナスは数値自体の符号のまま出す。 */
export function formatDiff(diff: number): string {
  return diff > 0 ? `+${diff}` : `${diff}`;
}

/** 増減セルの色分け用クラス（プラス/マイナス/変化なし）。未計測（null）は付けない。 */
export function diffClass(diff: number | null): string {
  if (diff === null) return '';
  if (diff > 0) return 'diff-up';
  if (diff < 0) return 'diff-down';
  return '';
}

export function tourWeightRowHtml(
  row: TourWeightRow,
  detailBasePath = DEFAULT_DETAIL_BASE_PATH,
): string {
  const name = escapeHtml(row.name);
  const href = escapeHtml(horseDetailHref(row.id, detailBasePath));
  const tourWeightText = row.tourWeight === null ? '未計測' : String(row.tourWeight);
  const diffText = row.diff === null ? '−' : formatDiff(row.diff);

  return `<tr data-horse-id="${escapeHtml(row.id)}">
  <td data-col="id" class="num">${escapeHtml(row.id)}</td>
  <td data-col="name" class="horse-name"><span class="sp-no">${escapeHtml(row.id)}.</span><a href="${href}">${name}</a><span class="sp-line">${escapeHtml(row.sire)}（${escapeHtml(row.sex)}）</span></td>
  <td data-col="sire">${escapeHtml(row.sire)}</td>
  <td data-col="sex">${escapeHtml(row.sex)}</td>
  <td data-col="weight" class="num">${row.weight}</td>
  <td data-col="tourWeight" class="num">${tourWeightText}</td>
  <td data-col="diff" class="num ${diffClass(row.diff)}">${diffText}</td>
</tr>`;
}
