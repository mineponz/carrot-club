/**
 * サイト全体の定数。
 *
 * SITE_URL は canonical と sitemap.xml の生成に使われる。本番URLと一致していないと
 * Googleに存在しないURLを申告することになるため、変更時は robots.txt も併せて直す。
 * 独自ドメインを設定したらここを差し替える。
 */
export const SITE_URL = 'https://carrot-club.mineponz.workers.dev';

/**
 * 検索エンジンにインデックスさせるか。
 *
 * クラブから「個人利用はOK」の許可を得たため true（本人の判断 / 2026-08-18）。
 * 広告掲載まで許可されたかは不明確なため、広告は別途保留中（Phase3は未着手）。
 *
 * 注意: `noindex` は**クロールされて初めて読まれる**。robots.txt で Disallow すると
 * クローラーがページを読めず noindex に気づけないため、URLだけが検索結果に載りうる。
 * したがって robots.txt はクロール許可のまま維持すること（public/robots.txt のコメント参照）。
 */
export const ALLOW_INDEXING = true;

/** アプリ名。構造化データやフッターなど「名前」として扱う場所で使う */
export const SITE_TITLE = 'キャロットクラブ出資馬検討ツール';

/** 公式と誤認されないよう、タイトル・OGP・タブ表示には必ずこの接頭辞を付ける */
export const UNOFFICIAL_PREFIX = '【非公式】';

/** ブラウザのタブ・検索結果・SNSカードに出す名前 */
export const DOCUMENT_TITLE = `${UNOFFICIAL_PREFIX}${SITE_TITLE}`;

/** 一覧ページ（トップ）の title に付ける説明。検索結果でクリックされるかを左右する */
export const SITE_TAGLINE = '2025年募集馬93頭を血統・馬体・価格で比較';

export const SITE_DESCRIPTION =
  '【非公式】2025年キャロットクラブ募集馬93頭を、父・母父・体高・胸囲・管囲・馬体重・一口価格・厩舎で並べ替え、絞り込みできる出資馬検討ツール。一口馬主が個人で作ったもので、株式会社キャロットクラブとは関係ありません。自分の評価（A〜E・お気に入り・消・メモ）はブラウザに保存され、netkeibaやXの検索へもすぐ飛べます。';

/** 公式との混同を避けるための注記。表示とメタ情報の両方で使う */
export const UNOFFICIAL_NOTICE =
  'このサイトは一口馬主が個人で作った非公式ツールです。株式会社キャロットクラブとは関係がなく、クラブが提供・監修するものではありません。出資の判断は必ずクラブ公式の情報でご確認ください。';
