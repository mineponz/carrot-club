/**
 * 出資馬の個別ページ（`/my-horses/<slug>/`）の「データで見る○○」節に出す項目を作る。
 *
 * 分析記事（`src/pages/articles/*`）で出した傾向を、その馬の数字に当てはめて
 * 「数字 → 記事で分かった傾向での位置づけ → 記事へのリンク」の1〜2文にする。
 *
 * ## 方針
 * - **その馬について実際に計算できる項目だけ**を返す。データが欠けていれば項目ごと出さない
 *   （推測で埋めない）。追加募集の馬は測尺が2歳春で、記事の物差し（1歳8月）に当てはまらないので
 *   そもそも `recruit` が無く、項目は空になる。
 * - 記事が「差は小さい／読めなかった」とした項目は、そう書く。数字が良く見える側だけ拾わない。
 * - 母集団・階級の切り方・検定は**各記事と同じ**にしてある（記事を直したらここも見直す）。
 *   本文に焼き付いた解釈（「牡では関係が見えない」等）は `checkInsightPremises()` がビルド時に
 *   検算し、前提が崩れたらビルドを落とす（[[20260825-assert-article-premises-at-build-time]]）。
 * - JSON を import しない純関数にして `node --test` で検証できるようにする
 *   （データは呼び出し側が渡す。`sibling-recruits.ts` と同じ方針）。
 */
import type { RecruitWithResult, LeadingRank } from './analysis-data.ts';
import {
  mean,
  median,
  formatManYen,
  mannWhitneyU,
  twoProportionZTest,
  pearsonCorrelation,
  spearmanCorrelation,
  correlationPValue,
} from './chart-math.ts';
import { groupByDamOrigin, isMajorClubOrigin, type RawDam } from './dam-siblings.ts';
import { findSiblingRecruits, type SiblingRecruit } from './sibling-recruits.ts';

export interface HorseInsight {
  key: string;
  /** 大きく出す数字（「157cm」）。 */
  figure: string;
  /** 数字の意味を1行で（「募集時の体高」）。 */
  figureLabel: string;
  /** 数字の下に小さく出す位置づけ（「過去の募集馬815頭のうち上位14%」）。 */
  figureNote?: string;
  /** 本文。1〜2文。 */
  body: string;
  /** 根拠にした記事。事実の並べだけの項目では無し。 */
  article?: { href: string; title: string };
}

const ARTICLES = {
  height: { href: '/articles/height/', title: '体高と成績の関係を見てみた' },
  weight: { href: '/articles/weight/', title: '馬体重と成績の関係' },
  chest: { href: '/articles/chest-girth/', title: '胸囲と成績・回収率の関係を見てみた' },
  caret: { href: '/articles/caret-girth/', title: '管囲が太い馬は走るのか？' },
  damAge: { href: '/articles/dam-age/', title: '母馬の年齢と成績の関係を見てみた' },
  birthMonth: { href: '/articles/birth-month/', title: '誕生月と体格・成績の関係を見てみた' },
  birthOrder: { href: '/articles/birth-order/', title: '何番目の仔か（産次）と成績の関係を見てみた' },
  club: { href: '/articles/club-siblings/', title: '母がサンデー出身の募集馬は活躍しているか？' },
  stable: { href: '/articles/stable-leading/', title: 'リーディング上位の厩舎に入った馬は走るのか？' },
} as const;

/** 記事 height の重賞馬率の境目（158cm以上 / 未満）。 */
export const TALL_HEIGHT_CM = 158;
/** 記事 birth-month の早生まれの境目（この日まで）。 */
export const EARLY_BIRTH_MONTH_DAY = '03-10';
/** 記事 birth-month の対象（2025年募集は大半が未出走なので比較から外す）。 */
const BIRTH_MONTH_EXCLUDED_YEAR = 2025;
/** 記事 club-siblings の集計対象（この生年以下）。 */
const CLUB_MATURE_BIRTH_YEAR = 2022;

/** 現在JRA（美浦・栗東）所属か。`analysis-data.ts` の `isJraRegion` と同じ（あちらはJSONを読み込むので型だけ借りる）。 */
const isJraRegion = (h: Pick<RecruitWithResult, 'region'>) => h.region === '東' || h.region === '西';

/** 募集年のJRAリーディング順位を返す関数（`analysis-data.ts` の `leadingRankOf`）。呼び出し側が渡す。 */
export type LeadingRankFn = (h: RecruitWithResult) => LeadingRank;

