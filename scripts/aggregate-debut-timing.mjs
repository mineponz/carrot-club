/**
 * 分析記事「デビュー時期と勝ち上がり」（[[20261027-debut-timing-win-up-article]]）のための集計。
 * 判断・解釈は行わず、数値を算出して標準出力に出すだけ（ファイル書き込みなし。commit/pushもしない）。
 *
 * 対象: 2017〜2024年募集でnetkeibaUrl・sex・birthDateが揃っている馬（722頭。recruits.json全体は
 * 725頭だが、3頭はnetkeibaUrl自体が無く識別不能なため除外。詳細は本スクリプトの「データ突合」出力）。
 *
 * デビュー日: 2017〜2022年募集は`debut-weights.json`（既存・読むだけ）、2023〜2024年募集は
 * `debut-dates-2023-2024.json`（本タスクで新規取得）。
 * 勝ち上がり（中央1勝以上）・中央賞金: `win-splits.json`（既存・読むだけ）の`chuoWins`/`chuoPrizeManYen`。
 * 重賞勝ち: `lib-grade-wins.mjs`の`fullGradeWins`（race-results.jsonの`gradeWins`欄のHTMLコメント
 * 欠落バグを修正した完全版。win-up-rate記事の最終版と同じ判定）。
 * 年齢: 競走馬年齢（デビュー年の西暦 − 生年。JRAの数え方＝1月1日に加齢、生まれた年を0歳とする）。
 *
 * 使い方: node scripts/aggregate-debut-timing.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { chiSquareTest, cochranArmitageTrendTest, logisticRegression } from './lib-stats.mjs';
import { fullGradeWins } from './lib-grade-wins.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];

const recruits = JSON.parse(readFileSync(join(ROOT, 'analysis', 'data', 'recruits.json'), 'utf8'));
const debutWeights = JSON.parse(readFileSync(join(ROOT, 'analysis', 'data', 'debut-weights.json'), 'utf8'));
const debutDates2324 = JSON.parse(
  readFileSync(join(ROOT, 'analysis', 'data', 'debut-dates-2023-2024.json'), 'utf8'),
);
const winSplits = JSON.parse(readFileSync(join(ROOT, 'analysis', 'data', 'win-splits.json'), 'utf8'));

const debutByUrl = new Map(
  [...debutWeights.results, ...debutDates2324.results].map((r) => [r.netkeibaUrl, r]),
);
const winSplitByUrl = new Map(winSplits.results.map((r) => [r.netkeibaUrl, r]));

function median(arr) {
  const s = [...arr].filter((v) => v != null).sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function mean(arr) {
  const s = arr.filter((v) => v != null);
  if (s.length === 0) return null;
  return s.reduce((a, b) => a + b, 0) / s.length;
}

// ---------------------------------------------------------------- データ突合

console.log('## データ突合\n');
const poolAll2017_2024 = recruits.filter((r) => r.recruitYear >= 2017 && r.recruitYear <= 2024);
const noUrl = poolAll2017_2024.filter((r) => !r.netkeibaUrl);
console.log(`recruits.json 2017〜2024年募集: ${poolAll2017_2024.length}頭`);
console.log(
  `  netkeibaUrl無し（識別不能・以降の集計から除外）: ${noUrl.length}頭 ... ${noUrl
    .map((r) => `${r.recruitYear}年No.${r.no}「${r.name}」`)
    .join(' / ')}`,
);

const poolUrl = poolAll2017_2024.filter((r) => r.netkeibaUrl);
console.log(`netkeibaUrlあり: ${poolUrl.length}頭`);

const noWinSplit = poolUrl.filter((r) => !winSplitByUrl.has(r.netkeibaUrl));
console.log(`  win-splits.jsonに無し: ${noWinSplit.length}頭 ... ${noWinSplit.map((r) => `${r.recruitYear}年No.${r.no}`).join(' / ')}`);

const noDebutEntry = poolUrl.filter((r) => winSplitByUrl.has(r.netkeibaUrl) && !debutByUrl.has(r.netkeibaUrl));
console.log(`  win-splits.jsonにはあるがdebut-weights/debut-datesに無し: ${noDebutEntry.length}頭 ... ${noDebutEntry.map((r) => `${r.recruitYear}年No.${r.no}`).join(' / ')}`);

const startsPositiveNoDebut = poolUrl.filter((r) => {
  const w = winSplitByUrl.get(r.netkeibaUrl);
  const d = debutByUrl.get(r.netkeibaUrl);
  return w && (w.starts ?? 0) > 0 && d && !d.debut;
});
console.log(`  starts>0なのにデビュー日なし（取得失敗）: ${startsPositiveNoDebut.length}頭 ... ${startsPositiveNoDebut.map((r) => `${r.recruitYear}年No.${r.no}`).join(' / ')}`);

const poolFinal = poolUrl.filter((r) => winSplitByUrl.has(r.netkeibaUrl) && debutByUrl.has(r.netkeibaUrl));
console.log(`集計に使う母数（recruits×win-splits×debut情報の3点が揃った頭数）: ${poolFinal.length}頭`);

// ---------------------------------------------------------------- 区分分け

const BUCKET_ORDER = ['2歳5月以前', '2歳6〜8月', '2歳9〜10月', '2歳11〜12月', '3歳1〜3月', '3歳4月以降', '未出走'];
const TIMING_BUCKETS = ['2歳5月以前', '2歳6〜8月', '2歳9〜10月', '2歳11〜12月', '3歳1〜3月', '3歳4月以降'];

function classifyBucket(debutDateStr, birthYear) {
  if (!debutDateStr) return '未出走';
  const year = Number(debutDateStr.slice(0, 4));
  const month = Number(debutDateStr.slice(5, 7));
  const ageYears = year - birthYear;
  if (ageYears <= 2 && month <= 5) return '2歳5月以前';
  if (ageYears === 2 && month >= 6 && month <= 8) return '2歳6〜8月';
  if (ageYears === 2 && month >= 9 && month <= 10) return '2歳9〜10月';
  if (ageYears === 2 && month >= 11 && month <= 12) return '2歳11〜12月';
  if (ageYears === 3 && month >= 1 && month <= 3) return '3歳1〜3月';
  if ((ageYears === 3 && month >= 4) || ageYears >= 4) return '3歳4月以降';
  return `不明区分(age=${ageYears},month=${month})`;
}

// ---------------------------------------------------------------- 3歳9月末までの出走数（打ち切り対策）

function cacheHtml(url) {
  const hash = createHash('sha1').update(url).digest('hex');
  const p = join(ROOT, '.cache', 'netkeiba', `${hash}.html`);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

function startsUpToCutoff(netkeibaUrl, cutoffDateStr) {
  const idM = netkeibaUrl.match(/horse\/([0-9a-z]+)/);
  if (!idM) return null;
  const html = cacheHtml(`https://db.netkeiba.com/horse/result/${idM[1]}/`);
  if (!html) return null;
  const tbodyM = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbodyM) return 0;
  const trs = tbodyM[1].split('<tr>').slice(1).map((s) => '<tr>' + s);
  let count = 0;
  for (const tr of trs) {
    // 最初の<td>セル（日付。中に<a href=...>が挟まるため「直後」ではなく中身全体から探す）
    const firstTd = tr.match(/<td[^>]*>([\s\S]*?)<\/td>/);
    if (!firstTd) continue;
    const dateM = firstTd[1].match(/(\d{4})\/(\d{2})\/(\d{2})/);
    if (!dateM) continue;
    const dateStr = `${dateM[1]}-${dateM[2]}-${dateM[3]}`;
    if (dateStr <= cutoffDateStr) count++;
  }
  return count;
}

// ---------------------------------------------------------------- 母集団の構築

const pool = poolFinal.map((r) => {
  const d = debutByUrl.get(r.netkeibaUrl);
  const w = winSplitByUrl.get(r.netkeibaUrl);
  const birthYear = Number(r.birthDate.slice(0, 4));
  const debutDate = d.debut ? d.debut.date : null;
  const bucket = classifyBucket(debutDate, birthYear);
  const winUp = (w.chuoWins ?? 0) > 0;
  const grades = fullGradeWins(ROOT, r.netkeibaUrl) ?? [];
  const cutoffDateStr = `${birthYear + 3}-09-30`;
  const startsToSep3 = startsUpToCutoff(r.netkeibaUrl, cutoffDateStr);
  return {
    recruitYear: r.recruitYear,
    no: r.no,
    sex: r.sex,
    birthYear,
    netkeibaUrl: r.netkeibaUrl,
    name: w.name ?? r.name,
    debutDate,
    bucket,
    starts: w.starts ?? 0,
    winUp,
    chuoPrizeManYen: w.chuoPrizeManYen ?? 0,
    grades,
    startsToSep3,
  };
});

const unknownBucket = pool.filter((p) => p.bucket.startsWith('不明区分'));
console.log(`\n区分分けできなかった頭数（age/monthが想定外）: ${unknownBucket.length}頭 ... ${unknownBucket.map((p) => `${p.recruitYear}年No.${p.no}(${p.bucket})`).join(' / ')}`);

console.log(`\n集計対象 n=${pool.length}（recruits.json 2017〜2024年募集のうちnetkeibaUrl・win-splits・debut情報が揃った頭数）`);

// ---------------------------------------------------------------- 1. 区分ごとの基本統計

console.log('\n## 1. デビュー時期区分ごとの基本統計\n');
console.log('| 区分 | 頭数 | 中央勝ち上がり頭数 | 勝ち上がり率 | 重賞勝ち馬数 | 中央賞金(万円)中央値 | 中央賞金(万円)平均 |');
console.log('|---|---|---|---|---|---|---|');
let sumN = 0, sumWinUp = 0, sumGrade = 0;
for (const b of BUCKET_ORDER) {
  const sub = pool.filter((p) => p.bucket === b);
  const winUpN = sub.filter((p) => p.winUp).length;
  const gradeN = sub.filter((p) => p.grades.length > 0).length;
  const prizeMed = median(sub.map((p) => p.chuoPrizeManYen));
  const prizeMean = mean(sub.map((p) => p.chuoPrizeManYen));
  sumN += sub.length; sumWinUp += winUpN; sumGrade += gradeN;
  console.log(
    `| ${b} | ${sub.length} | ${winUpN} | ${sub.length ? (100 * winUpN / sub.length).toFixed(1) : '-'}% | ${gradeN} | ${prizeMed?.toFixed(0) ?? '-'} | ${prizeMean?.toFixed(0) ?? '-'} |`,
  );
}
console.log(`| 合計 | ${sumN} | ${sumWinUp} | ${(100 * sumWinUp / sumN).toFixed(1)}% | ${sumGrade} | | |`);
console.log(`\n検算: 区分の合計頭数(${sumN}) と 母数(${pool.length}) は一致${sumN === pool.length ? '○' : '× 不一致'}`);

// ---------------------------------------------------------------- 2. 区分×性別

console.log('\n## 2. 区分×性別\n');
console.log('| 区分 | 牡 n | 牡 勝ち上がり率 | 牝 n | 牝 勝ち上がり率 |');
console.log('|---|---|---|---|---|');
for (const b of BUCKET_ORDER) {
  const sub = pool.filter((p) => p.bucket === b);
  const male = sub.filter((p) => p.sex === '牡');
  const female = sub.filter((p) => p.sex === '牝');
  const maleWinUp = male.filter((p) => p.winUp).length;
  const femaleWinUp = female.filter((p) => p.winUp).length;
  console.log(
    `| ${b} | ${male.length} | ${male.length ? (100 * maleWinUp / male.length).toFixed(1) : '-'}% | ${female.length} | ${female.length ? (100 * femaleWinUp / female.length).toFixed(1) : '-'}% |`,
  );
}

// ---------------------------------------------------------------- 3. 区分×募集年

console.log('\n## 3. 区分×募集年（頭数）\n');
console.log('| 募集年 | ' + BUCKET_ORDER.join(' | ') + ' | 合計 |');
console.log('|---|' + BUCKET_ORDER.map(() => '---').join('|') + '|---|');
for (const y of YEARS) {
  const subY = pool.filter((p) => p.recruitYear === y);
  const counts = BUCKET_ORDER.map((b) => subY.filter((p) => p.bucket === b).length);
  console.log(`| ${y} | ${counts.join(' | ')} | ${subY.length} |`);
}

console.log('\n## 3-1. 区分×募集年（勝ち上がり率、%）\n');
console.log('| 募集年 | ' + BUCKET_ORDER.join(' | ') + ' |');
console.log('|---|' + BUCKET_ORDER.map(() => '---').join('|') + '|');
for (const y of YEARS) {
  const subY = pool.filter((p) => p.recruitYear === y);
  const rates = BUCKET_ORDER.map((b) => {
    const s = subY.filter((p) => p.bucket === b);
    return s.length ? (100 * s.filter((p) => p.winUp).length / s.length).toFixed(1) + '%' : '-';
  });
  console.log(`| ${y} | ${rates.join(' | ')} |`);
}

// ---------------------------------------------------------------- 4. 検定

console.log('\n## 4. 検定\n');

// 「2歳5月以前」は全区分でn=5・勝ち上がり0（期待度数<5）でサンプル不足。
// カイ二乗・傾向検定・回帰は、(a)この区分を含めた参考値と、(b)この区分を除いた使用可能な値の両方を出す。
const timingPool = pool.filter((p) => TIMING_BUCKETS.includes(p.bucket));
const USABLE_TIMING_BUCKETS = TIMING_BUCKETS.filter((b) => b !== '2歳5月以前');
const usableTimingPool = pool.filter((p) => USABLE_TIMING_BUCKETS.includes(p.bucket));

function buildChiTable(buckets, data) {
  return buckets.map((b) => {
    const sub = data.filter((p) => p.bucket === b);
    const winUpN = sub.filter((p) => p.winUp).length;
    return [winUpN, sub.length - winUpN];
  });
}

const chiTable = buildChiTable(TIMING_BUCKETS, timingPool);
const chi = chiSquareTest(chiTable);
console.log(`4-1. 区分間（デビューした馬のみ、未出走は除く）の勝ち上がり率の差（カイ二乗）:`);
console.log(`  (a) 全6区分（「2歳5月以前」n=5を含む・参考値）:`);
console.log(`      分割表: ${JSON.stringify(chiTable)}（各行=区分、列=[勝ち上がり,未勝ち上がり]）`);
console.log(`      chi2=${chi.chi2.toFixed(3)} df=${chi.df} p=${chi.p.toFixed(4)} 最小期待度数=${chi.minExpected.toFixed(2)}（${chi.usable ? '使用可' : 'サンプル不足'}）`);

const chiTableUsable = buildChiTable(USABLE_TIMING_BUCKETS, usableTimingPool);
const chiUsable = chiSquareTest(chiTableUsable);
console.log(`  (b) 「2歳5月以前」(n=5)を除いた5区分:`);
console.log(`      分割表: ${JSON.stringify(chiTableUsable)}`);
console.log(`      chi2=${chiUsable.chi2.toFixed(3)} df=${chiUsable.df} p=${chiUsable.p.toFixed(4)} 最小期待度数=${chiUsable.minExpected.toFixed(2)}（${chiUsable.usable ? '使用可' : 'サンプル不足'}）`);

// 全区分（未出走含む）版も参考値として出す
const chiTableAll = buildChiTable(BUCKET_ORDER, pool);
const chiAll = chiSquareTest(chiTableAll);
console.log(`  参考（未出走を含む全7区分）: chi2=${chiAll.chi2.toFixed(3)} df=${chiAll.df} p=${chiAll.p.toFixed(4)} 最小期待度数=${chiAll.minExpected.toFixed(2)}（${chiAll.usable ? '使用可' : 'サンプル不足'}）`);

// 4-2. デビューが遅いほど下がるかの傾向検定（区分を時系列順のスコアに）
function buildTrendGroups(buckets, data) {
  return buckets.map((b, i) => {
    const sub = data.filter((p) => p.bucket === b);
    return { n: sub.length, x: sub.filter((p) => p.winUp).length, score: i + 1 };
  });
}
const trendGroups = buildTrendGroups(TIMING_BUCKETS, timingPool);
const trend = cochranArmitageTrendTest(trendGroups);
console.log(`\n4-2. デビューが遅いほど勝ち上がり率が下がるかの傾向検定（Cochran-Armitage）:`);
console.log(`  (a) 全6区分（スコア1〜6・参考値）: ${trendGroups.map((g) => `${g.score}:${g.x}/${g.n}`).join(' / ')}`);
console.log(`      z=${trend.z.toFixed(3)} p=${trend.p.toFixed(4)}（${trend.usable ? '使用可' : 'サンプル不足'}）`);
const trendGroupsUsable = buildTrendGroups(USABLE_TIMING_BUCKETS, usableTimingPool);
const trendUsable = cochranArmitageTrendTest(trendGroupsUsable);
console.log(`  (b) 「2歳5月以前」を除いた5区分（スコア1〜5）: ${trendGroupsUsable.map((g) => `${g.score}:${g.x}/${g.n}`).join(' / ')}`);
console.log(`      z=${trendUsable.z.toFixed(3)} p=${trendUsable.p.toFixed(4)}（${trendUsable.usable ? '使用可' : 'サンプル不足'}）`);

// 4-3. 性別を調整したロジスティック回帰（区分の効果、2歳6〜8月を基準にダミー変数）
// 「2歳5月以前」(n=5・勝ち上がり0)を含めると完全分離が起きて収束しないため、回帰は(b)の5区分で行う。
console.log('\n4-3. 性別を調整したロジスティック回帰（区分の効果。基準=2歳6〜8月）:');
console.log('  「2歳5月以前」(n=5・勝ち上がり0)は完全分離（0%）で回帰が収束しないため除外し、残り5区分で実施。');
const refBucket = '2歳6〜8月';
const dummyBuckets = USABLE_TIMING_BUCKETS.filter((b) => b !== refBucket);
const X = usableTimingPool.map((p) => [
  1,
  p.sex === '牡' ? 1 : 0,
  ...dummyBuckets.map((b) => (p.bucket === b ? 1 : 0)),
]);
const y = usableTimingPool.map((p) => (p.winUp ? 1 : 0));
const reg = logisticRegression(X, y);
const labels = ['切片', '性別(牡=1)', ...dummyBuckets.map((b) => `区分:${b}`)];
console.log(`  n=${usableTimingPool.length} 収束=${reg.converged}（${reg.iterations}回）`);
console.log('  | 変数 | 係数 | SE | z | p |');
console.log('  |---|---|---|---|---|');
labels.forEach((label, i) => {
  console.log(`  | ${label} | ${reg.coef[i].toFixed(4)} | ${reg.se[i]?.toFixed(4) ?? '-'} | ${reg.z[i]?.toFixed(3) ?? '-'} | ${reg.p[i]?.toFixed(4) ?? '-'} |`);
});

// 傾向スコア版ロジスティック回帰（区分を連続変数1..5として、単一の「遅いほど」係数も出す）
console.log('\n  参考: 区分を時系列順のスコア(1〜5、「2歳5月以前」除く)とした単一係数版（性別調整）:');
const Xscore = usableTimingPool.map((p) => [1, p.sex === '牡' ? 1 : 0, USABLE_TIMING_BUCKETS.indexOf(p.bucket) + 1]);
const regScore = logisticRegression(Xscore, y);
console.log(`  | 変数 | 係数 | SE | z | p |`);
console.log(`  |---|---|---|---|---|`);
['切片', '性別(牡=1)', '区分スコア(1〜5、遅いほど大)'].forEach((label, i) => {
  console.log(`  | ${label} | ${regScore.coef[i].toFixed(4)} | ${regScore.se[i]?.toFixed(4) ?? '-'} | ${regScore.z[i]?.toFixed(3) ?? '-'} | ${regScore.p[i]?.toFixed(4) ?? '-'} |`);
});

// ---------------------------------------------------------------- 5. 打ち切り対策: 3歳9月末までの出走数

console.log('\n## 5. 区分ごとの「3歳9月末までの出走数」中央値（打ち切り対策）\n');
console.log('| 区分 | n（startsToSep3が取れた頭数） | 中央値 | 平均 |');
console.log('|---|---|---|---|');
for (const b of BUCKET_ORDER) {
  const sub = pool.filter((p) => p.bucket === b && p.startsToSep3 != null);
  const med = median(sub.map((p) => p.startsToSep3));
  const avg = mean(sub.map((p) => p.startsToSep3));
  console.log(`| ${b} | ${sub.length} | ${med ?? '-'} | ${avg?.toFixed(2) ?? '-'} |`);
}
const noCutoffData = pool.filter((p) => p.bucket !== '未出走' && p.startsToSep3 == null);
console.log(`\n3歳9月末カウント取得失敗（キャッシュ無し等）: ${noCutoffData.length}頭 ... ${noCutoffData.map((p) => `${p.recruitYear}年No.${p.no}`).join(' / ')}`);

// ---------------------------------------------------------------- 6. 重賞勝ち馬の実例（区分ごと）

console.log('\n## 6. 重賞勝ち馬の実例（区分ごと）\n');
for (const b of BUCKET_ORDER) {
  const winners = pool.filter((p) => p.bucket === b && p.grades.length > 0);
  console.log(`\n### ${b}（${winners.length}頭）`);
  if (winners.length === 0) {
    console.log('- 該当なし');
    continue;
  }
  for (const w of winners) {
    const races = w.grades.map((g) => `${g.raceName}（${g.date}・${g.cls}）`).join('、');
    console.log(`- ${w.recruitYear}年募集 ${w.name}（デビュー${w.debutDate}）: ${races}`);
  }
}

console.log('\n## 完了');
