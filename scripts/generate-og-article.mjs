/**
 * 記事ページ専用のOGP画像（1200x630）を書き出す手動ツール。
 *
 * サイト共通のOGP画像は `public/og-v2.png`（`scripts/generate-og-wide.mjs`）だが、
 * 分析記事（`/articles/*`）はカードに記事名が出ないと何の記事か分からないため、
 * 記事ごとに専用画像を作る。
 *
 *   node scripts/generate-og-article.mjs height
 *
 * ## 記事を足したときは
 * 下の `ARTICLES` にスラッグを1件足す（見出し・サブ・チップの文言と出力ファイル名）。
 * 併せて記事側の `<BaseLayout ogImage=... ogImageAlt=... >` に出力ファイル名を渡すこと。
 *
 * ## 画像に「今後変わる数字」を焼き込まない
 * 記事本文の相関係数や平均賞金は競走成績のスナップショット（`analysis/data/race-results.json`）
 * 由来で、成績を取り直すたびに変わる。画像はSNS側にURL単位でキャッシュされ作り直しても
 * すぐには差し替わらないので、**カードに出すのは募集時データだけから決まる値**に限る。
 * 対象頭数と体高分布のミニ棒グラフは `analysis/data/recruits.json`（過去分は確定）から
 * 毎回計算しているので、記事と食い違わない。
 *
 * ## 作り替えたらファイル名も変える
 * `og-article-height-v1.png` → `-v2.png` のように上げる。XなどのSNSは画像URL単位で
 * キャッシュするため、同じURLのまま中身だけ差し替えても古いカードが出続ける
 * （BaseLayout.astro のOGPコメントと同じ理由）。
 *
 * ## playwright はこのリポジトリの依存に入れない
 * generate-og.mjs / generate-og-wide.mjs と同じ方針で、実行する人が用意したものを借りる。
 *   npm i -g playwright && npx playwright install chromium
 * ブラウザ本体だけ手元にある場合は CHROMIUM_EXECUTABLE_PATH で実行ファイルを直接指定できる。
 *
 * ## 日本語フォント
 * 環境のフォントに任せると字形が変わるため、Noto Sans JP を Google Fonts から取得して
 * data URI で埋め込む。取得結果は `.cache/fonts/`（git管理外）に置き、再実行時は使い回す。
 * オフラインで `.cache/` も無い場合は失敗するので、その時はネットのある環境で実行する。
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { histogram } from '../src/lib/chart-math.ts';
import { SITE_URL } from '../src/consts.ts';

/** カード右下に出すURL文言。ドメイン移行時に`src/consts.ts`のSITE_URLだけ直せば揃う。 */
const SITE_HOST = SITE_URL.replace(/^https?:\/\//, '');

const WIDTH = 1200;
const HEIGHT = 630;
/** 元デザイン画像の一辺（正方形前提。generate-og-wide.mjs と同じ） */
const SRC_SIZE = 1254;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const srcPath = join(scriptDir, 'og-source.webp');
const fontCacheDir = join(repoRoot, '.cache', 'fonts');

/** 元デザイン画像から借りる部品（座標の意味は generate-og-wide.mjs のコメント参照） */
const PARTS = {
  carrot: { x: 155, y: 340, w: 190, h: 275, outH: 210 },
  stamp: { x: 795, y: 478, w: 330, h: 134, outH: 40 },
};

/** 記事ごとの文言と出力先。スラッグは `/articles/<slug>/` に対応させる。 */
const ARTICLES = {
  height: {
    out: 'og-article-height-v1.png',
    // 見出しは2行で組む（1行が長いとカードのサムネイルで潰れる）
    headline: ['体高と成績の関係を', '<em>470頭</em>のデータで見る'],
    // 見出しの470頭は recruits.json の件数で置き換える（下の buildHeadline）
    countPlaceholder: '470頭',
    // 「2021〜2025年」はheightChart()が実データから出す年範囲で置き換える（下のyearRangePlaceholder）
    lead: 'キャロットクラブ 2021〜2025年募集の募集時データ × 現在の競走成績',
    yearRangePlaceholder: '2021〜2025年',
    chips: ['体高 × 獲得賞金の散布図', '体高階級別の平均', '重賞勝ち馬を全掲載'],
    buildChart: heightChart,
  },
  'dam-age': {
    out: 'og-article-dam-age-v1.png',
    headline: ['母馬の年齢と成績の関係を', '<em>815頭</em>のデータで見る'],
    countPlaceholder: '815頭',
    lead: 'キャロットクラブ 2017〜2025年募集の募集時データ × 現在の競走成績',
    yearRangePlaceholder: '2017〜2025年',
    chips: ['母齢 × 獲得賞金の散布図', '母齢階級別の平均', '重賞勝ち馬を全掲載'],
    buildChart: damAgeChart,
  },
  'birth-month': {
    out: 'og-article-birth-month-v1.png',
    headline: ['誕生月と体格・成績の', '関係を見てみた'],
    lead: 'キャロットクラブ 2017〜2025年募集の募集時データ × 現在の競走成績',
    yearRangePlaceholder: '2017〜2025年',
    chips: ['早生まれ効果の検証', '月別の平均体高', '重賞勝ち馬を紹介'],
    buildChart: birthMonthChart,
  },
  'chest-girth': {
    out: 'og-article-chest-girth-v1.png',
    headline: ['胸囲と成績・回収率の', '関係を見てみた'],
    lead: 'キャロットクラブ 2017〜2025年募集の募集時データ × 現在の競走成績',
    yearRangePlaceholder: '2017〜2025年',
    chips: ['胸囲 × 獲得賞金の散布図', '回収率でも検証', '重賞勝ち馬を全掲載'],
    buildChart: chestGirthChart,
  },
  'birth-order': {
    out: 'og-article-birth-order-v1.png',
    headline: ['何番目の仔かと成績の', '関係を見てみた'],
    lead: 'キャロットクラブ 2017〜2025年募集の募集時データ × 現在の競走成績',
    yearRangePlaceholder: '2017〜2025年',
    chips: ['3つの俗説を検証', '牡馬・牝馬で比較', '重賞勝ち馬を全掲載'],
    buildChart: birthOrderChart,
  },
  'club-siblings': {
    out: 'og-article-club-siblings-v1.png',
    headline: ['母がサンデー出身の', '募集馬は走っているのか'],
    lead: 'キャロットクラブ 2017〜2025年募集の募集時データ × 現在の競走成績',
    yearRangePlaceholder: '2017〜2025年',
    chips: ['出走率・獲得賞金で検証', '同じ母の兄姉と比較', '重賞馬の下の成績も'],
    buildChart: clubSiblingsChart,
  },
};

const slug = process.argv[2];
const article = ARTICLES[slug];
if (!article) {
  console.error(`[og] 記事スラッグを指定してください: ${Object.keys(ARTICLES).join(' / ')}`);
  console.error('  例) node scripts/generate-og-article.mjs height');
  process.exit(1);
}

const INSTALL_HINT = `
playwright が見つかりませんでした。このリポジトリの依存には入れていないため、別途用意して実行してください。

  npm i -g playwright
  npx playwright install chromium
  node scripts/generate-og-article.mjs ${slug}
`;

/** playwright / playwright-core を順に探して chromium を返す。 */
async function loadChromium() {
  const names = ['playwright', 'playwright-core'];
  const tried = [];

  for (const name of names) {
    try {
      const mod = await import(name);
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) return chromium;
      tried.push(`${name}: chromium が見つからない`);
    } catch (error) {
      tried.push(`${name}: ${error.code ?? error.name}`);
    }
  }

  let globalRoot = null;
  try {
    globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  } catch (error) {
    tried.push(`npm root -g の実行に失敗: ${error.message}`);
  }

  if (globalRoot) {
    const require = createRequire(import.meta.url);
    for (const name of names) {
      try {
        const entry = require.resolve(name, { paths: [globalRoot] });
        const mod = await import(pathToFileURL(entry).href);
        const chromium = mod.chromium ?? mod.default?.chromium;
        if (chromium) return chromium;
      } catch (error) {
        tried.push(`${globalRoot}/${name}: ${error.code ?? error.name}`);
      }
    }
  }

  console.error('[og] 読み込みに失敗した候補:');
  for (const line of tried) console.error(`  - ${line}`);
  console.error(INSTALL_HINT);
  process.exit(1);
}