const isGradeWinner = (h: RecruitWithResult) => h.gradeWins.length > 0;
const hasStarted = (h: RecruitWithResult) => (h.starts ?? 0) > 0;
const pct = (part: number, whole: number) => (whole === 0 ? 0 : (100 * part) / whole);
const pctText = (v: number) => `${v.toFixed(1)}%`;
const racedOnly = (rows: readonly RecruitWithResult[]) => rows.filter(hasStarted);
const fmtR = (r: number) => (Math.abs(r) < 0.005 ? '0.00' : r.toFixed(2));
const fmtP = (p: number) => (p < 0.001 ? 'p<0.001' : `p=${p.toFixed(3)}`);

/** 期待成功数が5未満の比率検定は出さない（記事と同じガード）。 */
function safeProportionP(x1: number, n1: number, x2: number, n2: number): number | null {
  if (n1 === 0 || n2 === 0) return null;
  const pooled = (x1 + x2) / (n1 + n2);
  if (Math.min(n1 * pooled, n2 * pooled) < 5) return null;
  return twoProportionZTest(x1, n1, x2, n2).p;
}

/** 値 v が、母集団 values のどのあたりか。v以上の割合とv以下の割合を返す。 */
function standing(values: readonly number[], v: number) {
  const n = values.length;
  const ge = values.filter((x) => x >= v).length;
  const le = values.filter((x) => x <= v).length;
  const upper = ge / n <= le / n; // 大きい側に寄っているか
  return { n, upper, share: Math.max(1, Math.round(100 * (upper ? ge / n : le / n))) };
}
const standingNote = (label: string, s: ReturnType<typeof standing>) =>
  `${label}${s.n}頭のうち${s.upper ? '大きい' : '小さい'}方から${s.share}%`;

// ---------------------------------------------------------------------------
// 誕生日まわり（記事 birth-month と同じ定義）
// ---------------------------------------------------------------------------

/** 年に依存しない通し日数。2/29は3/1扱い（記事と同じ）。 */
export function dayOfYear(isoDate: string): number {
  const [, m, d] = isoDate.split('-').map(Number);
  if (m === 2 && d === 29) return 60;
  const start = Date.UTC(2001, 0, 1);
  const cur = Date.UTC(2001, m - 1, d);
  return Math.round((cur - start) / 86400000) + 1;
}
const EARLY_CUTOFF = dayOfYear(`2001-${EARLY_BIRTH_MONTH_DAY}`);

export type Quadrant = '早生まれ・大きい' | '早生まれ・小さい' | '遅生まれ・大きい' | '遅生まれ・小さい';

function birthQuadrant(h: RecruitWithResult, heightMedian: number): Quadrant {
  const early = dayOfYear(h.birthDate as string) <= EARLY_CUTOFF;
  const big = (h.height as number) >= heightMedian;
  if (early) return big ? '早生まれ・大きい' : '早生まれ・小さい';
  return big ? '遅生まれ・大きい' : '遅生まれ・小さい';
}

/** 記事 birth-month の4グループ集計。 */
export function birthQuadrantStats(pool: readonly RecruitWithResult[]) {
  const all = pool.filter((h) => h.birthDate !== null);
  const mature = all.filter((h) => h.recruitYear !== BIRTH_MONTH_EXCLUDED_YEAR && h.height !== null);
  const heightMedian = median(mature.map((h) => h.height as number));
  const groups = new Map<Quadrant, RecruitWithResult[]>();
  for (const h of mature) {
    const q = birthQuadrant(h, heightMedian);
    groups.set(q, [...(groups.get(q) ?? []), h]);
  }
  const statOf = (q: Quadrant) => {
    const g = groups.get(q) ?? [];
    const raced = racedOnly(g);
    const winners = g.filter(isGradeWinner).length;
    return {
      n: g.length,
      raced: raced.length,
      avgPrize: raced.length ? mean(raced.map((h) => h.totalPrizeManYen)) : 0,
      gradeRate: pct(winners, g.length),
    };
  };
  const prizes = (q: Quadrant) => racedOnly(groups.get(q) ?? []).map((h) => h.totalPrizeManYen);
  return {
    mature,
    heightMedian,
    stat: statOf,
    smallTestP: mannWhitneyU(prizes('早生まれ・小さい'), prizes('遅生まれ・小さい')).p,
    bigTestP: mannWhitneyU(prizes('早生まれ・大きい'), prizes('遅生まれ・大きい')).p,
    doyMedian: median(mature.map((h) => dayOfYear(h.birthDate as string))),
  };
}

// ---------------------------------------------------------------------------
// 各記事の集計（本文の数字と前提の検算の両方で使う）
// ---------------------------------------------------------------------------

