/**
 * 一覧テーブル1行分のHTMLを組み立てる。
 *
 * **ビルド時（.astroのfrontmatter）とブラウザ側の再描画の両方から呼ぶ。**
 * こうしておかないと、サーバーが返すHTMLに馬のデータが1件も含まれず
 * （＝クローラーには「読み込み中…」しか見えず）検索に載らない。
 * 逆に文字列生成をJS側だけに置くと、並び替え・絞り込みのたびにマークアップが
 * 二重管理になるため、唯一の定義をここに置く。
 *
 * 列の並びは COLUMNS と一致させること（見出しと中身がずれる）。各セルには COLUMNS の
 * `key` を `data-col` として持たせる。見出し（`<th data-col>`）と同じ値なので、
 * `[data-col="sire"]` の1セレクタで見出しと中身をまとめて隠せる（表示する列の切り替え）。
 * 馬名セルには、狭い画面用に No.・父（母父）・厩舎・性を重ねて持たせている
 * （`.sp-no` / `.sp-line`。広い画面ではCSSで隠す）。SPではこの4列を隠して馬名セルに
 * まとめることで、横スクロールしても馬の素性が左端に残る。
 * 評価欄を馬名のすぐ隣に置いているのは、表が画面幅に収まらず、右端に置くと
 * 横スクロールしない限り評価できることに気づけないため。
 */
import type { Horse } from './horses.ts';
import type { Evaluation } from './evaluations.ts';
// メモ欄の上限はサーバー側の検証（parseSubmissionBody）と同じ値を使う。
// 別々に持つと、入力はできるのに同期だけ 400 で失敗する状態になる。
import { MAX_MEMO_LENGTH } from './evaluation-api.ts';
// 抽選ステータス（`src/data/lotteryStatus2026.ts`）は2026年募集にしか情報源が無い年度もある
// データなので `Horse` 型には持たせず、呼び出し側（index.astro）が突き合わせた行を渡す。
// このファイルは `lottery-status-row.ts` に依存する一方向（逆方向のimportは循環参照になるため禁止）。
import { lotteryListCellHtml } from './lottery-status-row.ts';
import type { LotteryStatusRow } from './lottery-status.ts';

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
 *
 * `key` は列を指す**並び順に依存しない名前**。見出しとセルの `data-col` に出し、
 * 「表示する列」の保存（`view-options.ts` の hidden-columns）でも使う。列を入れ替えても
 * 保存済みの設定が別の列に効かないよう、いちど決めた `key` は変えないこと。
 *
 * `spSortKey` は狭い画面（`max-width: 40rem`）でだけ使う代替の並べ替えキー。SPでは No 列を
 * 隠して馬名セルに畳んでいるため、見出しから押せる並べ替えが実質「馬名」だけになる。
 * ラベルは「馬名」のまま、押したときの並び順だけ No（募集番号）にする（本人合意・2026-08-26）。
 */
export const COLUMNS = [
  { key: 'id', label: 'No', sortKey: 'id', align: 'num' },
  { key: 'name', label: '馬名', sortKey: 'name', spSortKey: 'id' },
  { key: 'rating', label: '評価' },
  // メモ列は評価のすぐ隣（左端の固定列の真横）に置く。右端にあったころは、書こうと思うたびに
  // 表を端まで横スクロールする必要があった（本人の指示・2026-08-25）。
  // 既定はセルの中が📝アイコンだけなので、常に出したままでも表の幅をほとんど食わない。
  { key: 'memo', label: 'メモ', cls: 'memo-col' },
  // 抽選ステータス（本人依頼・2026-09-05）。「ホームの左側」という指定＋No・馬名に近い側に
  // 置きたいので、固定3列（No・馬名・評価）とメモのすぐ右、netkeibaより左に置く。
  // 2025年募集には情報源が無いため、その年度の列は常に「—」になる（`horseRowHtml` の
  // 第4引数を省略した場合の挙動。`手術・既往` 列がデータの無い年に空欄で残る扱いと同じ）。
  { key: 'lottery', label: '抽選' },
  { key: 'netkeiba', label: 'netkeiba' },
  { key: 'sire', label: '父', sortKey: 'sire' },
  { key: 'broodmareSire', label: '母父', sortKey: 'broodmareSire' },
  { key: 'sex', label: '性', sortKey: 'sex' },
  { key: 'pricePerShare', label: '一口(万)', sortKey: 'pricePerShare', align: 'num' },
  { key: 'height', label: '体高', sortKey: 'height', align: 'num' },
  { key: 'chestGirth', label: '胸囲', sortKey: 'chestGirth', align: 'num' },
  { key: 'caretGirth', label: '管囲', sortKey: 'caretGirth', align: 'num' },
  { key: 'weight', label: '馬体重', sortKey: 'weight', align: 'num' },
  { key: 'damAge', label: '母齢', sortKey: 'damAge', align: 'num' },
  // 産次は母齢のすぐ右隣に置く（本人希望・2026-08-25）。同じ「母側の属性」として並べて見比べたい。
  { key: 'damParity', label: '産次', sortKey: 'damParity', align: 'num' },
  { key: 'birthDate', label: '誕生日', sortKey: 'birthDate' },
  { key: 'stable', label: '厩舎', sortKey: 'stable' },
  { key: 'sibling', label: '兄弟' },
  { key: 'damPriority', label: '母優' },
  { key: 'surgery', label: '手術・既往' },
  { key: 'xSearch', label: 'X検索' },
  { key: 'dam', label: '母' },
] as const;

