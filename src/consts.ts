/**
 * サイト全体の定数。
 *
 * SITE_URL は canonical と sitemap.xml の生成に使われる。本番URLと一致していないと
 * Googleに存在しないURLを申告することになるため、変更時は robots.txt も併せて直す。
 * 独自ドメインを設定したらここを差し替える。
 */
export const SITE_URL = 'https://carrot.mineponz.com';

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

/**
 * サイト全体では index するが、この接頭辞に一致するページだけは `noindex` にする。
 *
 * 対象は「よそのデータを転記して並べただけ」のページ（馬個別ページ・ツアー後馬体重・
 * 募集申込票数・抽選ステータス一覧・旧年度の募集馬一覧）。Google AdSense
 * の審査で不合格（初回2026-09-02、再審査2026-09-12・2026-09-23、いずれも同じ主旨の
 * 「有用性の低いコンテンツ」/ [[20260823-mineponz-domain-migration-and-adsense]]）。
 * 薄いテンプレページが、自分で書いた記事（十数本）を数で押し流してサイト全体の評価を
 * 下げているのが主因と見ている。9/2の是正後に追加した `/2026/lottery/`（抽選ランク発表の
 * 手入力転記）と `/my-horses/<slug>/`（出資馬9頭の成績・馬体重推移・クラブ写真の転載が
 * 中心）には9/2時点の判定が及んでいなかったため、2026-09-12に追加。`/2025/`（旧年度の
 * 募集馬一覧本体。中身は転記データの表が大半）には9/12時点の判定が及んでいなかったため
 * 2026-09-23に追加（`/2025/horses/` を包含するので個別の接頭辞は削除。配下は
 * `/2025/horses/[id]` と `/2025/index` のみで、index化すべき自作ページは無いことを確認済み）。
 * 出資馬個別ページ（`/my-horses/<slug>/`）も9/12から noindex にしていたが、2026-10-21に
 * サイト独自の分析節（「データで見る○○」）を足して index に戻した。
 * 審査botに見せる面を〈ツール＋記事＋about＋ポリシー〉へ絞るための措置で、
 * **クラブの転載許可の話とは別問題**。
 *
 * これは元に戻せる。AdSense通過後にロングテール検索を取りにいくなら
 * この配列を空にするだけでよい（ページ自体は消していない）。
 * 外す前に、サイトの分析記事の知見をその馬に当てはめた節のような「独自の中身」を足すこと
 * （出資馬個別ページはそうして戻した）。
 *
 * BaseLayout の robots メタと astro.config.mjs の sitemap フィルタの両方がこの関数を見る。
 * 2か所に別々の正規表現を書くと片方だけ直し忘れるため、判定はここに一本化する。
 */
export const NOINDEX_PATH_PREFIXES = [
  '/2025/',
  '/2026/horses/',
  '/2026/tour-weight/',
  '/2026/votes/',
  // 追加募集の2頭は測尺（2歳春）・母の産駒表が無く、独自の分析節が出せないため（2026-10-21）
  '/my-horses/diogenite/',
  '/my-horses/eir/',
];