/** 記事 height: 体高×賞金の相関と、158cm以上/未満の重賞馬率。 */
function heightFacts(pool: readonly RecruitWithResult[]) {
  const withH = pool.filter((h) => h.height !== null);
  const racedH = racedOnly(withH);
  const r = pearsonCorrelation(
    racedH.map((h) => h.height as number),
    racedH.map((h) => h.totalPrizeManYen)
  );
  const tall = withH.filter((h) => (h.height as number) >= TALL_HEIGHT_CM);
  const rest = withH.filter((h) => (h.height as number) < TALL_HEIGHT_CM);
  const winners = withH.filter(isGradeWinner);
  return {
    withH,
    r,
    tallN: tall.length,
    tallWinners: tall.filter(isGradeWinner).length,
    restN: rest.length,
    restWinners: rest.filter(isGradeWinner).length,
    winnerMin: Math.min(...winners.map((h) => h.height as number)),
    winnerMax: Math.max(...winners.map((h) => h.height as number)),
    winnersTotal: winners.length,
  };
}

/** 記事 weight: 同性内の4分位（母集団の25/50/75パーセンタイルで切る。[lo, hi)）。 */
function weightQuartiles(rows: readonly RecruitWithResult[]) {
  const sorted = rows.map((h) => h.weight as number).sort((a, b) => a - b);
  const n = sorted.length;
  const t1 = sorted[Math.floor(n / 4)];
  const t2 = sorted[Math.floor(n / 2)];
  const t3 = sorted[Math.floor((3 * n) / 4)];
  const labels = ['軽い1/4', 'やや軽い', 'やや重い', '重い1/4'] as const;
  const labelOf = (w: number) => (w < t1 ? labels[0] : w < t2 ? labels[1] : w < t3 ? labels[2] : labels[3]);
  const medians = labels.map((l) => {
    const prizes = racedOnly(rows.filter((h) => labelOf(h.weight as number) === l)).map(
      (h) => h.totalPrizeManYen
    );
    return Math.round(median(prizes));
  });
  return { labels, labelOf, medians };
}

function weightFacts(pool: readonly RecruitWithResult[], sex: string) {
  const rows = pool.filter((h) => h.weight !== null && h.sex === sex);
  const raced = racedOnly(rows);
  const r = spearmanCorrelation(
    raced.map((h) => h.weight as number),
    raced.map((h) => h.totalPrizeManYen)
  );
  return { rows, raced, r, p: r === null ? null : correlationPValue(r, raced.length), q: weightQuartiles(rows) };
}

/** 記事 caret-girth: 同性内の3分位の境目。 */
function caretTertiles(rows: readonly RecruitWithResult[]) {
  const sorted = rows.map((h) => h.caretGirth as number).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length / 3)];
  const hi = sorted[Math.floor((2 * sorted.length) / 3)];
  const thin = rows.filter((h) => (h.caretGirth as number) < lo).map((h) => h.caretGirth as number);
  return { lo, hi, thinMax: thin.length ? Math.max(...thin) : lo };
}

function caretFacts(pool: readonly RecruitWithResult[], sex: string) {
  const rows = pool.filter((h) => h.caretGirth !== null && h.sex === sex);
  const raced = racedOnly(rows);
  const r = spearmanCorrelation(
    raced.map((h) => h.caretGirth as number),
    raced.map((h) => h.totalPrizeManYen)
  );
  return { rows, r, p: r === null ? null : correlationPValue(r, raced.length), t: caretTertiles(rows) };
}

/** 記事 birth-order の産次帯。 */
function parityFacts(pool: readonly RecruitWithResult[]) {
  const all = pool.filter((h) => h.damParity !== null);
  const raced = racedOnly(all);
  const r = pearsonCorrelation(
    raced.map((h) => h.damParity as number),
    raced.map((h) => h.totalPrizeManYen)
  );
  const upto3 = all.filter((h) => (h.damParity as number) <= 3);
  const from4 = all.filter((h) => (h.damParity as number) >= 4);
  const first = all.filter((h) => h.damParity === 1);
  const notFirst = all.filter((h) => h.damParity !== 1);
  const rate = (g: RecruitWithResult[]) => pct(g.filter(isGradeWinner).length, g.length);
  const winners = (g: RecruitWithResult[]) => g.filter(isGradeWinner).length;
  const afterRest = all.filter((h) => h.damGapBeforeYears !== null && h.damGapBeforeYears >= 2);
  const consecutive = all.filter((h) => h.damGapBeforeYears === 1);
  return {
    all,
    r,
    upto3Rate: rate(upto3),
    from4Rate: rate(from4),
    upto3P: safeProportionP(winners(upto3), upto3.length, winners(from4), from4.length),
    firstRate: rate(first),
    firstN: first.length,
    notFirstRate: rate(notFirst),
    firstP: safeProportionP(winners(first), first.length, winners(notFirst), notFirst.length),
    afterRestN: afterRest.length,
    afterRestRate: rate(afterRest),
    consecutiveRate: rate(consecutive),
    restP: safeProportionP(winners(afterRest), afterRest.length, winners(consecutive), consecutive.length),
  };
}

