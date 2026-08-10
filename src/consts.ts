/**
 * サイト全体の定数。
 *
 * SITE_URL は canonical と sitemap.xml の生成に使われる。本番URLと一致していないと
 * Googleに存在しないURLを申告することになるため、変更時は robots.txt も併せて直す。
 * 独自ドメインを設定したらここを差し替える。
 */
export const SITE_URL = 'https://carrot-club.mineponz.workers.dev';
export const SITE_TITLE = 'carrot-club';
export const SITE_DESCRIPTION =
  '一口馬主クラブの募集馬をソート・フィルタで見比べ、自分の評価をブラウザに保存できる選定支援ツール。';
