/**
 * 勝ち上がり率の記事（`src/pages/articles/win-up-rate.astro`）の型と、ビルド時アサーション。
 * 集計値そのものは `scripts/build-win-up-rate.mjs` が `analysis/data/win-up-rate-stats.json` に書く。
 *
 * ここの `assertWinUpRateClaims` は本文の主張の「前提」を固定する。成績を取り直して数字が動き、
 * 前提が崩れたら、本文を直すまでビルドを止める（本文の言い回しだけが古く残らないように）。
 * 閾値は2023年No.31を分母から外したあとの実測値で決めた（2026-10-23）。実測値は各項目のコメント。
 */
import type { RecruitWithResult } from './analysis-data.ts';

export interface RateCell {
  n: number;
  winUp: number;
  rate: number;
  debut: number;
  debutRate: number;
  sep3WinUp: number;
  sep3Rate: number;
  age2WinUp: number;
  age2RateOfAll: number;
  age2ShareOfWinners: number;
  debutWinUpRate: number;
  age3plusWinUp: number;
  age3plusRate: number;
}
export interface YearTests {
  chi2: number;
  df: number;
  chiP: number;
  minExpected: number;
  trendZ: number;
  trendP: number;
}
export interface RegressionTerm {
  label: string;
  coef: number;
  se: number;
  z: number;
  p: number;
  oddsRatio: number;
}
export interface GradeWinnerRecord {
  recruitYear: number;
  no: string;
  name: string;
  sex: '牡' | '牝';
  kind: 'JRA' | '地方・海外';
  kindLabel: string;
  gradeWins: string[];
  starts: number;
  wins: number;
  totalPrizeManYen: number;
  height: number | null;
  chestGirth: number | null;
  weight: number | null;
  damAge: number | null;
  birthDate: string | null;
  pricePerShare: number;
}
export interface WinUpRateStats {
  resultsFetchedAt: string;
  years: number[];
  excluded: { recruitYear: number; no: string; reason: string }[];
  poolSize: number;
  priceSource: { official: number; netkeibaFallback: number };
  totals: { all: RateCell; male: RateCell; female: RateCell };
  byYear: { year: number; all: RateCell; male: RateCell; female: RateCell }[];
  tests: Record<'all' | 'male' | 'female', { final: YearTests; sep3: YearTests }>;
  regression: {
    yearSex: { n: number; terms: RegressionTerm[] };
    yearSexPrice: { n: number; terms: RegressionTerm[] };
    /** 年×性別の交互作用（尤度比検定） */
    interaction: { lrt: number; df: number; p: number };
  };
  standardized: { year: number; observed: number; sexOnly: number; sexPrice: number; cellsUsed: number }[];
  standardPopulation: {
    maleRatio: number;
    weights: { sex: string; t: string; n: number; weight: number }[];
    priceTertiles: {
      low: { max: number };
      mid: { max: number };
      byYear: { year: number; low: number; mid: number; high: number }[];
    };
  };
  gradeCounts: { year: number; total: number; jra: number; nonJraOnly: number }[];
  gradeWinners: GradeWinnerRecord[];
}

/** 重賞馬の頭数（募集年ごと）。表の根拠として固定する。 */
export const EXPECTED_GRADE_COUNTS = [12, 6, 6, 4, 6, 4, 3, 4];
/** 年ごとの母数（2023年はNo.31を除いた95頭）。 */
export const EXPECTED_YEAR_N = [84, 83, 86, 92, 91, 94, 95, 96];

const term = (stats: WinUpRateStats, model: 'yearSex' | 'yearSexPrice', label: string): RegressionTerm => {
  const t = stats.regression[model].terms.find((x) => x.label === label);
  if (!t) throw new Error(`[win-up-rate] 回帰の項が無い: ${model}/${label}`);
  return t;
};