/** 記事 stable-leading: JRA所属馬を、募集年のリーディング10位以内かどうかで分ける。 */
function stableFacts(pool: readonly RecruitWithResult[], leadingRankOf: LeadingRankFn) {
  const jra = pool.filter(isJraRegion);
  const top = jra.filter((h) => {
    const { rank } = leadingRankOf(h);
    return rank !== null && rank <= 10;
  });
  const rest = jra.filter((h) => !top.includes(h));
  const w = (g: RecruitWithResult[]) => g.filter(isGradeWinner).length;
  return {
    topRate: pct(w(top), top.length),
    restRate: pct(w(rest), rest.length),
    p: safeProportionP(w(top), top.length, w(rest), rest.length),
  };
}

// ---------------------------------------------------------------------------
// 項目づくり
// ---------------------------------------------------------------------------

export interface InsightInput {
  /** `recruits.json` の同じ馬の行。追加募集の馬など、行が無ければ null（項目は空になる）。 */
  recruit: RecruitWithResult | null;
  /** 全募集馬（`loadRecruitsWithResults()`）。 */
  pool: readonly RecruitWithResult[];
  /** 母ごとの産駒ロスター（`dam-siblings.json` の results）。 */
  damResults: readonly RawDam[];
  /** 出資馬ページに載せている担当調教師名。募集データの担当と食い違えば厩舎の項目は出さない。 */
  trainer: string | null;
  /** 募集年のJRAリーディング順位（`leadingRankOf`）。 */
  leadingRankOf: LeadingRankFn;
}

