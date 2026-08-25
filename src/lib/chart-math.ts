/**
 * SVGチャートを組み立てるための純粋関数群。DOM非依存（Astroのビルド時=Node環境でも
 * ブラウザでも同じ結果になる）。分析記事ページ（/articles/*）から使う。
 */

/** 線形スケール（データ範囲→ピクセル範囲）。 */
export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number]
): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (span === 0) return () => (r0 + r1) / 2;
  return (value: number) => r0 + ((value - d0) / span) * (r1 - r0);
}

/** 値配列を固定幅のビンに分けて度数を数える。 */
export function histogram(
  values: readonly number[],
  binWidth: number,
  min: number,
  max: number
): { binStart: number; binEnd: number; count: number }[] {
  const bins: { binStart: number; binEnd: number; count: number }[] = [];
  for (let start = min; start < max; start += binWidth) {
    const end = start + binWidth;
    const count = values.filter((v) => v >= start && (v < end || (end >= max && v <= end))).length;
    bins.push({ binStart: start, binEnd: end, count });
  }
  return bins;
}

/** ピアソンの積率相関係数。長さ2未満や分散0の場合は null。 */
export function pearsonCorrelation(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < 2 || n !== ys.length) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    sx += dx * dx;
    sy += dy * dy;
  }
  if (sx === 0 || sy === 0) return null;
  return cov / Math.sqrt(sx * sy);
}

/** 値配列を順位（同値は平均順位）に変換する。`spearmanCorrelation`の内部で使う。 */
function toRanks(values: readonly number[]): number[] {
  const indexed = values.map((v, i): [number, number] => [v, i]);
  indexed.sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1][0] === indexed[i][0]) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k][1]] = avgRank;
    i = j + 1;
  }
  return ranks;
}

/**
 * スピアマンの順位相関係数（値を順位に変換してからピアソンを取る）。獲得賞金・回収率のように
 * 分布が大きく歪む値は、線形の関係しか見ないピアソンだと単調な関係を過小評価しやすい
 * （少数の桁違いの外れ値が共分散を支配するため）。順位ベースなら外れ値の大きさに引っ張られず、
 * 「大小関係の向き」がどれだけ揃っているかを見られる。長さ2未満や分散0の場合は null。
 */
export function spearmanCorrelation(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length) return null;
  return pearsonCorrelation(toRanks(xs), toRanks(ys));
}

/** 数値をグループ化して集計値（平均・件数）を返す。 */
export function bucketAverage<T>(
  items: readonly T[],
  bucketOf: (item: T) => string,
  valueOf: (item: T) => number
): { bucket: string; n: number; avg: number }[] {
  const groups = new Map<string, number[]>();
  for (const item of items) {
    const key = bucketOf(item);
    const list = groups.get(key) ?? [];
    list.push(valueOf(item));
    groups.set(key, list);
  }
  return [...groups.entries()].map(([bucket, values]) => ({
    bucket,
    n: values.length,
    avg: values.reduce((a, b) => a + b, 0) / values.length,
  }));
}

/**
 * 数値をグループ化して集計値（中央値・件数）を返す。回収率のように分布が極端に歪む
 * （一部の稼ぎ頭が平均を大きく引き上げる）値は`bucketAverage`だと外れ値に引っ張られて
 * 階級間の差が見えなくなるため、こちらを使う。
 */
export function bucketMedian<T>(
  items: readonly T[],
  bucketOf: (item: T) => string,
  valueOf: (item: T) => number
): { bucket: string; n: number; med: number }[] {
  const groups = new Map<string, number[]>();
  for (const item of items) {
    const key = bucketOf(item);
    const list = groups.get(key) ?? [];
    list.push(valueOf(item));
    groups.set(key, list);
  }
  return [...groups.entries()].map(([bucket, values]) => ({
    bucket,
    n: values.length,
    med: median(values),
  }));
}

/**
 * キーごとの件数を数える。`bucketAverage` と同じ分け方のまま「その階級に何頭いたか」を
 * 出す用（平均の母数と母集団の頭数が違う時に、両方をグラフへ併記するため）。
 */
export function countByBucket<T>(
  items: readonly T[],
  bucketOf: (item: T) => string
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = bucketOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** 算術平均。空配列は0（呼び出し側で長さ0を別チェックする想定）。 */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 中央値。偶数個は中央2件の平均。 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** 万円単位の数値を "1,930" のようにカンマ区切りにする。 */
export function formatManYen(value: number): string {
  return Math.round(value).toLocaleString('ja-JP');
}

/** 標準正規分布の累積分布関数（Abramowitz-Stegunの近似式）。 */
function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/**
 * Mann-Whitney U検定（正規近似、タイは平均順位で処理）。賞金のように分布が大きく歪む
 * 指標で2群を比べるとき、平均値の差だけでは外れ値に引っ張られていないか分からないため使う。
 * 戻り値の`p`が小さいほど「2群は同じ分布から出た」という帰無仮説が疑わしい（＝差がありそう）。
 * `z`は`Math.min(u1, u2)`ベースなので常に0以下になり、どちらの群が大きいかの向きを持たない
 * （`twoProportionZTest`の`z`とは符号の意味が違う）。向きが要るときは中央値等を別途比較すること。
 * どちらかの配列が空なら`{ z: NaN, p: NaN }`を返す（呼び出し側で空群を渡さないこと）。
 */
export function mannWhitneyU(a: readonly number[], b: readonly number[]): { z: number; p: number } {
  if (a.length === 0 || b.length === 0) return { z: NaN, p: NaN };
  const combined = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))];
  combined.sort((x, y) => x.v - y.v);
  const ranks: number[] = new Array(combined.length);
  let i = 0;
  while (i < combined.length) {
    let j = i;
    while (j + 1 < combined.length && combined[j + 1].v === combined[i].v) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = avgRank;
    i = j + 1;
  }
  let rSumA = 0;
  combined.forEach((c, idx) => {
    if (c.g === 0) rSumA += ranks[idx];
  });
  const n1 = a.length;
  const n2 = b.length;
  const u1 = rSumA - (n1 * (n1 + 1)) / 2;
  const u = Math.min(u1, n1 * n2 - u1);
  const muU = (n1 * n2) / 2;
  const sigmaU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  const z = (u - muU) / sigmaU;
  return { z, p: 2 * (1 - normCdf(Math.abs(z))) };
}

/**
 * 2標本の比率の差の検定（正規近似）。重賞馬率のような割合を2群で比べるとき使う。
 * 正規近似は各群の期待成功数（`n * pooled比率`）が目安5未満だと信頼できない
 * （二項分布を正規分布で近似する前提が崩れる）。少数のイベント（重賞馬など）を
 * 比べるときは、先に期待成功数を確認し、5未満ならFisherの正確検定等に切り替えるか、
 * 「検定に足るサンプルではない」と明記して数値だけ出すこと。
 * `n1`または`n2`が0なら`{ z: NaN, p: NaN }`を返す。
 */
export function twoProportionZTest(x1: number, n1: number, x2: number, n2: number): { z: number; p: number } {
  if (n1 === 0 || n2 === 0) return { z: NaN, p: NaN };
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  const z = se === 0 ? 0 : (p1 - p2) / se;
  return { z, p: 2 * (1 - normCdf(Math.abs(z))) };
}
