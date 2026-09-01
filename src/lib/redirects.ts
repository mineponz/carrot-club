/**
 * 旧URL → 正本URLの301リダイレクト判定（`worker/index.ts` から呼ぶ純関数）。
 *
 * ## このサイトのURL設計（ここが判断の根拠）
 * `horses2026.ts` / `horses2025.ts` の `id` は**年度内の通し番号**でどちらも `1` から始まる。
 * そのため年度なしの `/horses/{id}/` は、募集年度を切り替えた瞬間に93本まとめて別の馬の
 * ページになる＝**URLの意味が変わる**。だから**個別ページは年度付き（`/2026/horses/{id}/`）が正本**。
 * 一方 `/`（一覧トップ）の意味は「このサイトの最新募集年度の一覧」で年をまたいでも変わらないので、
 * **一覧は年度なしが正本**。この非対称は意図的。
 *
 * ## ここで扱う3本
 * 1. `/horses/{id}/`  → `/2026/horses/{id}/` … 旧URL（2026-08-19〜2026-09-01の正本）からの引き継ぎ。
 * 2. `/tour-weight/`  → `/2026/tour-weight/` … 中身が100%2026年募集馬で年度切替の仕組みが無いため、
 *    個別ページと同じ扱いにした（本人承認 / 2026-09-01）。
 * 3. `/2026/`         → `/` … `/2026/` は**最新年度への別名**で、実体は `/` と同じもの。
 *    過去年度（`/2025/`）と同じ形で辿ってきた人を落とさないために受ける。
 *
 * ## 来年（2027年募集）の切替でやること
 * **この3本の向き先を2027に変えるだけ**。すなわち `CURRENT_YEAR_PREFIX` を `/2027/` にし、
 * 今の `/2026/` は別名ではなく実ページ（過去年度一覧）へ昇格させる。
 * **301そのものは恒久的に残す**（消すと `/horses/{id}/` 等に付いた被リンク・検索インデックスが切れる）。
 *
 * リダイレクト先は必ず末尾スラッシュ付きにする（astro.config.mjs の `trailingSlash: 'always'`）。
 * また**チェーンを作らない**こと（1ホップで正本に着く）。`/2026/horses/...` は当然対象外。
 */

/** 現在の最新募集年度の接頭辞。年度切替ではここだけを変える（`src/lib/horse-row.ts` の既定値と対）。 */
const CURRENT_YEAR_PREFIX = '/2026/';

/** 年度なしの旧・個別ページ接頭辞。恒久的に301で受け続ける。 */
const LEGACY_DETAIL_PREFIX = '/horses/';

/** 年度なしの旧・ツアー後馬体重ページ。恒久的に301で受け続ける。 */
const LEGACY_TOUR_WEIGHT_PATH = '/tour-weight/';

/**
 * 末尾スラッシュ無し（`/horses/1`）と `index.html` 付き（`/horses/1/index.html`）を、
 * 判定の前に「末尾スラッシュ付き」の形へ寄せる。
 */
function normalizePath(pathname: string): string {
  let path = pathname;
  if (path.endsWith('/index.html')) path = path.slice(0, -'index.html'.length);
  if (!path.endsWith('/')) path += '/';
  return path;
}

/**
 * `pathname` に対する301の転送先を返す。リダイレクト不要なら `null`。
 *
 * クエリ文字列は呼び出し側（worker）が引き継ぐので、ここではパスだけを見る。
 */
export function redirectTarget(pathname: string): string | null {
  const path = normalizePath(pathname);

  // `/2026/` は最新年度への別名なので一覧トップへ。`/2026/horses/1/` は正本なので対象外
  // （`===` で見ているため前方一致で巻き込むことはない）。
  if (path === CURRENT_YEAR_PREFIX) return '/';

  // 年度なしのツアー後馬体重ページ。`/2026/tour-weight/` は正本なので当然対象外。
  if (path === LEGACY_TOUR_WEIGHT_PATH) return `${CURRENT_YEAR_PREFIX}tour-weight/`;

  if (path.startsWith(LEGACY_DETAIL_PREFIX)) {
    // `/horses/` と `/horses/{id}/` の間の1セグメントだけを個別ページとして扱う。
    // `id` の形（数字かどうか）は前提にしない代わりに、**さらにスラッシュを含むパス**
    // （`/horses/1/foo/`）は個別ページではないのでリダイレクトしない＝404のままにする。
    const id = path.slice(LEGACY_DETAIL_PREFIX.length, -1);
    if (id === '' || id.includes('/')) return null;
    return `${CURRENT_YEAR_PREFIX}horses/${id}/`;
  }

  return null;
}
