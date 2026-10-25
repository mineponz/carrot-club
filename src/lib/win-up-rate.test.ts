import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertWinUpRateClaims, gradeWinnerRow, type WinUpRateStats } from './win-up-rate.ts';

/** ビルドが読む集計値そのもの（import だと JSON の型付けが面倒なので読み込む）。 */
function load(): WinUpRateStats {
  return JSON.parse(readFileSync(new URL('../../analysis/data/win-up-rate-stats.json', import.meta.url), 'utf8'));
}

test('assertWinUpRateClaims: 実データの集計値は本文の前提を満たす', () => {
  assert.doesNotThrow(() => assertWinUpRateClaims(load()));
});

test('2023年No.31は分母から外れ、2023年は95頭・全体は721頭', () => {
  const s = load();
  assert.equal(s.byYear.find((b) => b.year === 2023)!.all.n, 95);
  assert.equal(s.poolSize, 721);
  assert.deepEqual(s.excluded.map((e) => `${e.recruitYear}-${e.no}`), ['2023-31']);
});

test('一口価格は720頭が公式、公式が別の馬を指す1頭（2023年No.41）だけ netkeiba', () => {
  const s = load();
  assert.deepEqual(s.priceSource, { official: 720, netkeibaFallback: 1 });
});

test('2019年募集の重賞馬は6頭（完全版）', () => {
  const s = load();
  assert.equal(s.gradeCounts.find((c) => c.year === 2019)!.total, 6);
  assert.equal(s.gradeWinners.filter((g) => g.recruitYear === 2019).length, 6);
});

/** 前提を1つ壊して、指定の文言で止まることを確かめる（崩す方向ごとに1件ずつ）。 */
function breaks(name: string, mutate: (s: WinUpRateStats) => void, pattern: RegExp) {
  test(`アサーション: ${name}`, () => {
    const s = load();
    mutate(s);
    assert.throws(() => assertWinUpRateClaims(s), pattern);
  });
}
const term = (s: WinUpRateStats, model: 'yearSex' | 'yearSexPrice', label: string) =>
  s.regression[model].terms.find((t) => t.label === label)!;

