import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertDebutTimingClaims, termOf, type DebutTimingStats } from './debut-timing.ts';

function load(): DebutTimingStats {
  return JSON.parse(readFileSync(new URL('../../analysis/data/debut-timing-stats.json', import.meta.url), 'utf8'));
}

test('assertDebutTimingClaims: 実データの集計値は本文の前提を満たす', () => {
  assert.doesNotThrow(() => assertDebutTimingClaims(load()));
});

test('性別＋価格調整でも11月以降の3区分は負で有意、2歳9〜10月は有意でない', () => {
  const s = load();
  assert.ok(termOf(s, 'sexPrice', '2歳9〜10月').p > 0.05);
  for (const l of ['2歳11〜12月', '3歳1〜3月', '3歳4月以降']) {
    const t = termOf(s, 'sexPrice', l);
    assert.ok(t.coef < 0 && t.p < 0.05, l);
  }
});

test('率が本文とずれたらアサーションが落ちる', () => {
  const s = load();
  s.buckets[2].all.rate = 50;
  assert.throws(() => assertDebutTimingClaims(s), /本文の前提が崩れた/);
});

test('重賞馬の表が1頭欠けたら落ちる', () => {
  const s = load();
  s.gradeWinners.pop();
  assert.throws(() => assertDebutTimingClaims(s), /本文の前提が崩れた/);
});

test('一口価格の項が有意になったら落ちる', () => {
  const s = load();
  termOf(s, 'sexPrice', '一口価格(万円)').p = 0.01;
  assert.throws(() => assertDebutTimingClaims(s), /一口価格の項/);
});

test('本文の重賞名が勝ったレースに無ければ落ちる', () => {
  const s = load();
  const g = s.gradeWinners.find((x) => x.name === 'レイパパレ')!;
  g.gradeWins = g.gradeWins.filter((w) => !w.includes('大阪杯'));
  assert.throws(() => assertDebutTimingClaims(s), /大阪杯/);
});

test('地方デビューの頭数がずれたら落ちる', () => {
  const s = load();
  s.localDebut.n = 35;
  assert.throws(() => assertDebutTimingClaims(s), /地方デビュー/);
});