export function isNoindexPath(pathname: string): boolean {
  return NOINDEX_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

/** アプリ名。構造化データやフッターなど「名前」として扱う場所で使う */
export const SITE_TITLE = 'キャロットクラブ出資馬検討ツール';

/**
 * 今どの募集回か。「残口あり/全頭」切替の既定値と、画面に出す募集回の名前を1か所で決める
 * （2026-09-10に `OfferingPhase = 'primary' | 'secondary'` として導入し、2026-09-16に
 * 募集回そのものを値にする形へ変更した）。
 *
 * **`'secondary'` という名前をやめた理由**: クラブの「1.5次募集」を `secondary` と呼んでいた
 * ところへ本物の「第2次募集」が来て、同じ語が二つの回を指すようになったため。募集回を
 * そのまま値にすれば衝突しないし、次に増える回も足すだけで済む。
 *
 * **募集が全部終わったら `'closed'` にする**（2026-10-10・第2次募集の15頭が全頭満口になった
 * 回で追加）。`'1'` に戻すのではない ―― `'1'` は「1次募集の結果が出た直後で、残口のある馬に
 * まだ出資できる」状態を指すので、通常枠の「残口あり」バッジが出たままになる。
 * `'closed'` にすると:
 * - `IS_ADDITIONAL_OFFERING` が false になり、`src/lib/remaining-shares.ts` の
 *   `liveSnapshotsForDisplay` を通した表示（トップの切替・「残口」列・絞り込み・FAQ・
 *   個別ページのバッジ・`/2026/lottery/` の残り口数）が「無し」へ倒れる。
 * - `IS_OFFERING_CLOSED` が true になり、通常枠で抽選にならなかった馬のバッジが
 *   「残口あり」から「抽選なし」に変わる（`src/lib/lottery-status.ts` の `lotteryLabel`）。
 *
 * **データ（`lotteryStatus2026.ts` の `remainingShares`）は書き換えない。** クラブ発表の
 * 記録としてそのまま残す（公開済みの記事 `secondary-offering.astro` / `second-offering.astro`
 * がその時点の対象馬を読んでいる）。残口列・切替・バッジのコード自体も消さない（来年また使う）。
 * 翌年度の1次募集の結果を入れるときに `'1'` へ戻す。
 */
export type OfferingRound = '1' | '1.5' | '2' | 'closed';
export const OFFERING_ROUND: OfferingRound = 'closed';

/**
 * 募集回→画面に出す名前。**ユーザーに見える募集回の名前はここだけから出す**
 * （`LOTTERY_RANK_LABELS` と同じ流儀。各ページに「1.5次募集」と直書きすると
 * 切替のたびに書き換え漏れが出る）。
 */
export const OFFERING_ROUND_LABELS: Readonly<Record<OfferingRound, string>> = {
  '1': '1次募集',
  '1.5': '1.5次募集',
  '2': '第2次募集',
  closed: '募集終了',
};

/** 今の募集回の名前（例 '第2次募集'）。 */
export const OFFERING_ROUND_LABEL = OFFERING_ROUND_LABELS[OFFERING_ROUND];

/**
 * 1次募集の後の追加募集（1.5次・第2次…）の回か。
 * 定数を直に比べるとTypeScriptが今の値のリテラル型に絞ってしまい「重ならない比較」の
 * エラーになるので、引数で受ける関数にしてある。
 */
export function isAdditionalOfferingRound(round: OfferingRound): boolean {
  return round !== '1' && round !== 'closed';
}

/** その年度の募集が全部終わった（全頭満口）か。引数で受ける理由は上と同じ。 */
export function isOfferingClosedRound(round: OfferingRound): boolean {
  return round === 'closed';
}

/**
 * 募集が全部終わったか。通常枠の「残口あり」バッジを出すかどうかはこれで判定する
 * （終わったあとも「残口あり」と出ていると、まだ出資できるように読めるため）。
 */
export const IS_OFFERING_CLOSED: boolean = isOfferingClosedRound(OFFERING_ROUND);

/**
 * 追加募集の期間中か。
 * 「残口のある馬を主役にする」表示の出し分けはすべてこれで判定する。
 */
export const IS_ADDITIONAL_OFFERING: boolean = isAdditionalOfferingRound(OFFERING_ROUND);

/** 公式と誤認されないよう、タイトル・OGP・タブ表示には必ずこの接頭辞を付ける */
export const UNOFFICIAL_PREFIX = '【非公式】';

/** ブラウザのタブ・検索結果・SNSカードに出す名前 */
export const DOCUMENT_TITLE = `${UNOFFICIAL_PREFIX}${SITE_TITLE}`;

/**
 * 一覧ページ（トップ）の title に付ける説明。検索結果でクリックされるかを左右する。
 * ルート（`/`）は常に最新募集年度。年度が変わったらここを更新する。
 */
export const SITE_TAGLINE = '2026年募集馬92頭を血統・馬体・価格で比較';

export const SITE_DESCRIPTION =
  '【非公式】2026年キャロットクラブ募集馬92頭を、父・母父・体高・胸囲・管囲・馬体重・一口価格・厩舎で並べ替え、絞り込みできる出資馬検討ツール。一口馬主が個人で作ったもので、株式会社キャロットクラブとは関係ありません。自分の評価（A〜E・お気に入り・消・メモ）はブラウザに保存され、netkeibaやXの検索へもすぐ飛べます。';

/**
 * 過去年度ページ（`/2025/`）用の文言。ルート用の定数を上書きせず別に持つ。
 * 年度ページを増やす時はここに `_2026` のように足していく。
 */
export const SITE_TAGLINE_2025 = '2025年募集馬93頭を血統・馬体・価格で比較';

export const SITE_DESCRIPTION_2025 =
  '【非公式】2025年キャロットクラブ募集馬93頭を、父・母父・体高・胸囲・管囲・馬体重・一口価格・厩舎で並べ替え、絞り込みできる出資馬検討ツール。一口馬主が個人で作ったもので、株式会社キャロットクラブとは関係ありません。自分の評価（A〜E・お気に入り・消・メモ）はブラウザに保存され、netkeibaやXの検索へもすぐ飛べます。';

/** 公式との混同を避けるための注記。表示とメタ情報の両方で使う */
export const UNOFFICIAL_NOTICE =
  'このサイトは一口馬主が個人で作った非公式ツールです。株式会社キャロットクラブとは関係がなく、クラブが提供・監修するものではありません。出資の判断は必ずクラブ公式の情報でご確認ください。';

/**
 * クラブの転載許可条件（個人利用に限り、「キャロットクラブより許可をもらって転載した旨」を
 * ブログ等に明記すること）を満たすための表示文。本人がクラブに確認済み（2026-08-19）。
 * クラブからの回答メール本文はここには載せず、条件で求められている「その旨」の一文のみを表示する。
 */
export const CLUB_PERMISSION_NOTICE =
  '本サイトに掲載する写真・文章の一部は、キャロットクラブより許可をもらって転載しています。';

/**
 * 問い合わせ先のGoogleフォーム。全ページのフッターからリンクする。
 * 回答はGoogle側に届くので、このサイト自身は何も受け取らない（送信先が外部である点に注意）。
 */
export const CONTACT_FORM_URL = 'https://forms.gle/3r55coJm62YbYZkF7';

/**
 * Google AdSense のパブリッシャーID（`ca-pub-…`）。
 * `BaseLayout` の `<head>` で自動広告のスクリプトに渡し、`public/ads.txt` にも同じIDを書く。
 * **2か所で同じIDを持つので、差し替えるときは両方直すこと**（ads.txt が食い違うと
 * 「販売者情報が不明」扱いになり、広告が配信されなくなる）。
 * 忍者AdMax（`src/components/AdSlot.astro`）とは別枠で、こちらはページ全体に自動で挿入される。
 */
export const ADSENSE_CLIENT_ID = 'ca-pub-7478797109606594';

/**
 * 忍者AdMaxの広告枠を出すか。`false` にすると記事の枠（`src/components/AdSlot.astro`）・フッター枠・
 * 2025年一覧の枠がまとめて消え、プライバシーポリシーの AdMax の記載も外れる。
 * 2026-09-26 本人判断で停止（成人向けの広告が出ていたうえ、今は収益面でも良い時期ではないため）。
 * 2026-10-01 に再開（下の `ADMAX_TOP_SLOT_ONLY` で全枠をトップの枠に差し替えた状態）。
 * 2026-10-13 に再び停止（Google AdSense の審査に通ったので、広告を AdSense の自動広告へ置き換える。本人判断）。
 * 枠コードは各所に残してあるので、止める・戻すはここを切り替えるだけ。
 */
export const ADMAX_ENABLED = false;

/**
 * 一時しのぎ（本人指示・2026-10-01）: AdMax の全枠を、トップページの枠コード
 * （`src/data/ad-slots.ts` の `AD_SP_TOP` / `AD_PC_TOP`）に差し替えて出す。
 * 2026-09-26 に全体停止した原因の成人向け広告は、トップの枠では出ていなかった（本人確認・2026-09-30）ため。
 * 全部が同じ枠になるので、AdMax 側の枠ごとの数値は分けて見られなくなる（本人了承）。
 * 元の枠コードは各所に残してあり、`false` にすれば場所ごとの枠に戻る。
 */
export const ADMAX_TOP_SLOT_ONLY = true;

/** サイトのどこかで AdMax を出しているか。プライバシーポリシーの記載はこちらに合わせる。 */
export const ADMAX_IN_USE = ADMAX_ENABLED;

/**
 * AdSense の記事内広告（手動配置）を出すか。記事の `.ad-rect` 枠の中身
 * （`src/components/InArticleAd.astro`）が対象。`false` にすると全記事から消える
 * （枠は `.ad-rect:empty` で余白ごと消える）。noindex ページには `isNoindexPath()` で出さない。
 * 2026-10-21 追加（AdMax 停止後の空き枠に AdSense の記事内広告を入れる）。
 */
export const ADSENSE_IN_ARTICLE_ENABLED = true;

/** 記事内広告ユニットの slot ID（AdSense 管理画面の `data-ad-slot`）。 */
export const ADSENSE_IN_ARTICLE_SLOT_ID = '1270270437';