breaks('全体の年差が有意でなくなったら止まる', (s) => { s.tests.all.final.chiP = 0.06; }, /全体の年による差が有意でなくなった/);
breaks('3歳9月末の全体の年差が有意になったら止まる', (s) => { s.tests.all.sep3.chiP = 0.049; }, /3歳9月末にそろえた年による差が有意になった/);
breaks('牝の3歳9月末の年差が有意になったら止まる', (s) => { s.tests.female.sep3.chiP = 0.04; }, /牝の3歳9月末の年差が有意になった/);
breaks('回帰の募集年pが0.05を割ったら止まる', (s) => { term(s, 'yearSex', '募集年').p = 0.049; }, /0\.05〜0\.06の範囲を外れた/);
breaks('回帰の募集年pが0.065以上になったら止まる', (s) => { term(s, 'yearSex', '募集年').p = 0.07; }, /0\.05〜0\.06の範囲を外れた/);
breaks('傾向検定（3歳9月末）が0.05を割ったら止まる', (s) => { s.tests.all.sep3.trendP = 0.048; }, /傾向検定（3歳9月末）/);
breaks('年×性別の交互作用が出たら止まる', (s) => { s.regression.interaction.p = 0.2; }, /交互作用が出た/);
breaks('性別の効果が弱まったら止まる', (s) => { term(s, 'yearSex', '性別(牡)').p = 0.02; }, /性別の効果が弱まった/);
breaks('性別の効果の向きが逆になったら止まる', (s) => { term(s, 'yearSex', '性別(牡)').coef = -0.4; }, /向きが変わった/);
breaks('性別ごとの頭数が変わったら止まる', (s) => { s.totals.male.winUp = 189; }, /性別ごとの頭数が本文と違う/);
breaks('牝が高い年が増えたら止まる', (s) => { s.byYear[1].female.rate = 80; }, /牡が高い年の数が本文と違う/);
breaks('牡が高い年が減って牝が高いのが2017年でなくなったら止まる', (s) => { s.byYear[0].female.rate = 10; s.byYear[3].female.rate = 80; }, /牡が高い年の数が本文と違う/);
breaks('牝の2020年が3〜4割を外れたら止まる', (s) => { s.byYear[3].female.rate = 50; }, /2020年募集の牝が3〜4割でない/);
breaks('一口価格の効果が出たら止まる', (s) => { term(s, 'yearSexPrice', '一口価格(万円)').p = 0.2; }, /一口価格の効果が出た/);
breaks('性別だけそろえた率が観測とずれたら止まる', (s) => { s.standardized[2].sexOnly += 2; }, /1ポイント以上ずれた/);
breaks('2024年の7万円以下が増えたら止まる', (s) => { s.standardPopulation.priceTertiles.byYear[7].low = 25; }, /18頭・最少でない/);
breaks('最高が2018年でなくなったら止まる', (s) => { s.byYear[0].all.rate = 59.5; }, /最高が2018年でない/);
breaks('最小が2024年でなくなったら止まる', (s) => { s.byYear[7].all.rate = 45; s.byYear[3].all.rate = 41; }, /最小が2024年でない/);
breaks('6割以上の年が出たら止まる', (s) => { s.byYear[1].all.rate = 60; }, /4割台〜6割弱の範囲を外れた/);
breaks('4割未満の年が出たら止まる', (s) => { s.byYear[7].all.rate = 39.9; }, /4割台〜6割弱の範囲を外れた/);
breaks('性別×価格帯をそろえた最小が2024年でなくなったら止まる', (s) => { s.standardized[7].sexPrice = 50; }, /最小が2024年でない/);
breaks('デビュー到達率が89%を割ったら止まる', (s) => { s.byYear[3].all.debutRate = 88.9; }, /89%未満/);
breaks('デビュー到達率の開きが勝ち上がり率の開き以上になったら止まる', (s) => { s.byYear.forEach((b) => { b.all.debutWinUpRate = 50; }); }, /開き/);
breaks('2歳で勝った割合の最低が2021年でなくなったら止まる', (s) => { s.byYear[3].all.age2RateOfAll = 10; }, /最低が2021年でない/);
breaks('勝者中の2歳割合の最高が2024年でなくなったら止まる', (s) => { s.byYear[0].all.age2ShareOfWinners = 70; }, /最高が2024年/);
breaks('3歳以降に勝った馬が最少の年が2024年でなくなったら止まる', (s) => { s.byYear[0].all.age3plusWinUp = 10; }, /最少の年が2024年/);
breaks('重賞馬の頭数が表と食い違ったら止まる', (s) => { s.gradeWinners = s.gradeWinners.filter((g) => !(g.recruitYear === 2019 && g.name === 'モントライゼ')); }, /2019年の重賞馬: 表5頭≠集計6頭/);
breaks('本文の重賞馬が消えたら止まる', (s) => { s.gradeWinners = s.gradeWinners.filter((g) => g.name !== 'ナミュール'); }, /ナミュール/);
breaks('本文の重賞馬のレースが違ったら止まる', (s) => { s.gradeWinners.find((g) => g.name === 'ドゥレッツァ')!.gradeWins = ["23'皐月賞(G1)"]; }, /ドゥレッツァ/);

test('交互作用の尤度比検定は LRT≈6.088・df=7・p≈0.529', () => {
  const i = load().regression.interaction;
  assert.ok(Math.abs(i.lrt - 6.088) < 0.001);
  assert.equal(i.df, 7);
  assert.ok(Math.abs(i.p - 0.529) < 0.001);
});

test('性別ごとの合計は牡190/342・牝171/379、2024年の3歳以降の初勝利は17頭', () => {
  const s = load();
  assert.deepEqual([s.totals.male.winUp, s.totals.male.n, s.totals.female.winUp, s.totals.female.n], [190, 342, 171, 379]);
  assert.equal(s.byYear[7].all.age3plusWinUp, 17);
});

test('gradeWinnerRow: 表が読む列が実名つきで渡る', () => {
  const g = load().gradeWinners.find((x) => x.name === 'サートゥルナーリア')!;
  const row = gradeWinnerRow(g);
  assert.equal(row.displayName, 'サートゥルナーリア');
  assert.equal(row.recruitYear, 2017);
  assert.ok(row.gradeWins.some((w) => w.includes('皐月賞')));
});
