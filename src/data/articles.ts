/**
 * データ分析記事（`/articles/*`）の一覧。記事を足したらここに1件追加するだけで、
 * `/articles/`の一覧ページとトップページの導線カードの両方に反映される
 * （2つの場所に別々に書くと片方だけ直し忘れる。実際に一覧ページとトップページの
 * リンク文言が「体高・一口価格」のまま母齢記事を足し忘れて古くなっていた・2026-08-23）。
 */
export interface AnalysisArticle {
  href: string;
  title: string;
  description: string;
}

export const analysisArticles: AnalysisArticle[] = [
  {
    href: '/articles/dam-age/',
    title: '母馬の年齢と成績の関係',
    description:
      '「高齢の母馬は不利」という俗説を、母齢と獲得賞金の相関係数・階級別グラフで検証。結果はほぼ無相関だった。',
  },
  {
    href: '/articles/height/',
    title: '体高と成績の関係',
    description:
      '募集時の体高と、その後の中央・地方獲得賞金の関係を散布図・階級別グラフで見る。ダービー馬タスティエーラなど実際の代表馬も紹介。',
  },
];
