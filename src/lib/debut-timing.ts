/**
 * デビュー時期の記事（`src/pages/articles/debut-timing.astro`）の型と、ビルド時アサーション。
 * 集計値そのものは `scripts/build-debut-timing.mjs` が `analysis/data/debut-timing-stats.json` に書く。
 *
 * `assertDebutTimingClaims` は本文の主張の「前提」を固定する。成績を取り直して数字が動き、
 * 前提が崩れたら、本文を直すまでビルドを止める。閾値は集計時（2026-10-27）の実測値で、各項目のコメントに書いた。
 */

export interface TimingCell {
  n: number;
  winUp: number;
  rate: number;
}
export interface TimingBucket {
  label: string;
  all: TimingCell;
  male: TimingCell;
  female: TimingCell;
  gradeWinners: number;
  /** 3歳9月末までの出走数の中央値 */
  startsToSep3Median: number;
  /** 一口価格（万円）の中央値 */
  priceMedianManYen: number;
}
export interface RegressionTerm {
  label: string;
  coef: number;
  se: number;
  z: number;
  p: number;
  oddsRatio: number;
  /** オッズ比の95%信頼区間 */
  oddsRatioLo: number;
  oddsRatioHi: number;
}
export interface TimingGradeWinner {
  bucket: string;
  recruitYear: number;
  no: string;
  name: string;
  /** 'YYYY-MM-DD' */
  debutDate: string;
  /** 'YYYY-MM' */
  debutYm: string;
  gradeWins: string[];
}
export interface DebutTimingStats {
  resultsFetchedAt: string;
  years: [number, number];
  poolSize: number;
  excluded: { recruitYear: number; no: string; reason: string }[];
  priceSource: { official: number; netkeibaFallback: number };
  totals: { all: TimingCell; male: TimingCell; female: TimingCell };
  /** 初出走が地方競馬の馬。winUp は中央での勝ち上がり頭数 */
  localDebut: { n: number; winUp: number; byBucket: { label: string; n: number }[] };
  /** 初出走が中央の馬だけの区分別の率（未出走は含まない） */
  centralOnly: { n: number; buckets: { label: string; n: number; winUp: number; rate: number }[] };
  buckets: TimingBucket[];
  tests: {
    chi: { chi2: number; df: number; p: number; minExpected: number };
    trend: { z: number; p: number };
    regression: {
      sex: { n: number; terms: RegressionTerm[] };
      sexPrice: { n: number; terms: RegressionTerm[] };
    };
  };
  gradeWinners: TimingGradeWinner[];
}

export const BUCKET_LABELS = ['2歳8月まで', '2歳9〜10月', '2歳11〜12月', '3歳1〜3月', '3歳4月以降', '未出走'] as const;
/** 区分ごとの頭数（本文: 203/173/137/104/57/47）。 */
export const EXPECTED_N = [203, 173, 137, 104, 57, 47];
/** 区分ごとの勝ち上がり率（本文: 65.5/64.2/44.5/44.2/17.5）。未出走は0%。 */
export const EXPECTED_RATE = ['65.5', '64.2', '44.5', '44.2', '17.5', '0.0'];

/**
 * 本文で名前を挙げた6頭（馬名・デビュー区分と月・本文に書いた勝ったレース）。
 * race は stats.gradeWinners[].gradeWins のどれかに含まれる文字列（netkeibaの略称・「(G1)」付き）。
 */
export const NAMED_HORSES: { name: string; bucket: string; month: number; race: string }[] = [
  { name: 'タスティエーラ', bucket: '2歳11〜12月', month: 11, race: '東京優駿(G1)' },
  { name: 'ヘデントール', bucket: '2歳11〜12月', month: 11, race: '天皇賞(春)(G1)' },
  { name: 'レイパパレ', bucket: '3歳1〜3月', month: 1, race: '大阪杯(G1)' },
  { name: 'マルシュロレーヌ', bucket: '3歳1〜3月', month: 2, race: 'BCディスタフ(G1)' },
  { name: 'ヴェラアズール', bucket: '3歳1〜3月', month: 3, race: 'ジャパンC(G1)' },
  { name: 'パラレルヴィジョン', bucket: '3歳4月以降', month: 4, race: 'ダービー卿チャレンジトロフィー(G3)' },
];

const bucket = (stats: DebutTimingStats, label: string): TimingBucket => {
  const b = stats.buckets.find((x) => x.label === label);
  if (!b) throw new Error(`[debut-timing] 区分が無い: ${label}`);
  return b;
};
export const termOf = (stats: DebutTimingStats, model: 'sex' | 'sexPrice', label: string): RegressionTerm => {
  const t = stats.tests.regression[model].terms.find((x) => x.label === label);
  if (!t) throw new Error(`[debut-timing] 回帰の項が無い: ${model}/${label}`);
  return t;
};

