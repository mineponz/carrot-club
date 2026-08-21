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

/** 万円単位の数値を "1,930" のようにカンマ区切りにする。 */
export function formatManYen(value: number): string {
  return Math.round(value).toLocaleString('ja-JP');
}