/**
 * 「表示する列」の切り替え対象から外す列。
 *
 * - No・馬名・評価: どの馬か見失う／評価を付けられなくなるので常に出す（左端の固定列）。
 * - メモ: 既存の「メモをすべて開く」トグルが別に受け持っている。設定を2か所に分けたくないので
 *   こちらには入れない（保存データの移行も避ける）。
 */
export const ALWAYS_VISIBLE_COLUMN_KEYS: readonly string[] = ['id', 'name', 'rating', 'memo'];

/** 「表示する列」の切り替えに出す列（＝上記以外のすべて）。並びは COLUMNS のまま。 */
export function toggleableColumns(): readonly { key: string; label: string }[] {
  return COLUMNS.filter((col) => !ALWAYS_VISIBLE_COLUMN_KEYS.includes(col.key));
}

/**
 * 個別ページのURL接頭辞の既定（＝最新募集年度）。過去年度は `/2025/horses/` のように呼び出し側が渡す。
 *
 * 個別ページは**年度付きが正本**（`id` が年度内の通し番号なので、年度なしのURLは年度切替で
 * 別の馬を指してしまう）。一覧トップ `/` だけは「最新年度の一覧」という意味が変わらないので
 * 年度なしのまま。**年度を切り替えたらここも変える**（併せて `src/lib/redirects.ts` の
 * 301の向き先と `src/pages/index.astro` が明示的に渡している値も）。
 */
export const DEFAULT_DETAIL_BASE_PATH = '/2026/horses/';

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
 * 年度によって接頭辞が違う（`/2026/horses/` と `/2025/horses/`）ので呼び出し側が渡す。
 */
export function horseDetailHref(horseId: string, detailBasePath = DEFAULT_DETAIL_BASE_PATH): string {
  return `${detailBasePath}${encodeURIComponent(horseId)}/`;
}

/**
 * 狭い画面（SP）で馬名セルの2行目に出す「父（母父）」。
 *
 * SPでは父・母父・性・厩舎の列を隠し、代わりに左端に固定される馬名セルへまとめる。
 * 横スクロールしても馬の素性（血統・厩舎・性）が消えないようにするため。
 * 母父が空の年度・馬では括弧ごと出さない（「（）」だけが残ると壊れて見える）。
 */
export function pedigreeLine(horse: Horse): string {
  return horse.broodmareSire ? `${horse.sire}（${horse.broodmareSire}）` : horse.sire;
}

/**
 * 一覧の厩舎セル用の短い表記。
 *
 * 地方馬は「門別・田中淳司厩舎or大井・渡邉和雄厩舎（外厩）」のようにクラブ側の記載が長く、
 * 表では1セルで2行ぶんの幅を食って他の列を押し出していた。一覧で知りたいのは
 * 「どこの馬か」なので、トラック名（`・`より前）だけを残して「門別or大井」にする。
 * 調教師名まで見たい人向けには個別ページで元の記載をそのまま出している（そちらは変えない）。
 *
 * JRAの厩舎は調教師名だけ（`・` を含まない）なので、その場合は何もせず返す。
 * 年度によって `or` の前後に空白が入る（2025年募集は「 or 」、2026年募集は「or」）ので
 * 空白ごと区切りとして扱う。
 */
export function shortStableLabel(stable: string): string {
  if (!stable.includes('・')) return stable;
  return stable
    .split(/\s*or\s*/)
    .map((part) => part.split('・')[0].trim())
    .join('or');
}

/** 同じく馬名セルの3行目「厩舎・性」。厩舎が空なら性だけにする。 */
export function stableSexLine(horse: Horse): string {
  // SPでは厩舎列を隠してこの行に寄せているので、表の厩舎セルと同じ短い表記を使う
  // （長い地方馬表記のままだと馬名セルの幅で切れて「門別・田中淳…」しか読めない）。
  const stable = shortStableLabel(horse.stable);
  return stable ? `${stable}・${horse.sex}` : horse.sex;
}