/** Google Fonts から Noto Sans JP を取り、data URI にして返す（`.cache/fonts/` に保存）。 */
async function loadFont(weight) {
  const cachePath = join(fontCacheDir, `noto-sans-jp-${weight}.ttf`);
  if (!existsSync(cachePath)) {
    // Google Fonts は UA で返す形式を変える。素の `Mozilla/5.0` だと
    // 「日本語全体を1ファイルに収めた ttf」が返るのでこれを使う。新しいブラウザのUAだと
    // unicode-range で細かく分割された woff2 が返り、@font-face 1本では字が欠ける。
    const uaTtf = 'Mozilla/5.0';
    const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@${weight}`;
    const css = await fetch(cssUrl, { headers: { 'User-Agent': uaTtf } }).then((r) => {
      if (!r.ok) throw new Error(`Google Fonts CSSの取得に失敗: ${r.status}`);
      return r.text();
    });
    const url = css.match(/url\((https:\/\/[^)]+\.ttf)\)/)?.[1];
    if (!url) throw new Error(`CSSからフォントURLを取り出せませんでした: ${cssUrl}`);
    const buf = Buffer.from(await fetch(url).then((r) => r.arrayBuffer()));
    mkdirSync(fontCacheDir, { recursive: true });
    writeFileSync(cachePath, buf);
    console.log(`[og] フォントを取得しました: ${cachePath}`);
  }
  return `data:font/ttf;base64,${readFileSync(cachePath).toString('base64')}`;
}

/** 部品1つぶんの div（背景画像を負のオフセットでずらして切り出す） */
function partHtml(name, dataUri, extraStyle = '') {
  const p = PARTS[name];
  const scale = p.outW ? p.outW / p.w : p.outH / p.h;
  const px = (v) => `${Math.round(v * scale)}px`;
  return `<div class="crop" style="width:${px(p.w)};height:${px(p.h)};
    background-image:url('${dataUri}');
    background-size:${px(SRC_SIZE)} ${px(SRC_SIZE)};
    background-position:-${px(p.x)} -${px(p.y)};${extraStyle}"></div>`;
}

/**
 * 記事と同じ体高分布（3cm刻み・141〜168cm）をミニ棒グラフのHTMLにする。
 * 対象頭数もここで数えた実データを使う（本文の「470頭」と同じ数え方）。
 */
function heightChart() {
  const recruits = JSON.parse(readFileSync(join(repoRoot, 'analysis', 'data', 'recruits.json'), 'utf8'));
  const heights = recruits.map((h) => h.height).filter((v) => typeof v === 'number');
  const bins = histogram(heights, 3, 141, 168);
  const max = Math.max(...bins.map((b) => b.count));
  const bars = bins
    .map((b) => `<div class="bar" style="height:${Math.max(4, Math.round((b.count / max) * 96))}px"></div>`)
    .join('');
  // 年範囲もrecruits.jsonの実データから出す（ハードコードすると年が増えるたびにここも直し忘れる。
  // 2026-08-23、「2021〜2025年募集」の決め打ちが2017〜2020年分の追加で古くなっていた反省から）。
  const years = [...new Set(recruits.map((r) => r.recruitYear))].sort((a, b) => a - b);
  const yearRangeLabel = years.length > 0 ? `${years[0]}〜${years[years.length - 1]}年` : '';
  return {
    total: recruits.length,
    yearRangeLabel,
    html: `<div class="mini-chart">${bars}</div>`,
    caption: '体高の分布（3cm刻み）',
  };
}

/**
 * バー本数が多い記事（母齢10本・誕生月12本）だと、height.astro用に決め打った
 * bar幅20px・gap7px（9本前提）のままでは側の250px枠からはみ出す。
 * バー幅・gapを本数から逆算して側の枠（約220px）に収める共通ヘルパー。
 */
function barsHtml(counts) {
  const n = counts.length;
  const max = Math.max(...counts);
  const gap = n > 10 ? 3 : n > 8 ? 5 : 7;
  const barWidth = Math.max(8, Math.floor((220 - (n - 1) * gap) / n));
  const bars = counts
    .map(
      (c) =>
        `<div class="bar" style="width:${barWidth}px;height:${Math.max(4, Math.round((c / max) * 96))}px"></div>`
    )
    .join('');
  return `<div class="mini-chart" style="gap:${gap}px">${bars}</div>`;
}

/** 記事と同じ母齢分布（2歳刻み・4〜24歳）をミニ棒グラフのHTMLにする（dam-age.astroと同じbinning）。 */
function damAgeChart() {
  const recruits = JSON.parse(readFileSync(join(repoRoot, 'analysis', 'data', 'recruits.json'), 'utf8'));
  const withAge = recruits.filter((h) => typeof h.damAge === 'number');
  const bins = histogram(
    withAge.map((h) => h.damAge),
    2,
    4,
    24
  );
  const years = [...new Set(recruits.map((r) => r.recruitYear))].sort((a, b) => a - b);
  const yearRangeLabel = years.length > 0 ? `${years[0]}〜${years[years.length - 1]}年` : '';
  return {
    total: withAge.length,
    yearRangeLabel,
    html: barsHtml(bins.map((b) => b.count)),
    caption: '母齢の分布（2歳刻み）',
  };
}

/** 記事と同じ胸囲分布（3cm刻み・159〜195cm）をミニ棒グラフのHTMLにする（chest-girth.astroと同じbinning）。 */
function chestGirthChart() {
  const recruits = JSON.parse(readFileSync(join(repoRoot, 'analysis', 'data', 'recruits.json'), 'utf8'));
  const girths = recruits.map((h) => h.chestGirth).filter((v) => typeof v === 'number');
  const bins = histogram(girths, 3, 159, 195);
  const max = Math.max(...bins.map((b) => b.count));
  const bars = bins
    .map((b) => `<div class="bar" style="height:${Math.max(4, Math.round((b.count / max) * 96))}px"></div>`)
    .join('');
  const years = [...new Set(recruits.map((r) => r.recruitYear))].sort((a, b) => a - b);
  const yearRangeLabel = years.length > 0 ? `${years[0]}〜${years[years.length - 1]}年` : '';
  return {
    total: girths.length,
    yearRangeLabel,
    html: `<div class="mini-chart">${bars}</div>`,
    caption: '胸囲の分布（3cm刻み）',
  };
}

/**
 * 記事と同じ「母の出身クラブ別 獲得賞金の中央値」をミニ棒グラフのHTMLにする
 * （club-siblings.astro の medianPrizeBars と同じ並び・同じ集計）。
 * 1本目がサンデー・シルク出身で、そこだけ低いのがカードで一目で分かる。
 */
function clubSiblingsChart() {
  const file = JSON.parse(readFileSync(join(repoRoot, 'analysis', 'data', 'dam-siblings.json'), 'utf8'));
  const MATURE = 2021;
  const originKey = (damClub) => {
    if (damClub === 'sunday' || damClub === 'silk') return 'sundaySilk';
    if (damClub === 'carrot') return 'carrot';
    if (damClub === 'private') return 'private';
    if (damClub === 'unknown' || damClub === 'fetch-failed') return 'unknown';
    return 'other';
  };
  const order = ['sundaySilk', 'carrot', 'private', 'unknown', 'other'];
  const buckets = Object.fromEntries(order.map((k) => [k, []]));
  let total = 0;
  for (const d of file.results) {
    for (const f of d.foals) {
      if (!f.isCarrotRecruit || f.year > MATURE) continue;
      total++;
      if ((f.starts ?? 0) > 0) buckets[originKey(d.damClub)].push(f.totalPrizeManYen ?? 0);
    }
  }
  const med = (xs) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return {
    total,
    yearRangeLabel: '2017〜2025年',
    html: barsHtml(order.map((k) => Math.round(med(buckets[k])))),
    caption: '母の所属クラブ別 獲得賞金の中央値',
  };
}

/**
 * 記事と同じ産次分布（1〜10番仔・10番仔以降はまとめて11本目）をミニ棒グラフのHTMLにする
 * （birth-order.astroのDIST_TAIL_FROM=11と同じ区切り）。
 */
function birthOrderChart() {
  const recruits = JSON.parse(readFileSync(join(repoRoot, 'analysis', 'data', 'recruits.json'), 'utf8'));
  const parities = recruits.map((h) => h.damParity).filter((v) => typeof v === 'number');
  const TAIL_FROM = 11;
  const counts = [
    ...Array.from({ length: TAIL_FROM - 1 }, (_, i) => parities.filter((p) => p === i + 1).length),
    parities.filter((p) => p >= TAIL_FROM).length,
  ];
  const years = [...new Set(recruits.map((r) => r.recruitYear))].sort((a, b) => a - b);
  const yearRangeLabel = years.length > 0 ? `${years[0]}〜${years[years.length - 1]}年` : '';
  return {
    total: parities.length,
    yearRangeLabel,
    html: barsHtml(counts),
    caption: '産次の分布（1〜11番仔〜）',
  };
}

/** 記事と同じ誕生月分布（1〜12月）をミニ棒グラフのHTMLにする（birth-month.astroと同じ集計）。 */
function birthMonthChart() {
  const recruits = JSON.parse(readFileSync(join(repoRoot, 'analysis', 'data', 'recruits.json'), 'utf8'));
  const withDate = recruits.filter((h) => typeof h.birthDate === 'string');
  const months = withDate.map((h) => Number(h.birthDate.split('-')[1]));
  const counts = Array.from({ length: 12 }, (_, i) => i + 1).map((m) => months.filter((v) => v === m).length);
  const years = [...new Set(recruits.map((r) => r.recruitYear))].sort((a, b) => a - b);
  const yearRangeLabel = years.length > 0 ? `${years[0]}〜${years[years.length - 1]}年` : '';
  return {
    total: withDate.length,
    yearRangeLabel,
    html: barsHtml(counts),
    caption: '誕生月の分布（1〜12月）',
  };
}

function cardHtml({ fonts, source, chart }) {
  const headline = article.headline
    .map((line) => `<span class="headline-line">${line.replace(/<em>(.*?)<\/em>/, '<em>$1</em>')}</span>`)
    .join('');
  const chips = article.chips.map((c) => `<span class="chip">${c}</span>`).join('');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8" /><style>
    @font-face { font-family: 'NotoJP'; font-weight: 400; src: url('${fonts[400]}') format('truetype'); }
    @font-face { font-family: 'NotoJP'; font-weight: 700; src: url('${fonts[700]}') format('truetype'); }
    @font-face { font-family: 'NotoJP'; font-weight: 900; src: url('${fonts[900]}') format('truetype'); }
    html, body { margin: 0; padding: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
    /* 地色・線の色は元デザイン（og-v2.png）と揃える */
    .card { position: relative; box-sizing: border-box; width: ${WIDTH}px; height: ${HEIGHT}px;
      background: #faf7ef; font-family: 'NotoJP', sans-serif; color: #2f4634;
      display: flex; align-items: stretch; padding: 46px 56px; gap: 32px; }
    .frame { position: absolute; inset: 14px; border: 2px solid #2f4634; border-radius: 10px; }
    .main { position: relative; flex: 1; display: flex; flex-direction: column; }
    .eyebrow { display: flex; align-items: center; gap: 14px; }
    .tag { background: #c26a28; color: #fff; font-weight: 700; font-size: 22px;
      padding: 6px 16px; border-radius: 999px; letter-spacing: 0.04em; }
    .site { font-size: 20px; font-weight: 700; color: #5c6b5c; }
    /* 見出し〜チップをひとかたまりにして上下の余りを均等に分ける
       （space-between だと見出しと本文の間だけが間延びする） */
    .body { margin: auto 0; }
    .headline { display: flex; flex-direction: column; gap: 4px; font-weight: 900;
      font-size: 64px; line-height: 1.2; letter-spacing: 0.01em; }
    .headline em { font-style: normal; color: #c26a28; }
    .headline-line { display: block; }
    .lead { margin-top: 22px; font-size: 23px; font-weight: 700; color: #4a5b4a; line-height: 1.5; }
    .chips { margin-top: 24px; display: flex; flex-wrap: wrap; gap: 10px; }
    .chip { font-size: 20px; font-weight: 700; color: #2f4634; background: #fff;
      border: 2px solid #d8d2c4; border-radius: 8px; padding: 7px 14px; }
    .url { font-size: 18px; font-weight: 700; color: #7a8478; }
    .side { width: 250px; display: flex; flex-direction: column; align-items: center;
      justify-content: space-between; padding-bottom: 6px; }
    .crop { background-repeat: no-repeat; }
    .mini { text-align: center; }
    .mini-chart { display: flex; align-items: flex-end; justify-content: center; gap: 7px; height: 104px; }
    .bar { width: 20px; background: #e0a45c; border: 2px solid #2f4634; border-bottom: none;
      border-radius: 3px 3px 0 0; box-sizing: border-box; }
    .mini-caption { font-size: 17px; font-weight: 700; color: #5c6b5c; margin-top: 10px; }
  </style></head><body>
    <div class="card">
      <div class="frame"></div>
      <div class="main">
        <div class="eyebrow">
          <span class="tag">分析記事</span>
          ${partHtml('stamp', source)}
          <span class="site">キャロットクラブ出資馬検討ツール</span>
        </div>
        <div class="body">
          <div class="headline">${headline}</div>
          <div class="lead">${article.lead}</div>
          <div class="chips">${chips}</div>
        </div>
        <div class="url">${SITE_HOST}</div>
      </div>
      <div class="side">
        ${partHtml('carrot', source)}
        <div class="mini">
          ${chart.html}
          <div class="mini-caption">${chart.caption}</div>
        </div>
      </div>
    </div>
  </body></html>`;
}

async function main() {
  if (!existsSync(srcPath)) {
    console.error(`[og] 元デザイン画像が見つかりません: ${srcPath}`);
    process.exit(1);
  }

  const chromium = await loadChromium();
  const source = `data:image/webp;base64,${readFileSync(srcPath).toString('base64')}`;
  const fonts = {
    400: await loadFont(400),
    700: await loadFont(700),
    900: await loadFont(900),
  };

  const chart = article.buildChart();
  // 見出しの頭数は実データの件数に置き換える（記事本文と食い違わせない）
  if (article.countPlaceholder) {
    article.headline = article.headline.map((line) =>
      line.replace(article.countPlaceholder, `${chart.total}頭`)
    );
  }
  if (article.yearRangePlaceholder) {
    article.lead = article.lead.replace(article.yearRangePlaceholder, chart.yearRangeLabel);
  }

  const outPath = join(repoRoot, 'public', article.out);
  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
  let browser;
  try {
    browser = await chromium.launch(executablePath ? { executablePath } : {});
  } catch (error) {
    console.error(`[og] chromium の起動に失敗しました: ${error.message}`);
    console.error('[og] `npx playwright install chromium` を実行するか、CHROMIUM_EXECUTABLE_PATH を指定してください。');
    process.exit(1);
  }

  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      // 1 にしておくと出力がちょうど 1200x630 px になる（Xの推奨サイズ）
      deviceScaleFactor: 1,
      colorScheme: 'light',
    });
    page.on('pageerror', (error) => console.error(`[og][page] ${error.message}`));

    await page.setContent(cardHtml({ fonts, source, chart }), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: outPath });
    console.log(`[og] 書き出しました: ${outPath} (${WIDTH}x${HEIGHT})`);
  } finally {
    await browser.close();
  }
}

await main();