export function buildHorseInsights(input: InsightInput): HorseInsight[] {
  const { recruit, pool, damResults } = input;
  if (!recruit) return [];
  const out: HorseInsight[] = [];

  // ---- 体高 ----
  if (recruit.height !== null) {
    const f = heightFacts(pool);
    const s = standing(f.withH.map((h) => h.height as number), recruit.height);
    const tallRate = pct(f.tallWinners, f.tallN);
    const restRate = pct(f.restWinners, f.restN);
    const tail =
      recruit.height >= TALL_HEIGHT_CM
        ? `${TALL_HEIGHT_CM}cm以上は${f.tallN}頭中${f.tallWinners}頭（${pctText(tallRate)}）が重賞馬で、${TALL_HEIGHT_CM}cm未満の${pctText(restRate)}より高めです。ただし重賞馬が${f.winnersTotal}頭しかいない集計なので、体高そのものが原因とは言えません。`
        : `${TALL_HEIGHT_CM}cm未満の重賞馬率は${pctText(restRate)}で、${TALL_HEIGHT_CM}cm以上の${pctText(tallRate)}より低めです。ただし重賞馬の体高は${f.winnerMin}〜${f.winnerMax}cmに散らばっていて、体高だけで足切りする根拠にはなりません。`;
    out.push({
      key: 'height',
      figure: `${recruit.height}cm`,
      figureLabel: '募集時の体高',
      figureNote: standingNote('過去の募集馬', s),
      body: `体高と獲得賞金の相関は r=${fmtR(f.r ?? 0)} の弱い正の相関にとどまります。${tail}`,
      article: ARTICLES.height,
    });
  }

  // ---- 馬体重（性別ごとに効き方が違う） ----
  if (recruit.weight !== null && (recruit.sex === '牡' || recruit.sex === '牝')) {
    const f = weightFacts(pool, recruit.sex);
    const s = standing(f.rows.map((h) => h.weight as number), recruit.weight);
    const label = f.q.labelOf(recruit.weight);
    const med = f.q.medians[f.q.labels.indexOf(label)];
    const body =
      recruit.sex === '牝'
        ? `牝は馬体重が重いほど稼ぐ傾向がはっきり出ていて、同性の4分位の賞金中央値は軽い順に${f.q.medians.map(formatManYen).join('→')}万円。この馬は「${label}」の群（中央値${formatManYen(med)}万円）に入ります。ただし一頭一頭の結果を決める数字ではありません。`
        : `牡は賞金で見るかぎり馬体重との関係が見えず（順位相関 r=${fmtR(f.r ?? 0)}）、「${label}」の群の賞金中央値は${formatManYen(med)}万円。牡の馬体重は判断材料にしづらい、というのが記事の結論です。`;
    out.push({
      key: 'weight',
      figure: `${recruit.weight}kg`,
      figureLabel: '募集時の馬体重',
      figureNote: standingNote(`過去の募集馬（${recruit.sex}）`, s),
      body,
      article: ARTICLES.weight,
    });
  }

  // ---- 胸囲（馬体重・体高と連動していて、独自の情報は薄い） ----
  if (recruit.chestGirth !== null) {
    const withC = pool.filter((h) => h.chestGirth !== null);
    const s = standing(withC.map((h) => h.chestGirth as number), recruit.chestGirth);
    const both = withC.filter((h) => h.weight !== null);
    const rw = pearsonCorrelation(
      both.map((h) => h.chestGirth as number),
      both.map((h) => h.weight as number)
    );
    out.push({
      key: 'chest',
      figure: `${recruit.chestGirth}cm`,
      figureLabel: '募集時の胸囲',
      figureNote: standingNote('過去の募集馬', s),
      body: `胸囲は馬体重と強く連動していて（r=${fmtR(rw ?? 0)}）、胸囲だけが持つ情報は薄いというのが記事の結論です。胸囲は「体が大きいか」を別の角度から見ている数字、と考えれば足ります。`,
      article: ARTICLES.chest,
    });
  }

  // ---- 管囲（牡牝で水準が違うので同性で見る） ----
  if (recruit.caretGirth !== null && (recruit.sex === '牡' || recruit.sex === '牝')) {
    const f = caretFacts(pool, recruit.sex);
    const s = standing(f.rows.map((h) => h.caretGirth as number), recruit.caretGirth);
    const body =
      recruit.sex === '牡'
        ? `管囲は牡牝で水準が違い、管囲で並べることはほぼ性別で並べることでした。牡の中で見ると管囲と成績の関係は見当たりません（順位相関 r=${fmtR(f.r ?? 0)}）。`
        : recruit.caretGirth < f.t.lo
          ? `管囲は牡牝で水準が違い、管囲で並べることはほぼ性別で並べることでした。牝には弱い傾向（順位相関 r=${fmtR(f.r ?? 0)}）が残り、沈んでいるのは細い側の1/3（${f.t.thinMax}cm以下）だけで、この馬はそこに入ります。ただし両端の検定は通っていません。`
          : `管囲は牡牝で水準が違い、管囲で並べることはほぼ性別で並べることでした。牝には弱い傾向が残りますが、沈んでいるのは細い側の1/3（${f.t.thinMax}cm以下）だけで、この馬はそこに入りません。`;
    out.push({
      key: 'caret',
      figure: `${recruit.caretGirth}cm`,
      figureLabel: '募集時の管囲',
      figureNote: standingNote(`過去の募集馬（${recruit.sex}）`, s),
      body,
      article: ARTICLES.caret,
    });
  }

  // ---- 生まれ月（誕生日 × 体高の4グループ） ----
  if (recruit.birthDate !== null && recruit.height !== null) {
    const q = birthQuadrantStats(pool);
    const quad = birthQuadrant(recruit, q.heightMedian);
    const st = q.stat(quad);
    const [, m, d] = recruit.birthDate.split('-').map(Number);
    const cutoffText = `${Number(EARLY_BIRTH_MONTH_DAY.split('-')[0])}月${Number(EARLY_BIRTH_MONTH_DAY.split('-')[1])}日`;
    const lead = `過去の募集馬${q.mature.length}頭を、${cutoffText}までの早生まれと、体高${q.heightMedian}cm以上の大きい馬とで4つに分けると、この馬は「${quad}」の群（${st.n}頭）に入ります。`;
    let tail: string;
    if (quad === '早生まれ・小さい') {
      tail = `4群のうち賞金が最も振るわず（平均${formatManYen(st.avgPrize)}万円・重賞馬率${pctText(st.gradeRate)}）、月齢の利があっても小さい馬は伸びきらない、という見立てと向きは合いますが、有意な差（${fmtP(q.smallTestP)}）ではありません。`;
    } else if (quad === '遅生まれ・小さい') {
      const early = q.stat('早生まれ・小さい');
      tail = `同じ小さい馬でも、早生まれ（平均${formatManYen(early.avgPrize)}万円）より遅生まれ（平均${formatManYen(st.avgPrize)}万円）の方が賞金は高めでしたが、有意な差（${fmtP(q.smallTestP)}）ではありません。`;
    } else {
      tail = `大きい馬どうしでは早生まれと遅生まれにほとんど差がなく（${fmtP(q.bigTestP)}）、誕生のタイミングを気にする理由は見当たりませんでした。`;
    }
    out.push({
      key: 'birth-month',
      figure: `${m}月${d}日`,
      figureLabel: '生まれ',
      figureNote: quad,
      body: `${lead}${tail}`,
      article: ARTICLES.birthMonth,
    });
  }

  // ---- 母齢 ----
  if (recruit.damAge !== null) {
    const withAge = pool.filter((h) => h.damAge !== null);
    const s = standing(withAge.map((h) => h.damAge as number), recruit.damAge);
    const racedAge = racedOnly(withAge);
    const r = pearsonCorrelation(
      racedAge.map((h) => h.damAge as number),
      racedAge.map((h) => h.totalPrizeManYen)
    );
    const winners = withAge.filter(isGradeWinner).map((h) => h.damAge as number);
    out.push({
      key: 'dam-age',
      figure: `${recruit.damAge}歳`,
      figureLabel: '募集時の母齢',
      figureNote: standingNote('過去の募集馬', s),
      body: `母齢と獲得賞金の相関は r=${fmtR(r ?? 0)} とほぼゼロで、母齢から成績は読めませんでした。重賞馬は${Math.min(...winners)}〜${Math.max(...winners)}歳の母から出ています。`,
      article: ARTICLES.damAge,
    });
  }

  // ---- 産次 ----
  if (recruit.damParity !== null) {
    const f = parityFacts(pool);
    const head = `産次と獲得賞金の相関は r=${fmtR(f.r ?? 0)} で、産次から成績はほとんど読めませんでした。`;
    let mid: string;
    if (recruit.damParity === 1) {
      mid =
        f.firstP === null
          ? ''
          : `初仔の重賞馬率は${pctText(f.firstRate)}（2番仔以降は${pctText(f.notFirstRate)}）で、「初仔は走らない」という俗説は向きだけ合っていますが、有意差には届きません（${fmtP(f.firstP)}）。`;
    } else {
      mid =
        f.upto3P === null
          ? ''
          : `重賞馬率は3番仔以内が${pctText(f.upto3Rate)}、4番仔以降が${pctText(f.from4Rate)}で、差は偶然の範囲です（${fmtP(f.upto3P)}）。`;
    }
    const gap = recruit.damGapBeforeYears;
    const rest =
      gap !== null && gap >= 2 && f.afterRestN > 0
        ? `前の仔との間に空胎の年があります。「空胎明けは走る」は調べた中で最大の差（重賞馬率${pctText(f.afterRestRate)}対${pctText(f.consecutiveRate)}）でしたが、${f.afterRestN}頭では${f.restP === null ? '検定に足りるサンプルではありません' : `有意とは言えません（${fmtP(f.restP)}）`}。`
        : '';
    out.push({
      key: 'birth-order',
      figure: `${recruit.damParity}番仔`,
      figureLabel: '母の何番目の仔か',
      figureNote:
        recruit.damProduceCount !== null ? `母の産駒は${recruit.damProduceCount}頭` : undefined,
      body: `${head}${mid}${rest}`,
      article: ARTICLES.birthOrder,
    });
  }

  // ---- 母の出身クラブ（サンデー・シルク・G1レーシング出身の母のときだけ） ----
  const damId = (recruit.damUrl ?? '').match(/\/horse\/([0-9a-zA-Z]+)/)?.[1] ?? null;
  const dam = damId ? damResults.find((d) => d.damId === damId) : undefined;
  if (dam && isMajorClubOrigin(dam)) {
    const g = groupByDamOrigin(damResults as RawDam[], CLUB_MATURE_BIRTH_YEAR);
    const ss = g.stats.majorClub;
    const all = g.allStats;
    const clubName = { sunday: 'サンデーレーシング', silk: 'シルクレーシング', g1: 'G1レーシング' }[
      dam.damClub as 'sunday' | 'silk' | 'g1'
    ];
    out.push({
      key: 'club-origin',
      figure: clubName,
      figureLabel: `母${dam.damName ?? ''}の出身クラブ`,
      figureNote: `母が向こうのクラブ出身の募集馬 ${ss.n}頭`,
      body: `出走率は${pctText(ss.debutRate * 100)}（全体${pctText(all.debutRate * 100)}）と高く、出走馬の勝ち上がり率は${pctText(ss.winRate * 100)}（全体${pctText(all.winRate * 100)}）で、極端に低くはありません。賞金の中央値は${formatManYen(ss.medianPrize)}万円（全体${formatManYen(all.medianPrize)}万円）と低めですが、その差は、重賞馬が${ss.gradeWinners}頭（全体は${all.n}頭中${all.gradeWinners}頭）しか出ていない、上振れの少なさに集約されます。`,
      article: ARTICLES.club,
    });
  }

  // ---- 同じ母のキャロットの兄姉（事実のみ・記事の傾向は付けない） ----
  const siblings: SiblingRecruit[] = findSiblingRecruits(
    { name: recruit.recruitName, damUrl: recruit.damUrl ?? '', sibling: '' },
    recruit.recruitYear,
    pool
  ).filter((s) => s.starts !== null && s.totalPrizeManYen !== null);
  if (siblings.length > 0) {
    const raced = siblings.filter((s) => (s.starts ?? 0) > 0);
    const won = raced.filter((s) => (s.wins ?? 0) > 0);
    const top = [...raced].sort((a, b) => (b.totalPrizeManYen ?? 0) - (a.totalPrizeManYen ?? 0))[0];
    const topText = top
      ? `最も稼いでいるのは${top.name}（${top.starts}戦${top.wins}勝・${formatManYen(top.totalPrizeManYen ?? 0)}万円）です。`
      : '';
    out.push({
      key: 'siblings',
      figure: `${siblings.length}頭`,
      figureLabel: '同じ母でキャロットが先に募集した兄姉',
      figureNote: `出走${raced.length}頭・勝ち上がり${won.length}頭`,
      body: topText || '出走した兄姉はまだいません。',
    });
  }

  // ---- 厩舎（募集年のJRAリーディング） ----
  if (isJraRegion(recruit) && input.trainer && recruit.finalTrainer === input.trainer) {
    const lead = input.leadingRankOf(recruit);
    if (lead.rank !== null && !lead.substituted) {
      const f = stableFacts(pool, input.leadingRankOf);
      const region = recruit.region === '東' ? '美浦' : '栗東';
      out.push({
        key: 'stable',
        figure: `${lead.rank}位`,
        figureLabel: `${input.trainer}厩舎（${region}）の${lead.year}年JRAリーディング`,
        body:
          f.p === null
            ? `リーディング上位の厩舎に入った馬が走る、とは言えませんでした。記事の結論は、厩舎名で加点も減点もしない程度の重みで見ておく、というものです。`
            : `リーディング10位以内の厩舎に入った馬の重賞馬率は${pctText(f.topRate)}、それ以外は${pctText(f.restRate)}で、差は偶然の範囲です（${fmtP(f.p)}）。記事の結論は、厩舎名で加点も減点もしない程度の重みで見ておく、というものです。`,
        article: ARTICLES.stable,
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// 前提の検算（本文に焼き付いた解釈が、データを取り直しても嘘にならないように）
// ---------------------------------------------------------------------------

/**
 * 本文の解釈が成り立つ前提を条件式にして、崩れたものを「どの主張か」付きで返す。
 * 空配列なら問題なし。両方向を守る（「差なし」だけでなく「ここは差あり」も）。
 */
export function checkInsightPremises(
  pool: readonly RecruitWithResult[],
  damResults: readonly RawDam[],
  leadingRankOf: LeadingRankFn
): string[] {
  const broken: string[] = [];
  const claim = (label: string, ok: boolean) => {
    if (!ok) broken.push(label);
  };

  // 体高: 弱い正の相関。158cm以上の方が重賞馬率が高い。
  const h = heightFacts(pool);
  claim('体高: 弱い正の相関（0.05<r<0.25）', h.r !== null && h.r > 0.05 && h.r < 0.25);
  claim(
    `体高: ${TALL_HEIGHT_CM}cm以上の重賞馬率が未満より高い`,
    pct(h.tallWinners, h.tallN) > pct(h.restWinners, h.restN)
  );

  // 馬体重: 牝は有意に正、牡は有意でなく|r|が小さい。
  const wf = weightFacts(pool, '牝');
  const wm = weightFacts(pool, '牡');
  claim('馬体重: 牝は有意な正の相関', wf.r !== null && wf.r > 0 && wf.p !== null && wf.p < 0.05);
  claim('馬体重: 牝の4分位の賞金中央値が単調増加', wf.q.medians.every((v, i, a) => i === 0 || v > a[i - 1]));
  claim('馬体重: 牡は有意でなく相関が小さい', wm.r !== null && Math.abs(wm.r) < 0.1 && wm.p !== null && wm.p >= 0.05);

  // 胸囲: 馬体重と強く連動。
  const withCW = pool.filter((x) => x.chestGirth !== null && x.weight !== null);
  const rcw = pearsonCorrelation(
    withCW.map((x) => x.chestGirth as number),
    withCW.map((x) => x.weight as number)
  );
  claim('胸囲: 馬体重と強く連動（r>0.6）', rcw !== null && rcw > 0.6);

  // 管囲: 牡は関係なし。牝は弱い正で、細い1/3だけが沈む（真ん中・太い1/3は細い1/3より高い）。
  const cm = caretFacts(pool, '牡');
  const cf = caretFacts(pool, '牝');
  claim('管囲: 牡は有意でなく|r|が小さい', cm.r !== null && Math.abs(cm.r) < 0.1 && cm.p !== null && cm.p >= 0.05);
  claim('管囲: 牝は弱い正の相関（0<r<0.2）', cf.r !== null && cf.r > 0 && cf.r < 0.2);
  const femaleThinMed = median(
    racedOnly(cf.rows.filter((x) => (x.caretGirth as number) < cf.t.lo)).map((x) => x.totalPrizeManYen)
  );
  const femaleMidMed = median(
    racedOnly(cf.rows.filter((x) => (x.caretGirth as number) >= cf.t.lo && (x.caretGirth as number) < cf.t.hi)).map(
      (x) => x.totalPrizeManYen
    )
  );
  const femaleThickMed = median(
    racedOnly(cf.rows.filter((x) => (x.caretGirth as number) >= cf.t.hi)).map((x) => x.totalPrizeManYen)
  );
  claim('管囲: 牝は細い1/3の賞金中央値が最も低い', femaleThinMed < femaleMidMed && femaleThinMed < femaleThickMed);

  // 生まれ月: 早生まれ・小さいが最低、有意差なし、境目の中央値。
  const b = birthQuadrantStats(pool);
  const quads: Quadrant[] = ['早生まれ・大きい', '早生まれ・小さい', '遅生まれ・大きい', '遅生まれ・小さい'];
  const lowest = [...quads].sort((x, y) => b.stat(x).avgPrize - b.stat(y).avgPrize)[0];
  claim('生まれ月: 平均賞金が最も低いのは「早生まれ・小さい」', lowest === '早生まれ・小さい');
  claim('生まれ月: 小さい馬どうしの差は有意でない', b.smallTestP >= 0.05);
  claim('生まれ月: 大きい馬どうしの差は有意でない', b.bigTestP >= 0.05);
  claim('生まれ月: 誕生日の中央値が早生まれの境目と一致', b.doyMedian === EARLY_CUTOFF);
  claim(
    '生まれ月: 「遅生まれ・小さい」は「早生まれ・小さい」より平均賞金が高い',
    b.stat('遅生まれ・小さい').avgPrize > b.stat('早生まれ・小さい').avgPrize
  );

  // 母齢: ほぼ無相関。
  const withAge = racedOnly(pool.filter((x) => x.damAge !== null));
  const ra = pearsonCorrelation(
    withAge.map((x) => x.damAge as number),
    withAge.map((x) => x.totalPrizeManYen)
  );
  claim('母齢: ほぼ無相関（|r|<0.05）', ra !== null && Math.abs(ra) < 0.05);

  // 産次: ほぼ無相関、3番仔以内/4番仔以降・初仔・空胎明けはどれも有意でない。
  const pf = parityFacts(pool);
  claim('産次: ほぼ無相関（|r|<0.05）', pf.r !== null && Math.abs(pf.r) < 0.05);
  claim('産次: 3番仔以内vs4番仔以降は有意でない', pf.upto3P !== null && pf.upto3P >= 0.05);
  claim('産次: 初仔vs2番仔以降は有意でなく、初仔の方が低い', pf.firstP !== null && pf.firstP >= 0.05 && pf.firstRate < pf.notFirstRate);
  claim('産次: 空胎明けは有意でなく、空胎明けの方が高い', pf.restP !== null && pf.restP >= 0.05 && pf.afterRestRate > pf.consecutiveRate);

  // 母の出身クラブ: 出走率は全体より高く、重賞馬は0頭、賞金中央値は全体より低い。
  const g = groupByDamOrigin(damResults as RawDam[], CLUB_MATURE_BIRTH_YEAR);
  claim('母の出身クラブ: 出走率が全体以上', g.stats.majorClub.debutRate >= g.allStats.debutRate);
  claim('母の出身クラブ: 重賞馬が0頭', g.stats.majorClub.gradeWinners === 0);
  claim(
    '母の出身クラブ: 勝ち上がり率が全体を10pt以上下回らない（極端に低くない）',
    g.stats.majorClub.winRate >= g.allStats.winRate - 0.1
  );
  claim('母の出身クラブ: 賞金中央値が全体より低い', g.stats.majorClub.medianPrize < g.allStats.medianPrize);

  // 厩舎: 10位以内かどうかの差は有意でない。
  const sf = stableFacts(pool, leadingRankOf);
  claim('厩舎: リーディング10位以内かどうかの重賞馬率の差は有意でない', sf.p !== null && sf.p >= 0.05);

  return broken;
}
