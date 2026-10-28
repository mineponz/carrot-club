/**
 * 勝ち上がり率の記事（`src/pages/articles/win-up-rate.astro`）が読む集計値を作る。
 * 入力: recruits.json / win-splits.json / carrotclub-prices.json / .cache/netkeiba（重賞の完全版）
 * 出力: analysis/data/win-up-rate-stats.json（ページはこれだけを読む。統計検定はここで済ませる）
 *
 * 使い方: node scripts/build-win-up-rate.mjs
 *
 * 定義（本人決定・2026-10-22/23）:
 *  - 勝ち上がり＝中央（JRA）で1勝以上。分母は募集馬全頭で、未出走の馬も含む。
 *  - 対象は2017〜2024年募集。2025年募集は扱わない。
 *  - 一口価格はクラブ公式（carrotclub-prices.json・生年月日が一致したもの）。公式の id が別の馬を
 *    指している馬（2023年No.41）だけ netkeiba の値で補う。
 *  - 中央/地方の勝ち数を分けた成績は win-splits.json（race-results.json は既存記事の数字を
 *    動かさないため据え置き）。
 *  - 重賞は lib-grade-wins.mjs の完全版（netkeiba の全戦績テーブルを直接走査）。
 *
 * 母集団から外すもの（ここ1か所に集約。本文には詳細を書かない）:
 *  - EXCLUDED_RECRUITS: 募集中止とみなす馬。
 *  - netkeibaUrl が無い馬（2017年No.18・2018年No.21・2019年No.7。馬が登録されておらず成績を引けない）。
 *    これは従来の分析記事と同じ扱いで、v3 の usable（722頭）と同じ。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chiSquareTest, chiSquarePValue, cochranArmitageTrendTest, logisticRegression } from './lib-stats.mjs';
import { fullGradeWins } from './lib-grade-wins.mjs';
import { EXCLUDED_RECRUITS, isExcluded } from './lib-excluded-recruits.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'analysis', 'data');
export const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];

const read = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const recruits = read('recruits.json');
const splits = read('win-splits.json');
const prices = read('carrotclub-prices.json');

const splitByUrl = new Map(splits.results.map((r) => [r.netkeibaUrl, r]));
const priceByKey = new Map(prices.results.map((r) => [`${r.recruitYear}-${r.no}`, r]));

// ---------------------------------------------------------------- 母集団

const pool = [];
let priceFromOfficial = 0;
let priceFromNetkeiba = 0;
for (const r of recruits) {
  if (!YEARS.includes(r.recruitYear) || isExcluded(r)) continue;
  const s = r.netkeibaUrl ? splitByUrl.get(r.netkeibaUrl) : undefined;
  if (!s || !s.ok) continue;
  const cc = priceByKey.get(`${r.recruitYear}-${r.no}`);
  let price = null;
  if (cc && cc.ok && cc.birthDateMatches && cc.pricePerShareManYen != null) {
    price = cc.pricePerShareManYen;
    priceFromOfficial++;
  } else if (r.pricePerShare != null) {
    price = r.pricePerShare;
    priceFromNetkeiba++;
  }
  const starts = s.starts ?? 0;
  pool.push({
    recruitYear: r.recruitYear,
    no: r.no,
    recruitName: r.name,
    actualName: s.name,
    sex: r.sex,
    price,
    starts,
    chuoWins: starts === 0 ? 0 : (s.chuoWins ?? 0),
    firstChuoWin: starts === 0 ? null : s.firstChuoWin,
    rec: r,
    split: s,
  });
}
if (pool.some((p) => p.sex !== '牡' && p.sex !== '牝')) throw new Error('性別が不明な馬がいる');
if (pool.some((p) => p.price == null)) throw new Error('一口価格が取れない馬がいる');

const isWinUp = (p) => p.chuoWins >= 1;
/** 3歳9月末までに中央で勝ち上がっていたか。 */
function winUpBySep3(p) {
  const w = p.firstChuoWin;
  if (!w || w.ageYears == null) return false;
  if (w.ageYears < 3) return true;
  if (w.ageYears === 3) return Number(w.date.slice(5, 7)) <= 9;
  return false;
}
/** 中央の初勝利を2歳のうちに挙げたか。 */
const winUpAt2 = (p) => !!p.firstChuoWin && p.firstChuoWin.ageYears != null && p.firstChuoWin.ageYears <= 2;

