/**
 * サイト全体の定数。
 *
 * SITE_URL は canonical と sitemap.xml の生成に使われる。本番URLと一致していないと
 * Googleに存在しないURLを申告することになるため、変更時は robots.txt も併せて直す。
 * 独自ドメインを設定したらここを差し替える。
 */
export const SITE_URL = 'https://carrot-club.mineponz.workers.dev';

export const SITE_TITLE = 'キャロットクラブ出資馬検討ツール';

/** 一覧ページ（トップ）の title に付ける説明。検索結果でクリックされるかを左右する */
export const SITE_TAGLINE = '2025年募集馬93頭を血統・馬体・価格で比較';

export const SITE_DESCRIPTION =
  '2025年キャロットクラブ募集馬93頭を、父・母父・体高・胸囲・管囲・馬体重・一口価格・厩舎で並べ替え、絞り込みできる非公式の出資馬検討ツール。自分の評価（A〜E・お気に入り・消・メモ）はブラウザに保存され、netkeibaやXの検索へもすぐ飛べます。';

/** 公式との混同を避けるための注記。表示とメタ情報の両方で使う */
export const UNOFFICIAL_NOTICE =
  'このサイトは一口馬主が個人で作った非公式ツールです。株式会社キャロットクラブとは関係ありません。';
