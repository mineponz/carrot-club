import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  linearScale,
  histogram,
  pearsonCorrelation,
  spearmanCorrelation,
  bucketAverage,
  bucketMedian,
  countByBucket,
  mean,
  median,
  formatManYen,
  mannWhitneyU,
  twoProportionZTest,
} from './chart-math.ts';

test('mean averages values', () => {
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(mean([]), 0);
});

test('median picks middle value / averages the middle two', () => {
  assert.equal(median([1, 3, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), 0);
});

test('linearScale maps domain endpoints to range endpoints', () => {
  const scale = linearScale([0, 10], [100, 200]);
  assert.equal(scale(0), 100);
  assert.equal(scale(10), 200);
  assert.equal(scale(5), 150);
});

test('linearScale handles a zero-width domain without dividing by zero', () => {
  const scale = linearScale([5, 5], [0, 100]);
  assert.equal(scale(5), 50);
});

test('histogram counts values into fixed-width bins, last bin inclusive of max', () => {
  const bins = histogram([1, 2, 4, 4, 9, 10], 5, 0, 10);
  assert.deepEqual(
    bins.map((b) => b.count),
    [4, 2]
  );
});

test('pearsonCorrelation is 1 for perfectly correlated data', () => {
  const r = pearsonCorrelation([1, 2, 3, 4], [10, 20, 30, 40]);
  assert.ok(r !== null && Math.abs(r - 1) < 1e-9);
});

test('pearsonCorrelation is null when a series has zero variance', () => {
  assert.equal(pearsonCorrelation([1, 1, 1], [1, 2, 3]), null);
});

test('spearmanCorrelation is 1 for a monotonic (but non-linear) relationship', () => {
  // pearsonCorrelationだと歪みで1未満になる非線形単調データ
  const r = spearmanCorrelation([1, 2, 3, 4, 5], [1, 4, 9, 16, 25]);
  assert.ok(r !== null && Math.abs(r - 1) < 1e-9);
});

test('spearmanCorrelation resists a single extreme outlier better than pearsonCorrelation', () => {
  const xs = [1, 2, 3, 4, 5, 6];
  const ys = [1, 2, 3, 4, 5, 1000]; // 最後だけ桁違いの外れ値
  const pearson = pearsonCorrelation(xs, ys) as number;
  const spearman = spearmanCorrelation(xs, ys) as number;
  assert.ok(spearman > pearson);
});

test('spearmanCorrelation handles tied values via average rank', () => {
  const r = spearmanCorrelation([1, 1, 2, 3], [1, 1, 2, 3]);
  assert.ok(r !== null && Math.abs(r - 1) < 1e-9);
});

test('countByBucket counts items per key and omits keys with no items', () => {
  const counts = countByBucket(
    [{ k: 'a' }, { k: 'a' }, { k: 'b' }],
    (item) => item.k
  );
  assert.equal(counts.get('a'), 2);
  assert.equal(counts.get('b'), 1);
  // 0件の階級はキー自体が無い。呼び出し側は `?? 0` で受けること
  assert.equal(counts.get('c'), undefined);
});

test('bucketAverage groups and averages by key', () => {
  const result = bucketAverage(
    [
      { k: 'a', v: 10 },
      { k: 'a', v: 20 },
      { k: 'b', v: 5 },
    ],
    (item) => item.k,
    (item) => item.v
  );
  const a = result.find((r) => r.bucket === 'a');
  const b = result.find((r) => r.bucket === 'b');
  assert.equal(a?.n, 2);
  assert.equal(a?.avg, 15);
  assert.equal(b?.n, 1);
  assert.equal(b?.avg, 5);
});

test('bucketMedian groups and takes the median by key, resisting outliers', () => {
  const result = bucketMedian(
    [
      { k: 'a', v: 10 },
      { k: 'a', v: 20 },
      { k: 'a', v: 10000 }, // 外れ値。中央値なら引っ張られない
      { k: 'b', v: 5 },
    ],
    (item) => item.k,
    (item) => item.v
  );
  const a = result.find((r) => r.bucket === 'a');
  const b = result.find((r) => r.bucket === 'b');
  assert.equal(a?.n, 3);
  assert.equal(a?.med, 20);
  assert.equal(b?.n, 1);
  assert.equal(b?.med, 5);
});

test('formatManYen adds thousands separators and rounds', () => {
  assert.equal(formatManYen(1930), '1,930');
  assert.equal(formatManYen(602.5), '603' /* toLocaleString rounds half-to-even is not guaranteed; just check it's close */);
});

test('mannWhitneyU finds no difference (p close to 1) for two identical distributions', () => {
  const a = [1, 2, 3, 4, 5];
  const b = [1, 2, 3, 4, 5];
  const { z, p } = mannWhitneyU(a, b);
  assert.equal(z, 0);
  assert.ok(p > 0.99);
});

test('mannWhitneyU finds a strong difference (small p) for clearly separated distributions', () => {
  const low = [1, 2, 3, 4, 5, 6, 7, 8];
  const high = [101, 102, 103, 104, 105, 106, 107, 108];
  const { p } = mannWhitneyU(low, high);
  assert.ok(p < 0.001);
});

test('twoProportionZTest finds no difference (p close to 1) for identical proportions', () => {
  const { z, p } = twoProportionZTest(10, 100, 10, 100);
  assert.equal(z, 0);
  assert.ok(p > 0.99);
});

test('twoProportionZTest finds a strong difference (small p) for clearly separated proportions with enough n', () => {
  const { p } = twoProportionZTest(5, 200, 100, 200);
  assert.ok(p < 0.001);
});