/** 前提が崩れていたら、崩れた項目をすべて並べて throw する。 */
export function assertDebutTimingClaims(stats: DebutTimingStats): void {
  const failures: string[] = [];
  const check = (ok: boolean, msg: string) => {
    if (!ok) failures.push(msg);
  };
  const f = (v: number) => v.toFixed(4);

  // 母数721・区分ごとの頭数と率（本文の表）
  check(stats.poolSize === 721 && stats.totals.all.n === 721, `母数が721でない: ${stats.poolSize}`);
  check(stats.excluded.length === 1 && stats.excluded[0].recruitYear === 2023 && stats.excluded[0].no === '31', '分母から外した募集馬が2023年No.31だけでない');
  check(stats.totals.male.n === 342, `牡が342頭でない: ${stats.totals.male.n}`);
  check(JSON.stringify(stats.buckets.map((b) => b.label)) === JSON.stringify(BUCKET_LABELS), '区分の並びが想定と違う');
  check(JSON.stringify(stats.buckets.map((b) => b.all.n)) === JSON.stringify(EXPECTED_N), `区分ごとの頭数が本文と違う: ${stats.buckets.map((b) => b.all.n).join(',')}`);
  check(
    JSON.stringify(stats.buckets.map((b) => b.all.rate.toFixed(1))) === JSON.stringify(EXPECTED_RATE),
    `区分ごとの率が本文と違う: ${stats.buckets.map((b) => b.all.rate.toFixed(1)).join(',')}`,
  );
  check(stats.buckets.every((b) => b.male.n + b.female.n === b.all.n), '牡+牝が区分の頭数と合わない');

  // 本文: 回帰（基準＝2歳8月まで）。2歳9〜10月は差がない、11月以降の3区分はどちらの調整でも負かつp<0.05
  // （実測 性別調整 2歳9〜10月 p=0.8776／11〜12月 p=0.0003／1〜3月 p=0.0009／4月以降 p<0.0001。
  //   性別＋価格調整 p=0.8851／0.0003／0.0010／<0.0001）
  check(termOf(stats, 'sex', '2歳9〜10月').p > 0.05, `2歳9〜10月が有意になった（性別調整）: p=${f(termOf(stats, 'sex', '2歳9〜10月').p)}`);
  for (const model of ['sex', 'sexPrice'] as const) {
    for (const label of ['2歳11〜12月', '3歳1〜3月', '3歳4月以降']) {
      const t = termOf(stats, model, label);
      check(t.coef < 0 && t.p < 0.05, `${model}/${label}が負で有意でなくなった: coef=${f(t.coef)} p=${f(t.p)}`);
    }
  }
  // 本文: 一口価格の高さと勝ち上がりの間にもはっきりした関係はない（性別＋価格調整の価格項 p>0.05。実測 p=0.665）
  const priceTerm = termOf(stats, 'sexPrice', '一口価格(万円)');
  check(priceTerm.p > 0.05, `一口価格の項が有意になった: p=${f(priceTerm.p)}`);
  // 本文: 2歳8月までと9〜10月の間に差は見られなかった（信頼区間が1をまたぐ。性別調整）
  const t910 = termOf(stats, 'sex', '2歳9〜10月');
  check(t910.oddsRatioLo < 1 && t910.oddsRatioHi > 1, `2歳9〜10月のオッズ比の信頼区間が1をまたがない: ${f(t910.oddsRatioLo)}〜${f(t910.oddsRatioHi)}`);
  check(stats.tests.regression.sex.n === stats.tests.regression.sexPrice.n, '性別調整と性別＋価格調整で対象頭数が違う');

  // 本文: 牡牝とも「10月までの2区分 > 11月以降の3区分」で、3歳4月以降が最低。3歳4月以降 牡24.0%・牝12.5%
  for (const k of ['male', 'female'] as const) {
    const early = [bucket(stats, '2歳8月まで')[k].rate, bucket(stats, '2歳9〜10月')[k].rate];
    const late = ['2歳11〜12月', '3歳1〜3月', '3歳4月以降'].map((l) => bucket(stats, l)[k].rate);
    check(Math.min(...early) > Math.max(...late), `${k}: 10月までの2区分が11月以降の3区分より高くない`);
    check(late[2] === Math.min(...late), `${k}: 3歳4月以降が最低でない`);
  }
  const last = bucket(stats, '3歳4月以降');
  check(last.male.rate.toFixed(1) === '24.0' && last.female.rate.toFixed(1) === '12.5', `3歳4月以降の牡牝の率が本文と違う: 牡${last.male.rate.toFixed(1)} 牝${last.female.rate.toFixed(1)}`);

  // 本文: 一口価格の中央値はどの区分も7.5〜8.5万円（未出走も含めた全区分）
  for (const b of stats.buckets) check(b.priceMedianManYen >= 7.5 && b.priceMedianManYen <= 8.5, `${b.label}の一口価格の中央値が7.5〜8.5万円の外: ${b.priceMedianManYen}`);

  // 本文: 3歳9月末までの出走数の中央値は3歳4月以降=2、2歳8月まで=6
  check(last.startsToSep3Median === 2, `3歳4月以降の出走数の中央値が2でない: ${last.startsToSep3Median}`);
  check(bucket(stats, '2歳8月まで').startsToSep3Median === 6, `2歳8月までの出走数の中央値が6でない: ${bucket(stats, '2歳8月まで').startsToSep3Median}`);

  // 本文: 2歳11月以降デビューの重賞馬=11頭、11月以降にデビューした298頭のうち117頭が勝ち上がり
  const late3 = ['2歳11〜12月', '3歳1〜3月', '3歳4月以降'].map((l) => bucket(stats, l));
  check(late3.reduce((a, b) => a + b.gradeWinners, 0) === 11, `2歳11月以降の重賞馬が11頭でない: ${late3.reduce((a, b) => a + b.gradeWinners, 0)}`);
  check(stats.gradeWinners.filter((g) => late3.some((b) => b.label === g.bucket)).length === 11, '重賞馬の表の2歳11月以降が11頭でない');
  check(late3.reduce((a, b) => a + b.all.n, 0) === 298 && late3.reduce((a, b) => a + b.all.winUp, 0) === 117, '11月以降298頭のうち117頭勝ち上がり、が崩れた');
  // 重賞馬の表は区分ごとの頭数と一致（全45頭）
  check(stats.gradeWinners.length === 45, `重賞馬が45頭でない: ${stats.gradeWinners.length}`);
  for (const b of stats.buckets) check(stats.gradeWinners.filter((g) => g.bucket === b.label).length === b.gradeWinners, `${b.label}の重賞馬の表と集計が合わない`);

  // 本文: 地方デビュー36頭は全頭が中央0勝・うち21頭が2歳8月まで。中央デビューのみ 2歳8月まで73.1%・9〜10月65.7%
  check(stats.localDebut.n === 36 && stats.localDebut.winUp === 0, `地方デビューが36頭・中央0勝でない: ${stats.localDebut.n}頭 ${stats.localDebut.winUp}勝`);
  check(stats.localDebut.byBucket.find((b) => b.label === '2歳8月まで')?.n === 21, '地方デビューのうち2歳8月までが21頭でない');
  check(stats.localDebut.byBucket.reduce((a, b) => a + b.n, 0) === stats.localDebut.n, '地方デビューの区分別の合計が合わない');
  const co = (l: string) => stats.centralOnly.buckets.find((b) => b.label === l);
  check(co('2歳8月まで')?.rate.toFixed(1) === '73.1' && co('2歳9〜10月')?.rate.toFixed(1) === '65.7', `中央デビューのみの率が本文と違う: ${co('2歳8月まで')?.rate.toFixed(1)} / ${co('2歳9〜10月')?.rate.toFixed(1)}`);
  check(stats.centralOnly.n + stats.localDebut.n + bucket(stats, '未出走').all.n === stats.poolSize, '中央デビュー+地方デビュー+未出走が母数と合わない');
  // 中央デビューのみでも形は同じ（10月までの2区分 > 11月以降の3区分、最低は3歳4月以降）
  const cr = stats.centralOnly.buckets.map((b) => b.rate);
  check(Math.min(cr[0], cr[1]) > Math.max(cr[2], cr[3], cr[4]) && cr[4] === Math.min(...cr), '中央デビューのみで形が崩れた');

  // 本文で名前を挙げた6頭のデビュー区分・月と、本文に書いた勝ったレース

  for (const n of NAMED_HORSES) {
    const g = stats.gradeWinners.find((x) => x.name === n.name);
    check(!!g && g.bucket === n.bucket && Number(g.debutYm.slice(5, 7)) === n.month, `${n.name}のデビュー区分・月が本文（${n.bucket}・${n.month}月）と違う: ${g ? `${g.bucket}・${g.debutYm}` : '重賞馬の表に無い'}`);
    check(!!g && g.gradeWins.some((w) => w.includes(n.race)), `${n.name}の勝った重賞に${n.race}が無い: ${g ? g.gradeWins.join('、') : '重賞馬の表に無い'}`);
  }

  if (failures.length > 0) {
    throw new Error(`[debut-timing] 本文の前提が崩れた。本文と閾値を見直す:\n- ${failures.join('\n- ')}`);
  }
}
