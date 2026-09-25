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
  /**
   * 記事の区分。'analysis' = 募集時データと成績を突き合わせた分析記事、
   * 'reading' = 募集時期に紐づかない読み物（例: 馬名の傾向）。`/articles/`一覧の
   * 見出しを分けるのに使う（2026-09-16、キャロ馬名傾向記事の追加に合わせて導入）。
   * 'training' = 募集後〜デビュー前の育成の節目を扱う記事（2026-09-23、北海道を出る時期の記事で導入）。
   */
  kind: 'analysis' | 'training' | 'reading';
}

export const analysisArticles: AnalysisArticle[] = [
  {
    href: '/articles/debut-weight-gain/',
    title: 'デビューまでにたくさん増えた馬は、走るのか',
    description:
      '1歳8月の測尺からデビュー戦まで、馬体重がどれだけ増えたかと、その後の成績を約500頭で比べた。たくさん増えた馬が走るとは言えず、見かけの差はデビューまでの日数だった。増え方を決めていたのは、測尺時の小ささと遅生まれ。',
    image: '/og-article-debut-weight-gain-v1.png',
    kind: 'training',
  },
  {
    href: '/articles/hokkaido-departure/',
    title: 'キャロの募集馬は、いつ北海道を出るのか',
    description:
      '測尺から本州の育成場・トレセンへ移るまでの日数を、2017〜2022年募集の約500頭で数えた。牡は2歳4〜5月、牝は5月と8〜9月に山。早く出た馬ほどよく走るが、ダービー馬もジャパンカップ馬も遅く出た側にいた。',
    image: '/og-article-hokkaido-departure-v1.png',
    kind: 'training',
  },
  {
    href: '/articles/second-offering/',
    title: '第2次募集の15頭を、過去のデータで見比べる',
    description:
      '第2次募集で今から出資できる15頭（牝11・牡4）を、過去の募集データで確かめた物差しで見比べた。牝は募集時の体重・胸囲がともに過去の中央値を超えると回収率100%超の割合がおよそ2倍になる。牡は測尺で絞れない。',
    image: '/og-article-second-offering-v1.png',
    kind: 'analysis',
  },
  {
    href: '/articles/horse-names/',
    title: 'キャロの馬名は、どこから来ているのか',
    description:
      '募集馬の名前は誰から来ているのか。クラブが公開している「馬名の意味・由来」を2016〜2024年生まれの全頭ぶん読んで数えた。母から付く馬が3頭に2頭、言語は30種類以上。母が独語なら仔も独語、父の初年度産駒は父から付きやすい。',
    image: '/og-article-horse-names-v1.png',
    kind: 'reading',
  },
  {
    href: '/articles/secondary-offering/',
    title: '1.5次募集に回った馬にも、当たりはいるのか？',
    description:
      '1次募集で満口にならなかった馬たちのその後を、過去4年ぶんさかのぼって調べた。成績が出そろった3世代とも、同期の獲得賞金トップ10に1頭ずつ入っている。オープンを勝った馬も、募集価格を上回って稼いだ馬もいる。',
    image: '/og-article-secondary-offering-v1.png',
    kind: 'analysis',
  },
  {
    href: '/articles/stable-leading/',
    title: 'リーディング上位の厩舎に入った馬は走るのか？',
    description:
      '募集時点でリーディング上位の厩舎に入った馬と、そうでない馬。重賞に届く率も獲得賞金の中央値も、ほとんど変わらなかった。線を広げると上位側のほうが低いことさえある。唯一はっきり出たのは、上位側のほうが出走率が低いという予想外の向きだった。',
    image: '/og-article-stable-leading-v2.png',
    kind: 'analysis',
  },
  {
    href: '/articles/weight/',
    title: '馬体重と成績の関係',
    description:
      '測尺で一番みんなが見る馬体重。全体では弱い正の相関だが、牡と牝に分けると牡では消え、牝でだけはっきり残った。小柄な牝は数字が振るわず、牡はサイズと成績が無関係。',
    image: '/og-article-weight-v1.png',
    kind: 'analysis',
  },
  {
    href: '/articles/caret-girth/',
    title: '管囲が太い馬は走るのか？',
    description:
      '測尺の右端にある「管囲」と成績の関係を調べたら、これまでで一番はっきりした差が出た。ところが正体は牡と牝の差だった。測尺は性別を揃えて見ないと危ない、という話。',
    image: '/og-article-caret-girth-v1.png',
    kind: 'analysis',
  },
  {
    href: '/articles/club-siblings/',
    title: '母がサンデー出身の募集馬は活躍しているか？',
    description:
      '「先に取られた残りが回ってくる」という説を検証。出走率はむしろ高く、同じ母の兄姉と中位の成績も互角。ただし重賞級だけが向こうに出ていた。',
    image: '/og-article-club-siblings-v1.png',
    kind: 'analysis',
  },
  {
    href: '/articles/birth-order/',
    title: '何番目の仔かと成績の関係',
    description:
      '「良い母は3番仔以内に走るのを出す」「初仔は走らない」「空胎明けは走る」――産次にまつわる3つの俗説を、牡馬・牝馬に分けても検証した。',
    image: '/og-article-birth-order-v1.png',
    kind: 'analysis',
  },
  {
    href: '/articles/chest-girth/',
    title: '胸囲と成績・回収率の関係',
    description:
      '体高・馬体重の陰で見落とされがちな「胸囲」は成績と関係あるのか。獲得賞金だけでなく、安く仕入れて稼いだ馬を測る「回収率」でも検証。',
    image: '/og-article-chest-girth-v1.png',
    kind: 'analysis',
  },
  {
    href: '/articles/birth-month/',
    title: '誕生月と体格・成績の関係',
    description:
      '「早生まれのほうが大きく出る」は馬にも当てはまるか。1月生まれなのに小さい馬と、4月生まれで小さい馬。デビュー率と成績にどれだけ差が出るかを検証。',
    image: '/og-article-birth-month-v1.png',
    kind: 'analysis',
  },
  {
    href: '/articles/dam-age/',
    title: '母馬の年齢と成績の関係',
    description:
      '「高齢の母馬は不利」という俗説を、母齢と獲得賞金の相関係数・階級別グラフで検証。結果はほぼ無相関だった。',
    image: '/og-article-dam-age-v1.png',
    kind: 'analysis',
  },
  {
    href: '/articles/height/',
    title: '体高と成績の関係',
    description:
      '募集時の体高と、その後の中央・地方獲得賞金の関係を散布図・階級別グラフで見る。ダービー馬タスティエーラなど実際の代表馬も紹介。',
    image: '/og-article-height-v1.png',
    kind: 'analysis',
  },
];
