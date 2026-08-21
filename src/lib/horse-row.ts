/**
 * 一覧テーブル1行分のHTMLを組み立てる。
 *
 * **ビルド時（.astroのfrontmatter）とブラウザ側の再描画の両方から呼ぶ。**
 * こうしておかないと、サーバーが返すHTMLに馬のデータが1件も含まれず
 * （＝クローラーには「読み込み中…」しか見えず）検索に載らない。
 * 逆に文字列生成をJS側だけに置くと、並び替え・絞り込みのたびにマークアップが
 * 二重管理になるため、唯一の定義をここに置く。
 *
 * 列の並びは COLUMNS と一致させること（見出しと中身がずれる）。
 * 評価欄を馬名のすぐ隣に置いているのは、表が画面幅に収まらず、右端に置くと
 * 横スクロールしない限り評価できることに気づけないため。
 */
import type { Horse } from './horses.ts';
import type { Evaluation } from './evaluations.ts';
// メモ欄の上限はサーバー側の検証（parseSubmissionBody）と同じ値を使う。
// 別々に持つと、入力はできるのに同期だけ 400 で失敗する状態になる。
import { MAX_MEMO_LENGTH } from './evaluation-api.ts';

/**
 * 表の列定義。`sortKey` があるものは見出しが並べ替えボタンになる。
 *
 * 並びは本人の使い方に合わせている（2026-08-19）:
 * - No・馬名・評価は左端で固定表示（横スクロールしてもどの馬か見失わない）
 * - netkeibaは血統より**左**（馬を見に行く動線が最優先で、スクロールせず押せる位置に置く）
 * - X検索と母のnetkeibaは右端（調べ物として後から使う）
 *
 * 左端の固定列は3列のまま増やさない（狭い画面で固定列が表示領域を食い潰すため。
 * index.astro の nth-child(1〜3) のCSSと対応）。
 */
export const COLUMNS = [
  { label: 'No', sortKey: 'id', align: 'num' },
  { label: '馬名', sortKey: 'name' },
  { label: '評価' },
  { label: 'netkeiba' },
  { label: '父', sortKey: 'sire' },
  { label: '母父', sortKey: 'broodmareSire' },
  { label: '性', sortKey: 'sex' },
  { label: '一口', sortKey: 'pricePerShare', align: 'num' },
  { label: '体高', sortKey: 'height', align: 'num' },
  { label: '胸囲', sortKey: 'chestGirth', align: 'num' },
  { label: '管囲', sortKey: 'caretGirth', align: 'num' },
  { label: '馬体重', sortKey: 'weight', align: 'num' },
  { label: '母齢', sortKey: 'damAge', align: 'num' },
  { label: '誕生日', sortKey: 'birthDate' },
  { label: '厩舎', sortKey: 'stable' },
  { label: '兄弟' },
  { label: '母優' },
  { label: '手術・既往' },
  { label: 'メモ' },
  { label: 'X検索' },
  { label: '母' },
] as const;

/** 個別ページのURL接頭辞の既定（最新年度＝ルート）。過去年度は `/2025/horses/` を渡す。 */
export const DEFAULT_DETAIL_BASE_PATH = '/horses/';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 誕生日 (2024-05-02) を一覧向けの短い表記 (05/02) にする。 */
export function formatBirthDate(isoDate: string): string {
  return isoDate.slice(5).replace('-', '/');
}

/**
 * 評価セレクトの背景色はCSSの `[data-rating='A']` 等で当てる（スプレッドシートの条件付き書式に近い見え方）。
 * `selected` 属性だけだとCSSから選択値を参照できないため、値そのものを属性に持たせている。
 * ブラウザ側で値が変わったときは、この属性も更新しないと色が追随しない（各ページのchangeハンドラ参照）。
 */
/**
 * 個別ページのURL。`trailingSlash: 'always'` なので末尾スラッシュを必ず付ける。
 * 年度によって接頭辞が違う（`/horses/` と `/2025/horses/`）ので呼び出し側が渡す。
 */
export function horseDetailHref(horseId: string, detailBasePath = DEFAULT_DETAIL_BASE_PATH): string {
  return `${detailBasePath}${encodeURIComponent(horseId)}/`;
}

export function horseRowHtml(
  horse: Horse,
  evaluation: Evaluation,
  detailBasePath = DEFAULT_DETAIL_BASE_PATH,
): string {
  const ratingOptions = ['', 'A', 'B', 'C', 'D', 'E']
    .map((r) => {
      const selected = (evaluation.rating ?? '') === r ? ' selected' : '';
      return `<option value="${r}"${selected}>${r || '-'}</option>`;
    })
    .join('');

  // 手術欄は複数行になりうるが、表のセルでは1行に畳んで表示する
  const surgeryText = horse.surgery.replace(/\n/g, ' / ');
  const name = escapeHtml(horse.name);
  const detailHref = escapeHtml(horseDetailHref(horse.id, detailBasePath));
  // 母のnetkeibaページは年度によっては未取得（空文字）。その場合はリンクを出さない。
  const damLink = horse.damUrl
    ? `<a href="${escapeHtml(horse.damUrl)}" target="_blank" rel="noopener">母</a>`
    : '';

  return `<tr data-horse-id="${escapeHtml(horse.id)}" data-skip="${evaluation.skip}">
  <td class="num">${escapeHtml(horse.id)}</td>
  <td class="horse-name"><a href="${detailHref}">${name}</a></td>
  <td>
    <div class="eval-cell">
      <select class="rating-select" data-field="rating" data-rating="${evaluation.rating ?? ''}" aria-label="${name}の評価">${ratingOptions}</select>
      <button type="button" class="favorite-btn" data-field="favorite" aria-pressed="${evaluation.favorite}" aria-label="${name}をお気に入りにする" title="お気に入り">★</button>
      <label class="skip-label"><input type="checkbox" class="skip-checkbox" data-field="skip" ${evaluation.skip ? 'checked' : ''} aria-label="${name}を消にする" /> 消</label>
    </div>
  </td>
  <td class="links"><a href="${escapeHtml(horse.netkeibaUrl)}" target="_blank" rel="noopener">netkeiba</a></td>
  <td>${escapeHtml(horse.sire)}</td>
  <td>${escapeHtml(horse.broodmareSire)}</td>
  <td>${escapeHtml(horse.sex)}</td>
  <td class="num">${horse.pricePerShare}</td>
  <td class="num">${horse.height}</td>
  <td class="num">${horse.chestGirth}</td>
  <td class="num">${horse.caretGirth}</td>
  <td class="num">${horse.weight}</td>
  <td class="num">${horse.damAge}</td>
  <td>${formatBirthDate(horse.birthDate)}</td>
  <td>${escapeHtml(horse.stable)}</td>
  <td class="sibling" title="${escapeHtml(horse.sibling)}">${escapeHtml(horse.sibling)}</td>
  <td class="dam-priority">${horse.damPriority ? '◯' : ''}</td>
  <td class="surgery" title="${escapeHtml(surgeryText)}">${escapeHtml(surgeryText)}</td>
  <td><input type="text" class="memo-input" data-field="memo" value="${escapeHtml(evaluation.memo)}" placeholder="メモ" aria-label="${name}のメモ" maxlength="${MAX_MEMO_LENGTH}" /></td>
  <td class="links"><a href="${escapeHtml(horse.xSearchUrl)}" target="_blank" rel="noopener">X</a></td>
  <td class="links">${damLink}</td>
</tr>`;
}