const pct = (x, n) => (n ? (100 * x) / n : null);
function cell(group) {
  const n = group.length;
  const winUp = group.filter(isWinUp).length;
  const debut = group.filter((p) => p.starts > 0).length;
  const sep3 = group.filter(winUpBySep3).length;
  const age2 = group.filter(winUpAt2).length;
  return {
    n,
    winUp,
    rate: pct(winUp, n),
    debut,
    debutRate: pct(debut, n),
    sep3WinUp: sep3,
    sep3Rate: pct(sep3, n),
    age2WinUp: age2,
    age2RateOfAll: pct(age2, n),
    age2ShareOfWinners: pct(age2, winUp),
    /** デビューした馬のうち勝ち上がった割合 */
    debutWinUpRate: pct(winUp, debut),
    /** 中央の初勝利が3歳以降だった馬（勝ち上がった馬のうち2歳で勝っていない馬） */
    age3plusWinUp: winUp - age2,
    age3plusRate: pct(winUp - age2, n),
  };
}
const byYear = YEARS.map((year) => {
  const sub = pool.filter((p) => p.recruitYear === year);
  return {
    year,
    all: cell(sub),
    male: cell(sub.filter((p) => p.sex === '牡')),
    female: cell(sub.filter((p) => p.sex === '牝')),
  };
});
const totals = { all: cell(pool), male: cell(pool.filter((p) => p.sex === '牡')), female: cell(pool.filter((p) => p.sex === '牝')) };

// ---------------------------------------------------------------- 検定

function yearTests(data, winFn) {
  const groups = YEARS.map((y) => {
    const sub = data.filter((p) => p.recruitYear === y);
    return { n: sub.length, x: sub.filter(winFn).length, score: y };
  });
  const chi = chiSquareTest(groups.map((g) => [g.x, g.n - g.x]));
  const ca = cochranArmitageTrendTest(groups);
  return { chi2: chi.chi2, df: chi.df, chiP: chi.p, minExpected: chi.minExpected, trendZ: ca.z, trendP: ca.p };
}
const tests = {};
for (const [label, data] of [
  ['all', pool],
  ['male', pool.filter((p) => p.sex === '牡')],
  ['female', pool.filter((p) => p.sex === '牝')],
]) {
  tests[label] = { final: yearTests(data, isWinUp), sep3: yearTests(data, winUpBySep3) };
}

function logit(X, y, labels) {
  const lr = logisticRegression(X, y);
  if (!lr.converged) throw new Error('ロジスティック回帰が収束しなかった');
  return {
    converged: lr.converged,
    n: X.length,
    terms: labels.map((label, i) => ({ label, coef: lr.coef[i], se: lr.se[i], z: lr.z[i], p: lr.p[i], oddsRatio: Math.exp(lr.coef[i]) })),
  };
}
const yMean = pool.reduce((a, p) => a + p.recruitYear, 0) / pool.length;
const pMean = pool.reduce((a, p) => a + p.price, 0) / pool.length;
const yWin = pool.map((p) => (isWinUp(p) ? 1 : 0));
const regression = {
  /** 募集年（中心化）＋性別（牡=1） */
  yearSex: logit(pool.map((p) => [1, p.recruitYear - yMean, p.sex === '牡' ? 1 : 0]), yWin, ['切片', '募集年', '性別(牡)']),
  /** 募集年＋性別＋一口価格（万円） */
  yearSexPrice: logit(
    pool.map((p) => [1, p.recruitYear - yMean, p.sex === '牡' ? 1 : 0, p.price - pMean]),
    yWin,
    ['切片', '募集年', '性別(牡)', '一口価格(万円)'],
  ),
};

// 年×性別の交互作用（尤度比検定）: 主効果モデル（年ダミー＋性別）と、年ダミー×性別を足したモデルの比較
{
  const dummies = (p) => YEARS.slice(1).map((y) => (p.recruitYear === y ? 1 : 0));
  const male = (p) => (p.sex === '牡' ? 1 : 0);
  const main = logisticRegression(pool.map((p) => [1, ...dummies(p), male(p)]), yWin);
  const full = logisticRegression(pool.map((p) => [1, ...dummies(p), male(p), ...dummies(p).map((d) => d * male(p))]), yWin);
  if (!main.converged || !full.converged) throw new Error('交互作用の回帰が収束しなかった');
  const lrt = 2 * (full.logLik - main.logLik);
  const df = YEARS.length - 1;
  regression.interaction = { lrt, df, p: chiSquarePValue(lrt, df) };
}

// ---------------------------------------------------------------- 標準化

const maleRatio = pool.filter((p) => p.sex === '牡').length / pool.length;
function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}
const sortedPrices = pool.map((p) => p.price).sort((a, b) => a - b);
const bound1 = quantile(sortedPrices, 1 / 3);
const bound2 = quantile(sortedPrices, 2 / 3);
const tertile = (p) => (p.price <= bound1 ? '低' : p.price <= bound2 ? '中' : '高');
const strata = ['牡', '牝'].flatMap((sex) => ['低', '中', '高'].map((t) => ({ sex, t })));
const weights = strata.map((s) => ({ ...s, n: pool.filter((p) => p.sex === s.sex && tertile(p) === s.t).length }));
for (const w of weights) w.weight = w.n / pool.length;

