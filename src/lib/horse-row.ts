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

/** 表の列定義。`sortKey` があるものは見出しが並べ替えボタンになる。 */
export const COLUMNS = [
  { label: 'No', sortKey: 'id', align: 'num' },
  { label: '馬名', sortKey: 'name' },
  { label: '評価' },
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
  { label: 'リンク' },
  { label: 'メモ' },
] as const;

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
export function horseRowHtml(horse: Horse, evaluation: Evaluation): string {
  const ratingOptions = ['', 'A', 'B', 'C', 'D', 'E']
    .map((r) => {
      const selected = (evaluation.rating ?? '') === r ? ' selected' : '';
      return `<option value="${r}"${selected}>${r || '-'}</option>`;
    })
    .join('');

  // 手術欄は複数行になりうるが、表のセルでは1行に畳んで表示する
  const surgeryText = horse.surgery.replace(/\n/g, ' / ');
  const name = escapeHtml(horse.name);

  return `<tr data-horse-id="${escapeHtml(horse.id)}" data-skip="${evaluation.skip}">
  <td class="num">${escapeHtml(horse.id)}</td>
  <td class="horse-name">${name}</td>
  <td>
    <div class="eval-cell">
      <select class="rating-select" data-field="rating" data-rating="${evaluation.rating ?? ''}" aria-label="${name}の評価">${ratingOptions}</select>
      <button type="button" class="favorite-btn" data-field="favorite" aria-pressed="${evaluation.favorite}" aria-label="${name}をお気に入りにする" title="お気に入り">★</button>
      <label class="skip-label"><input type="checkbox" class="skip-checkbox" data-field="skip" ${evaluation.skip ? 'checked' : ''} aria-label="${name}を消にする" /> 消</label>
    </div>
  </td>
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
  <td class="links"><a href="${escapeHtml(horse.netkeibaUrl)}" target="_blank" rel="noopener">netkeiba</a> <a href="${escapeHtml(horse.xSearchUrl)}" target="_blank" rel="noopener">X</a></td>
  <td><input type="text" class="memo-input" data-field="memo" value="${escapeHtml(evaluation.memo)}" placeholder="メモ" aria-label="${name}のメモ" /></td>
</tr>`;
}
