import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  linearScale,
  histogram,
  pearsonCorrelation,
  bucketAverage,
  countByBucket,
  formatManYen,
} from './chart-math.ts';

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

test('formatManYen adds thousands separators and rounds', () => {
  assert.equal(formatManYen(1930), '1,930');
  assert.equal(formatManYen(602.5), '603' /* toLocaleString rounds half-to-even is not guaranteed; just check it's close */);
});
