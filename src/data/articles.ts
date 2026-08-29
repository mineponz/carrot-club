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
  /** カード用サムネイル。各記事ページの`ogImage`と同じ画像を流用する（新規生成しない）。 */
  image: string;
}

export const analysisArticles: AnalysisArticle[] = [
  {
    href: '/articles/birth-order/',
    title: '何番目の仔かと成績の関係',
    description:
      '「良い母は3番仔以内に走るのを出す」「初仔は走らない」「空胎明けは走る」――産次にまつわる3つの俗説を、牡馬・牝馬に分けても検証した。',
    image: '/og-article-birth-order-v1.png',
  },
  {
    href: '/articles/chest-girth/',
    title: '胸囲と成績・回収率の関係',
    description:
      '体高・馬体重の陰で見落とされがちな「胸囲」は成績と関係あるのか。獲得賞金だけでなく、安く仕入れて稼いだ馬を測る「回収率」でも検証。',
    image: '/og-article-chest-girth-v1.png',
  },
  {
    href: '/articles/birth-month/',
    title: '誕生月と体格・成績の関係',
    description:
      '「早生まれのほうが大きく出る」は馬にも当てはまるか。1月生まれなのに小さい馬と、4月生まれで小さい馬。デビュー率と成績にどれだけ差が出るかを検証。',
    image: '/og-article-birth-month-v1.png',
  },
  {
    href: '/articles/dam-age/',
    title: '母馬の年齢と成績の関係',
    description:
      '「高齢の母馬は不利」という俗説を、母齢と獲得賞金の相関係数・階級別グラフで検証。結果はほぼ無相関だった。',
    image: '/og-article-dam-age-v1.png',
  },
  {
    href: '/articles/height/',
    title: '体高と成績の関係',
    description:
      '募集時の体高と、その後の中央・地方獲得賞金の関係を散布図・階級別グラフで見る。ダービー馬タスティエーラなど実際の代表馬も紹介。',
    image: '/og-article-height-v1.png',
  },
];