const standardized = YEARS.map((year) => {
  const sub = pool.filter((p) => p.recruitYear === year);
  const male = sub.filter((p) => p.sex === '牡');
  const female = sub.filter((p) => p.sex === '牝');
  const sexOnly = (male.filter(isWinUp).length / male.length) * maleRatio + (female.filter(isWinUp).length / female.length) * (1 - maleRatio);
  let sum = 0;
  let used = 0;
  let cells = 0;
  for (const w of weights) {
    const c = sub.filter((p) => p.sex === w.sex && tertile(p) === w.t);
    if (!c.length) continue;
    cells++;
    sum += (c.filter(isWinUp).length / c.length) * w.weight;
    used += w.weight;
  }
  return {
    year,
    observed: pct(sub.filter(isWinUp).length, sub.length),
    sexOnly: 100 * sexOnly,
    sexPrice: (100 * sum) / used,
    cellsUsed: cells,
  };
});
const priceTertiles = {
  low: { max: bound1 },
  mid: { max: bound2 },
  byYear: YEARS.map((year) => {
    const sub = pool.filter((p) => p.recruitYear === year);
    return { year, low: sub.filter((p) => tertile(p) === '低').length, mid: sub.filter((p) => tertile(p) === '中').length, high: sub.filter((p) => tertile(p) === '高').length };
  }),
};

// ---------------------------------------------------------------- 重賞（完全版）

const GRADE_ASCII = { I: '1', II: '2', III: '3' };
// netkeibaの戦績表はレース名を10字前後で切るため、切れたものだけ正式名に直す（実データで確認した分のみ）。
const RACE_NAME_FIX = {
  '全日本2歳優駿【国際': '全日本2歳優駿',
  兵庫チャンピオンシッ: '兵庫チャンピオンシップ',
  ジャパンダートダービ: 'ジャパンダートダービー',
};
const gradeLabel = (name) => {
  const m = name.match(/^(.*)\((G|Jpn)(I{1,3})\)$/);
  if (!m) throw new Error(`重賞名の形式が想定外: ${name}`);
  return `${RACE_NAME_FIX[m[1]] ?? m[1]}(${m[2]}${GRADE_ASCII[m[3]]})`;
};
const clsLabel = (cls) => (cls === 'JRA' ? 'JRA' : cls === 'NAR' ? '地方' : '海外');

const gradeWinners = [];
for (const p of pool) {
  const wins = fullGradeWins(ROOT, p.rec.netkeibaUrl);
  if (wins === null) throw new Error(`重賞の完全版を引けない（netkeibaキャッシュ無し）: ${p.recruitName}`);
  if (!wins.length) continue;
  wins.sort((a, b) => a.date.localeCompare(b.date));
  const classes = [...new Set(wins.map((w) => w.cls))];
  const hasJra = classes.includes('JRA');
  gradeWinners.push({
    recruitYear: p.recruitYear,
    no: p.no,
    name: p.actualName ?? p.recruitName,
    sex: p.sex,
    // 区分: JRAの重賞を勝ったか、地方・海外の重賞だけか。両方勝った馬は「JRA」側に数え、表では併記する。
    kind: hasJra ? 'JRA' : '地方・海外',
    kindLabel: hasJra && classes.length > 1 ? `JRA・${classes.filter((c) => c !== 'JRA').map(clsLabel).join('・')}` : hasJra ? 'JRA' : classes.map(clsLabel).join('・'),
    // JRA以外のレースだけ末尾に区分を付ける（表の見出し脇の注記と対応）
    gradeWins: wins.map((w) => `${w.date.slice(2, 4)}'${gradeLabel(w.raceName)}${w.cls === 'JRA' ? '' : `〔${clsLabel(w.cls)}〕`}`),
    gradeRaces: wins.map((w) => ({ date: w.date, raceName: gradeLabel(w.raceName), track: w.track, cls: w.cls })),
    starts: p.starts,
    wins: p.split.wins ?? 0,
    totalPrizeManYen: (p.split.chuoPrizeManYen ?? 0) + (p.split.chihoPrizeManYen ?? 0),
    height: p.rec.height ?? null,
    chestGirth: p.rec.chestGirth ?? null,
    weight: p.rec.weight ?? null,
    damAge: p.rec.damAge ?? null,
    birthDate: p.rec.birthDate ?? null,
    pricePerShare: p.price,
  });
}
gradeWinners.sort((a, b) => a.recruitYear - b.recruitYear || Number(a.no) - Number(b.no));
const gradeCounts = YEARS.map((year) => {
  const sub = gradeWinners.filter((g) => g.recruitYear === year);
  return { year, total: sub.length, jra: sub.filter((g) => g.kind === 'JRA').length, nonJraOnly: sub.filter((g) => g.kind !== 'JRA').length };
});

// ---------------------------------------------------------------- 出力

const out = {
  _comment: 'scripts/build-win-up-rate.mjs が作る。手で編集しない。win-up-rate 記事が読む。',
  resultsFetchedAt: splits.fetchedAt,
  years: YEARS,
  excluded: EXCLUDED_RECRUITS,
  poolSize: pool.length,
  priceSource: { official: priceFromOfficial, netkeibaFallback: priceFromNetkeiba },
  totals,
  byYear,
  tests,
  regression,
  standardized,
  standardPopulation: { maleRatio, weights, priceTertiles },
  gradeCounts,
  gradeWinners,
};
writeFileSync(join(DATA, 'win-up-rate-stats.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`pool=${pool.length} price official=${priceFromOfficial} netkeiba=${priceFromNetkeiba} gradeWinners=${gradeWinners.length}`);