export function horseRowHtml(
  horse: Horse,
  evaluation: Evaluation,
  detailBasePath = DEFAULT_DETAIL_BASE_PATH,
  // 抽選ステータスは2026年募集にしか情報源が無いので省略可能にする（省略時はセルが「—」になる。
  // `lottery-status-row.ts` の `lotteryListCellHtml(null)` 参照）。呼び出し側（2026/index.astro）が
  // `lotteryStatusRows()` で突き合わせた行を渡す。
  lotteryRow: LotteryStatusRow | null = null,
): string {
  const ratingOptions = ['', 'A', 'B', 'C', 'D', 'E']
    .map((r) => {
      const selected = (evaluation.rating ?? '') === r ? ' selected' : '';
      return `<option value="${r}"${selected}>${r || '-'}</option>`;
    })
    .join('');

  // 手術欄は複数行になりうる。表では有無だけを◯で示し、中身は title（ホバー）と
  // 個別ページに預ける。以前はここに全文を出していたが、1行に畳んでも長すぎて
  // 表の右側が押し出されていた（本人の指示・2026-08-23）。
  const surgeryText = horse.surgery.replace(/\n/g, ' / ');
  const memo = escapeHtml(evaluation.memo);
  const name = escapeHtml(horse.name);
  const detailHref = escapeHtml(horseDetailHref(horse.id, detailBasePath));
  // 母のnetkeibaページは年度によっては未取得（空文字）。その場合はリンクを出さない。
  const damLink = horse.damUrl
    ? `<a href="${escapeHtml(horse.damUrl)}" target="_blank" rel="noopener">母</a>`
    : '';

  // 各 <td> の先頭に `data-col`（= COLUMNS の key）を置く。見出しの <th data-col> と対で使い、
  // 表示する列の切り替えを `[data-col="..."] { display: none }` の1セレクタで済ませるため。
  // 属性の順番が変わるとテストの正規表現が拾えなくなるので、data-col は必ず先頭に書く。
  return `<tr data-horse-id="${escapeHtml(horse.id)}" data-skip="${evaluation.skip}">
  <td data-col="id" class="num">${escapeHtml(horse.id)}</td>
  <td data-col="name" class="horse-name"><span class="sp-no">${escapeHtml(horse.id)}.</span><a href="${detailHref}">${name}</a><span class="sp-line">${escapeHtml(pedigreeLine(horse))}</span><span class="sp-line">${escapeHtml(stableSexLine(horse))}</span></td>
  <td data-col="rating">
    <div class="eval-cell">
      <select class="rating-select" data-field="rating" data-rating="${evaluation.rating ?? ''}" aria-label="${name}の評価">${ratingOptions}</select>
      <button type="button" class="favorite-btn" data-field="favorite" aria-pressed="${evaluation.favorite}" aria-label="${name}をお気に入りにする" title="お気に入り">★</button>
      <label class="skip-label"><input type="checkbox" class="skip-checkbox" data-field="skip" ${evaluation.skip ? 'checked' : ''} aria-label="${name}を消にする" /> 消</label>
    </div>
  </td>
  <!--
    メモのセルは「アイコン」と「入力欄」を両方持ち、CSSで排他表示する（既定はアイコンだけ、
    is-open が付くと入力欄）。同じセルで入れ替えるので、開いても列が増えたように見えない。
    アイコンはメモが空の馬にも常に出す（＝そこから書き始められる）。入っている馬だけ
    CSSの ::after で通知ドットを付け、中身はホバー（title）で覗ける。
  -->
  <td data-col="memo" class="memo-col"><button type="button" class="memo-flag" data-field="memo-toggle" data-has-memo="${evaluation.memo !== ''}" title="${memo ? `メモ: ${memo}` : ''}" aria-label="${name}のメモを開く">📝</button><input type="text" class="memo-input" data-field="memo" value="${memo}" placeholder="メモ" aria-label="${name}のメモ" maxlength="${MAX_MEMO_LENGTH}" /></td>
  <td data-col="lottery" class="lottery-col">${lotteryListCellHtml(lotteryRow)}</td>
  <td data-col="netkeiba" class="links"><a href="${escapeHtml(horse.netkeibaUrl)}" target="_blank" rel="noopener">netkeiba</a></td>
  <td data-col="sire">${escapeHtml(horse.sire)}</td>
  <td data-col="broodmareSire">${escapeHtml(horse.broodmareSire)}</td>
  <td data-col="sex">${escapeHtml(horse.sex)}</td>
  <td data-col="pricePerShare" class="num">${horse.pricePerShare}</td>
  <td data-col="height" class="num">${horse.height}</td>
  <td data-col="chestGirth" class="num">${horse.chestGirth}</td>
  <td data-col="caretGirth" class="num">${horse.caretGirth}</td>
  <td data-col="weight" class="num">${horse.weight}</td>
  <td data-col="damAge" class="num">${horse.damAge}</td>
  <td data-col="damParity" class="num">${horse.damParity}</td>
  <td data-col="birthDate">${formatBirthDate(horse.birthDate)}</td>
  <td data-col="stable" title="${escapeHtml(horse.stable)}">${escapeHtml(shortStableLabel(horse.stable))}</td>
  <td data-col="sibling" class="sibling" title="${escapeHtml(horse.sibling)}">${escapeHtml(horse.sibling)}</td>
  <td data-col="damPriority" class="dam-priority">${horse.damPriority ? '◯' : ''}</td>
  <td data-col="surgery" class="surgery" title="${escapeHtml(surgeryText)}">${horse.surgery === '' ? '' : '◯'}</td>
  <td data-col="xSearch" class="links"><a href="${escapeHtml(horse.xSearchUrl)}" target="_blank" rel="noopener">X</a></td>
  <td data-col="dam" class="links">${damLink}</td>
</tr>`;
}
