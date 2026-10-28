/**
 * デビュー時期の記事（`src/pages/articles/debut-timing.astro`）が読む集計値を作る。
 * 入力: recruits.json / win-splits.json / debut-weights.json / debut-dates-2023-2024.json /
 *       carrotclub-prices.json / .cache/netkeiba（重賞の完全版・戦績表）
 * 出力: analysis/data/debut-timing-stats.json（ページはこれだけを読む。検定はここで済ませる）
 *
 * 使い方: node scripts/build-debut-timing.mjs
 * 再集計時は、先に成績を取り直す: `fetch-win-splits.mjs`（win-splits.json）→ `fetch-debut-dates.mjs`（debut-dates-2023-2024.json）の順。
 * デビュー日の補完は starts>0 かどうかを win-splits.json の starts で判定しているので、この順でないと食い違う。
 * 元になった標準出力専用の集計は scripts/aggregate-debut-timing.mjs（区分は7つ。ここでは6つに統合）。
 *
 * 定義:
 *  - 勝ち上がり＝中央（JRA）で1勝以上。分母は募集馬全頭で、未出走の馬も含む（win-up-rate記事と同じ）。
 *  - 対象は2017〜2024年募集のうち netkeiba で成績を引けた721頭。外すのは netkeibaUrl が無い3頭（識別不能）と、
 *    募集中止とみなす2023年No.31（lib-excluded-recruits.mjs。win-up-rate記事と同じ定義を共有）。
 *  - デビューには地方競馬での初出走も含む。中央デビューのみに絞った率も別に出す（centralOnly）。
 *  - 年齢は競走馬年齢（デビュー年の西暦 − 生年。1月1日に加齢）。
 *  - 区分: 2歳8月まで（2歳5月以前の5頭を含む）/ 2歳9〜10月 / 2歳11〜12月 / 3歳1〜3月 / 3歳4月以降 / 未出走。
 *  - 検定は未出走を除いた5区分、基準＝2歳8月まで。
 *  - 一口価格はクラブ公式（carrotclub-prices.json・生年月日が一致したもの）、取れない馬だけ netkeiba の値。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { chiSquareTest, cochranArmitageTrendTest, logisticRegression } from './lib-stats.mjs';
import { fullGradeWins } from './lib-grade-wins.mjs';
import { isExcluded, EXCLUDED_RECRUITS } from './lib-excluded-recruits.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'analysis', 'data');
const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
const read = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

const recruits = read('recruits.json');
const splits = read('win-splits.json');
const prices = read('carrotclub-prices.json');
const debutByUrl = new Map([...read('debut-weights.json').results, ...read('debut-dates-2023-2024.json').results].map((r) => [r.netkeibaUrl, r]));
const splitByUrl = new Map(splits.results.map((r) => [r.netkeibaUrl, r]));
const priceByKey = new Map(prices.results.map((r) => [`${r.recruitYear}-${r.no}`, r]));

export const BUCKETS = ['2歳8月まで', '2歳9〜10月', '2歳11〜12月', '3歳1〜3月', '3歳4月以降', '未出走'];
const TIMED = BUCKETS.slice(0, 5);
const REF = BUCKETS[0];

function classify(dateStr, birthYear) {
  if (!dateStr) return '未出走';
  const age = Number(dateStr.slice(0, 4)) - birthYear;
  const month = Number(dateStr.slice(5, 7));
  if (age < 2 || (age === 2 && month <= 8)) return BUCKETS[0];
  if (age === 2 && month <= 10) return BUCKETS[1];
  if (age === 2) return BUCKETS[2];
  if (age === 3 && month <= 3) return BUCKETS[3];
  return BUCKETS[4];
}

function startsUpTo(netkeibaUrl, cutoff) {
  const id = netkeibaUrl.match(/horse\/([0-9a-z]+)/)?.[1];
  if (!id) return null;
  const p = join(ROOT, '.cache', 'netkeiba', `${createHash('sha1').update(`https://db.netkeiba.com/horse/result/${id}/`).digest('hex')}.html`);
  if (!existsSync(p)) return null;
  const tbody = readFileSync(p, 'utf8').match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbody) return 0;
  let n = 0;
  for (const tr of tbody[1].split('<tr>').slice(1)) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    const d = tds[0]?.match(/(\d{4})\/(\d{2})\/(\d{2})/);
    // 出走取消（着順「取」）・競走除外（「除」）・着順が空の行は走っていないので数えない（fetch-debut-dates.mjs と同じ判定）。
    const finish = (tds[11] ?? '').replace(/<[^>]+>/g, '').trim();
    if (!finish || finish === '取' || finish === '除') continue;
    if (d && `${d[1]}-${d[2]}-${d[3]}` <= cutoff) n++;
  }
  return n;
}

const median = (arr) => {
  const s = arr.filter((v) => v != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (x, n) => (n ? (100 * x) / n : null);

// ---------------------------------------------------------------- 母集団

const pool = [];
let priceFromOfficial = 0;
let priceFromNetkeiba = 0;
for (const r of recruits) {
  if (!YEARS.includes(r.recruitYear) || !r.netkeibaUrl || isExcluded(r)) continue;
  const s = splitByUrl.get(r.netkeibaUrl);
  const d = debutByUrl.get(r.netkeibaUrl);
  if (!s || !s.ok || !d) continue;
  if (r.sex !== '牡' && r.sex !== '牝') throw new Error(`性別が不明: ${r.recruitYear}-${r.no}`);
  const cc = priceByKey.get(`${r.recruitYear}-${r.no}`);
  let price = null;
  if (cc && cc.ok && cc.birthDateMatches && cc.pricePerShareManYen != null) { price = cc.pricePerShareManYen; priceFromOfficial++; }
  else if (r.pricePerShare != null) { price = r.pricePerShare; priceFromNetkeiba++; }
  const birthYear = Number(r.birthDate.slice(0, 4));
  const debutDate = d.debut ? d.debut.date.replaceAll('/', '-') : null;
  const starts = s.starts ?? 0;
  const startsToSep3 = startsUpTo(r.netkeibaUrl, `${birthYear + 3}-09-30`);
  if (startsToSep3 == null) throw new Error(`戦績キャッシュが無い: ${r.recruitYear}-${r.no}`);
  pool.push({
    recruitYear: r.recruitYear, no: r.no, rec: r, split: s, sex: r.sex, price,
    name: s.name ?? r.name, debutDate, region: d.debut ? d.debut.region : null, bucket: classify(debutDate, birthYear),
    starts, winUp: (starts === 0 ? 0 : (s.chuoWins ?? 0)) >= 1, startsToSep3,
  });
}
if (pool.some((p) => (p.starts === 0) !== (p.debutDate == null))) throw new Error('出走数とデビュー日が食い違う馬がいる');
if (pool.some((p) => p.price == null)) throw new Error('一口価格が取れない馬がいる');
if (pool.some((p) => (p.region == null) !== (p.debutDate == null) || (p.region != null && p.region !== '中央' && p.region !== '地方'))) throw new Error('デビューの中央/地方が取れない馬がいる');

// ---------------------------------------------------------------- 区分ごと

const cell = (g) => {
  const winUp = g.filter((p) => p.winUp).length;
  return { n: g.length, winUp, rate: pct(winUp, g.length) };
};
const buckets = BUCKETS.map((label) => {
  const g = pool.filter((p) => p.bucket === label);
  return {
    label,
    all: cell(g),
    male: cell(g.filter((p) => p.sex === '牡')),
    female: cell(g.filter((p) => p.sex === '牝')),
    gradeWinners: g.filter((p) => fullGradeWins(ROOT, p.rec.netkeibaUrl)?.length).length,
    startsToSep3Median: median(g.map((p) => p.startsToSep3)),
    priceMedianManYen: median(g.map((p) => p.price)),
  };
});
const totals = { all: cell(pool), male: cell(pool.filter((p) => p.sex === '牡')), female: cell(pool.filter((p) => p.sex === '牝')) };

// ---------------------------------------------------------------- 地方デビュー（初出走が地方競馬の馬）

const localDebut = pool.filter((p) => p.region === '地方');
const centralDebut = pool.filter((p) => p.region === '中央');
const localSummary = {
  n: localDebut.length,
  winUp: localDebut.filter((p) => p.winUp).length,
  byBucket: BUCKETS.slice(0, 5).map((label) => ({ label, n: localDebut.filter((p) => p.bucket === label).length })),
};
const centralOnly = {
  n: centralDebut.length,
  buckets: BUCKETS.slice(0, 5).map((label) => ({ label, ...cell(centralDebut.filter((p) => p.bucket === label)) })),
};

// ---------------------------------------------------------------- 検定（未出走を除く5区分・基準＝2歳8月まで）

const timed = pool.filter((p) => TIMED.includes(p.bucket));
const groups = TIMED.map((b, i) => {
  const g = timed.filter((p) => p.bucket === b);
  return { n: g.length, x: g.filter((p) => p.winUp).length, score: i + 1 };
});
const chi = chiSquareTest(groups.map((g) => [g.x, g.n - g.x]));
const ca = cochranArmitageTrendTest(groups);
const dummyLabels = TIMED.filter((b) => b !== REF);
const y = timed.map((p) => (p.winUp ? 1 : 0));
const pMean = timed.reduce((a, p) => a + p.price, 0) / timed.length;
function logit(X, labels) {
  const lr = logisticRegression(X, y);
  if (!lr.converged) throw new Error('ロジスティック回帰が収束しなかった');
  return {
    n: X.length,
    terms: labels.map((label, i) => ({ label, coef: lr.coef[i], se: lr.se[i], z: lr.z[i], p: lr.p[i], oddsRatio: Math.exp(lr.coef[i]), oddsRatioLo: Math.exp(lr.coef[i] - 1.96 * lr.se[i]), oddsRatioHi: Math.exp(lr.coef[i] + 1.96 * lr.se[i]) })),
  };
}
const dummies = (p) => dummyLabels.map((b) => (p.bucket === b ? 1 : 0));
const male = (p) => (p.sex === '牡' ? 1 : 0);
const tests = {
  chi: { chi2: chi.chi2, df: chi.df, p: chi.p, minExpected: chi.minExpected },
  trend: { z: ca.z, p: ca.p },
  regression: {
    sex: logit(timed.map((p) => [1, male(p), ...dummies(p)]), ['切片', '性別(牡)', ...dummyLabels]),
    sexPrice: logit(timed.map((p) => [1, male(p), p.price - pMean, ...dummies(p)]), ['切片', '性別(牡)', '一口価格(万円)', ...dummyLabels]),
  },
};

// ---------------------------------------------------------------- 重賞馬

const GRADE_ASCII = { I: '1', II: '2', III: '3' };
// netkeibaの戦績表はレース名を10文字で切る。切れた名前は下で正式名に直す（10文字ちょうどで終わる名前は
// 切れている可能性があるので、辞書にあるものだけ通す。正式名がそのまま10文字のものは同じ文字列を値にして確認済みとする）。
const RACE_NAME_FIX = {
  兵庫ゴールドトロフィ: '兵庫ゴールドトロフィー',
  スパーキングレディー: 'スパーキングレディーカップ',
  ブリーダーズゴールド: 'ブリーダーズゴールドカップ',
  夕刊フジオーシャンS: '夕刊フジオーシャンS',
  日刊スポシンザン記念: '日刊スポシンザン記念',
  東京スポーツ杯2歳S: '東京スポーツ杯2歳S',
  ラジオN杯京都2歳S: 'ラジオN杯京都2歳S',
  報知弥生ディープ記念: '報知弥生ディープ記念',
  レディスプレリュード: 'レディスプレリュード',
  JBCクラシック競走: 'JBCクラシック競走',
  マイルチャンピオンS: 'マイルチャンピオンS',
  KBSファンタジーS: 'KBSファンタジーS',
  フジTVスプリングS: 'フジTVスプリングS',
  '全日本2歳優駿【国際': '全日本2歳優駿',
  兵庫チャンピオンシッ: '兵庫チャンピオンシップ',
  ジャパンダートダービ: 'ジャパンダートダービー',
  'ダービー卿チャレンジ': 'ダービー卿チャレンジトロフィー',
};
const gradeLabel = (name) => {
  const m = name.match(/^(.*)\((G|Jpn)(I{1,3})\)$/);
  if (!m) throw new Error(`重賞名の形式が想定外: ${name}`);
  if ([...m[1]].length === 10 && !(m[1] in RACE_NAME_FIX)) throw new Error(`重賞名が10文字で切れている可能性（RACE_NAME_FIX に正式名を足す）: ${name}`);
  return `${RACE_NAME_FIX[m[1]] ?? m[1]}(${m[2]}${GRADE_ASCII[m[3]]})`;
};
const clsLabel = (c) => (c === 'JRA' ? '' : c === 'NAR' ? '〔地方〕' : '〔海外〕');
const gradeWinners = [];
for (const p of pool) {
  const wins = fullGradeWins(ROOT, p.rec.netkeibaUrl);
  if (wins === null) throw new Error(`重賞の完全版を引けない: ${p.name}`);
  if (!wins.length) continue;
  wins.sort((a, b) => a.date.localeCompare(b.date));
  gradeWinners.push({
    bucket: p.bucket,
    recruitYear: p.recruitYear,
    no: p.no,
    name: p.name,
    debutDate: p.debutDate,
    debutYm: p.debutDate.slice(0, 7),
    gradeWins: wins.map((w) => `${w.date.slice(2, 4)}'${gradeLabel(w.raceName)}${clsLabel(w.cls)}`),
  });
}
gradeWinners.sort((a, b) => BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket) || a.debutDate.localeCompare(b.debutDate));

// ---------------------------------------------------------------- 出力

const out = {
  _comment: 'scripts/build-debut-timing.mjs が作る。手で編集しない。debut-timing 記事が読む。',
  resultsFetchedAt: splits.fetchedAt,
  years: [YEARS[0], YEARS[YEARS.length - 1]],
  poolSize: pool.length,
  excluded: EXCLUDED_RECRUITS,
  priceSource: { official: priceFromOfficial, netkeibaFallback: priceFromNetkeiba },
  totals,
  localDebut: localSummary,
  centralOnly,
  buckets,
  tests,
  gradeWinners,
};
writeFileSync(join(DATA, 'debut-timing-stats.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`pool=${pool.length} price official=${priceFromOfficial} netkeiba=${priceFromNetkeiba} gradeWinners=${gradeWinners.length} regressionN=${tests.regression.sex.n}`);
for (const b of buckets) console.log(b.label, b.all.n, b.all.winUp, b.all.rate?.toFixed(1), `牡${b.male.rate?.toFixed(1)}(${b.male.n}) 牝${b.female.rate?.toFixed(1)}(${b.female.n})`, 'grade', b.gradeWinners, 'med出走', b.startsToSep3Median, 'price', b.priceMedianManYen);
console.log(JSON.stringify(tests.regression.sex.terms.map((t) => [t.label, +t.coef.toFixed(3), +t.p.toFixed(5)])));
console.log(JSON.stringify(tests.regression.sexPrice.terms.map((t) => [t.label, +t.coef.toFixed(3), +t.p.toFixed(5)])));
console.log(tests.chi, tests.trend);
console.log('localDebut', JSON.stringify(localSummary));
console.log('centralOnly', JSON.stringify(centralOnly.buckets.map((b) => [b.label, b.n, b.winUp, b.rate?.toFixed(1)])));