/** 前提が崩れていたら、崩れた項目をすべて並べて throw する。 */
export function assertWinUpRateClaims(stats: WinUpRateStats): void {
  const failures: string[] = [];
  const check = (ok: boolean, msg: string) => {
    if (!ok) failures.push(msg);
  };
  const f = (v: number) => v.toFixed(4);

  // 母集団（2023年は95頭＝No.31を外した値）
  check(
    JSON.stringify(stats.byYear.map((b) => b.all.n)) === JSON.stringify(EXPECTED_YEAR_N),
    `年ごとの母数が想定と違う: ${stats.byYear.map((b) => b.all.n).join(',')}`,
  );
  check(
    stats.byYear.every((b) => b.male.n + b.female.n === b.all.n),
    '牡+牝が全体の頭数と合わない',
  );
  check(
    stats.excluded.some((e) => e.recruitYear === 2023 && e.no === '31'),
    '2023年No.31の除外が記録に無い',
  );

  const all = stats.byYear.map((b) => b.all);
  const year = (y: number) => stats.byYear.find((b) => b.year === y)!;

  // 本文: 「この上下がたまたまか調べると p=0.038」「3歳9月末にそろえると0.061で、差があるとまでは言えない」
  // （実測 全体の年差 カイ二乗 p=0.0384／3歳9月末 p=0.0607）。どちらの側も固定する。
  check(stats.tests.all.final.chiP < 0.05, `全体の年による差が有意でなくなった: p=${f(stats.tests.all.final.chiP)}`);
  check(stats.tests.all.sep3.chiP > 0.05, `3歳9月末にそろえた年による差が有意になった: p=${f(stats.tests.all.sep3.chiP)}`);
  // 牝も3歳9月末にそろえると境目の上（実測 p=0.0669）
  check(stats.tests.female.sep3.chiP > 0.05, `牝の3歳9月末の年差が有意になった: p=${f(stats.tests.female.sep3.chiP)}`);

  // 本文: 「新しい年ほど下がっているかを調べてもp=0.05〜0.06」。回帰（性別をそろえた／価格も入れた）と
  // 傾向検定（現在／3歳9月末）はすべて 0.05 より上・0.065 未満（実測 0.0594 / 0.0533 / 0.0615 / 0.0520）。
  const trendPs: [string, number][] = [
    ['回帰（年＋性別）', term(stats, 'yearSex', '募集年').p],
    ['回帰（年＋性別＋価格）', term(stats, 'yearSexPrice', '募集年').p],
    ['傾向検定（現在）', stats.tests.all.final.trendP],
    ['傾向検定（3歳9月末）', stats.tests.all.sep3.trendP],
  ];
  for (const [name, p] of trendPs) check(p > 0.05 && p < 0.065, `${name}の募集年pが0.05〜0.06の範囲を外れた: p=${f(p)}`);

  // 本文: 年ごとに動き方が違うとまでは言えない（交互作用 LRT p=0.53）。実測 0.5295
  check(stats.regression.interaction.p > 0.3, `年×性別の交互作用が出た: p=${f(stats.regression.interaction.p)}`);
  // 本文: 牡牝の差は偶然では説明しにくい（p=0.005）。実測 0.0050
  const sexP = term(stats, 'yearSex', '性別(牡)');
  check(sexP.p < 0.01 && sexP.coef > 0, `性別の効果が弱まった／向きが変わった: p=${f(sexP.p)}`);
  // 本文: 全期間で牡55.6%（342頭中190頭）・牝45.1%（379頭中171頭）
  const tm = stats.totals.male;
  const tf = stats.totals.female;
  check(tm.winUp === 190 && tm.n === 342 && tf.winUp === 171 && tf.n === 379, `性別ごとの頭数が本文と違う: 牡${tm.winUp}/${tm.n} 牝${tf.winUp}/${tf.n}`);
  // 本文: 8年のうち7年で牡が高く、牝が高いのは2017年募集だけ
  const femaleHigher = stats.byYear.filter((b) => b.female.rate > b.male.rate).map((b) => b.year);
  check(femaleHigher.length === 1 && femaleHigher[0] === 2017, `牡が高い年の数が本文と違う（牝が高い年: ${femaleHigher.join(',')}）`);
  // 本文: 牝は2020・2021・2022・2024年募集で3〜4割
  for (const y of [2020, 2021, 2022, 2024]) {
    const r = year(y).female.rate;
    check(r >= 30 && r < 45, `${y}年募集の牝が3〜4割でない: ${r.toFixed(1)}%`);
  }

  // 本文: 一口価格の効果はほとんど無い（p=0.65）。実測 0.6454
  const price = term(stats, 'yearSexPrice', '一口価格(万円)').p;
  check(price > 0.3, `一口価格の効果が出た: p=${f(price)}`);
  // 本文: 牡と牝の割合だけそろえた率は実際の率とほぼ同じ
  for (const s of stats.standardized) check(Math.abs(s.sexOnly - s.observed) < 1, `${s.year}年: 性別だけそろえた率が観測と1ポイント以上ずれた`);
  // 本文: 2024年募集は7万円以下が少ない（18頭・8年で最少）
  const low2024 = stats.standardPopulation.priceTertiles.byYear.find((t) => t.year === 2024)!.low;
  check(low2024 === 18 && stats.standardPopulation.priceTertiles.byYear.every((t) => t.low >= low2024), `2024年募集の7万円以下が18頭・最少でない: ${low2024}頭`);
  check(stats.standardPopulation.priceTertiles.low.max === 7, '価格帯の境界（7万円）が変わった');

  // 本文: 最高は2018年募集59.0%・最低は2024年募集40.6%。どの年も4割台から6割弱
  const max = all.reduce((a, b, i) => (b.rate > all[a].rate ? i : a), 0);
  const min = all.reduce((a, b, i) => (b.rate < all[a].rate ? i : a), 0);
  check(stats.years[max] === 2018, `勝ち上がり率の最高が2018年でない: ${stats.years[max]}年`);
  check(stats.years[min] === 2024, `勝ち上がり率の最小が2024年でない: ${stats.years[min]}年`);
  check(all.every((c) => c.rate >= 40 && c.rate < 60), '勝ち上がり率が4割台〜6割弱の範囲を外れた年がある');
  // 本文: 2020・2021年募集で4割台に落ち、2023年募集で戻り、2024年募集でまた下がる
  check(year(2020).all.rate < 45 && year(2021).all.rate < 45, '2020・2021年募集が4割台前半でない');
  check(year(2023).all.rate > year(2022).all.rate && year(2024).all.rate < year(2023).all.rate, '2023年に戻り2024年に下がる形でなくなった');
  // 3歳9月末にそろえても2024年が最小（実測 2024年40.6%、2021年40.7%と1頭差。同率は許す）
  const s2024 = year(2024).all.sep3Rate;
  check(all.every((c) => c.sep3Rate >= s2024), `3歳9月末時点で2024年が最小でない: 2024年${s2024.toFixed(1)}%`);
  // 性別と価格帯をそろえても2024年が最小（実測 35.0%）
  const stdMin = stats.standardized.reduce((a, b) => (b.sexPrice < a.sexPrice ? b : a));
  check(stdMin.year === 2024, `性別×価格帯をそろえた率の最小が2024年でない: ${stdMin.year}年`);
  check(stats.standardized.every((s) => s.cellsUsed === 6), '性別×価格帯の層が埋まっていない年がある');

  // 本文: デビュー到達率は89〜98%（実測 89.1〜97.9%）。年ごとの開きはデビューした馬の勝ち上がり率の開きより小さい
  for (const b of stats.byYear) check(b.all.debutRate >= 89, `${b.year}年のデビュー到達率が89%未満: ${b.all.debutRate.toFixed(1)}%`);
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  const debutSpread = spread(all.map((c) => c.debutRate));
  const condSpread = spread(all.map((c) => c.debutWinUpRate));
  check(debutSpread < condSpread, `デビュー到達率の開き${debutSpread.toFixed(1)}が、デビュー馬の勝ち上がり率の開き${condSpread.toFixed(1)}以上になった`);

  // 本文: 2歳で勝った割合は2021年募集が最低（15.4%）。勝者中の2歳割合は2021年が最低・2024年が最高
  const age2Min = all.reduce((a, b, i) => (b.age2RateOfAll < all[a].age2RateOfAll ? i : a), 0);
  check(stats.years[age2Min] === 2021, `2歳で勝った割合の最低が2021年でない: ${stats.years[age2Min]}年`);
  const shareMin = all.reduce((a, b, i) => (b.age2ShareOfWinners < all[a].age2ShareOfWinners ? i : a), 0);
  const shareMax = all.reduce((a, b, i) => (b.age2ShareOfWinners > all[a].age2ShareOfWinners ? i : a), 0);
  check(stats.years[shareMin] === 2021 && stats.years[shareMax] === 2024, '勝者中の2歳割合の最低が2021年・最高が2024年でなくなった');
  // 本文: 3歳以降に初勝利した馬は2024年募集が17頭（17.7%）で最少
  const a3 = all.reduce((a, b, i) => (b.age3plusWinUp < all[a].age3plusWinUp ? i : a), 0);
  check(stats.years[a3] === 2024 && year(2024).all.age3plusWinUp === 17, `3歳以降に勝った馬が最少の年が2024年（17頭）でない: ${stats.years[a3]}年`);

  // 重賞馬の頭数は年ごとに表と一致（2019年は6頭）
  for (const c of stats.gradeCounts) {
    const rows = stats.gradeWinners.filter((g) => g.recruitYear === c.year);
    const i = stats.years.indexOf(c.year);
    check(rows.length === c.total, `${c.year}年の重賞馬: 表${rows.length}頭≠集計${c.total}頭`);
    check(c.total === EXPECTED_GRADE_COUNTS[i], `${c.year}年の重賞馬が想定と違う: ${c.total}頭（想定${EXPECTED_GRADE_COUNTS[i]}頭）`);
    check(c.jra + c.nonJraOnly === c.total, `${c.year}年のJRA+地方・海外の内訳が合計と合わない`);
    check(rows.filter((g) => g.kind === 'JRA').length === c.jra, `${c.year}年のJRA重賞馬の頭数が表と合わない`);
  }
  // 本文で名前を挙げた重賞馬（募集年・勝ったレース）
  const NAMED: [string, number, string][] = [
    ['ドゥレッツァ', 2021, '菊花賞'],
    ['タスティエーラ', 2021, '東京優駿'],
    ['ナミュール', 2020, 'マイルチャンピオンS'],
    ['キラーアビリティ', 2020, 'ホープフルS'],
    ['サートゥルナーリア', 2017, 'ホープフルS'],
    ['クリソベリル', 2017, 'チャンピオンズC'],
    ['マルシュロレーヌ', 2017, 'BCディスタフ'],
  ];
  for (const [name, y, race] of NAMED) {
    const g = stats.gradeWinners.find((x) => x.name === name);
    check(!!g && g.recruitYear === y && g.gradeWins.some((w) => w.includes(race)), `${name}（${y}年募集・${race}）が重賞馬の表と合わない`);
  }
  // 本文: 勝ち上がり率が低い年（2021年42.9%・2020年42.4%）
  check(year(2021).all.rate.toFixed(1) === '42.9' && year(2020).all.rate.toFixed(1) === '42.4', '2021・2020年募集の率が本文（42.9%・42.4%）と違う');

  if (failures.length > 0) {
    throw new Error(`[win-up-rate] 本文の前提が崩れた。本文と閾値を見直す:\n- ${failures.join('\n- ')}`);
  }
}

/** 重賞馬の表（GradeWinnerTable）に渡す形にする。名前は実名。 */
export function gradeWinnerRow(g: GradeWinnerRecord): RecruitWithResult {
  return {
    recruitYear: g.recruitYear,
    no: g.no,
    recruitName: g.name,
    displayName: g.name,
    realName: g.name,
    sex: g.sex,
    birthDate: g.birthDate,
    height: g.height,
    chestGirth: g.chestGirth,
    weight: g.weight,
    damAge: g.damAge,
    pricePerShare: g.pricePerShare,
    gradeWins: g.gradeWins,
    starts: g.starts,
    wins: g.wins,
    totalPrizeManYen: g.totalPrizeManYen,
  } as unknown as RecruitWithResult;
}
