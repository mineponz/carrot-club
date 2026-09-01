/**
 * 分析記事「母がサンデーレーシング出身の募集馬は走っているのか」用のデータ整形・集計。
 *
 * 素材は `analysis/data/dam-siblings.json`（`scripts/build-dam-siblings.mjs` が生成）。
 * 母ごとに「その母の全産駒がどのクラブで募集されたか・現在の成績」と、
 * **母自身がどのクラブの現役馬だったか**（`damClub`）を持つ。
 *
 * ★切り口の要点: 「サンデー・シルク・G1レーシング（以下まとめて『向こうのクラブ』）が先に
 * 募集して、残りがキャロットに回ってくる」を検証するには**母自身の出身クラブ**で切る。
 * 「母が両クラブに産駒を出している」という条件は対称で方向を区別できず、母がキャロットの繁殖
 * （産駒がキャロットに来るのが自然で、他クラブに出た1頭のほうが例外）まで拾ってしまう。
 *
 * G1レーシングもサンデー・シルクと同じく高額少口で先に取るクラブなので同じ群に畳んでいる
 * （2026-09-01追加）。
 *
 * このモジュールは **JSON を import しない純関数の集まり**（`sibling-recruits.ts` と同じ方針）。
 * `node --test` で検証できるよう、データは呼び出し側（`club-siblings.astro`）から配列で渡す。
 */

export type ClubLabel =
  | 'carrot'
  | 'sunday'
  | 'silk'
  | 'shadai-rh'
  | 'g1'
  | 'lord'
  | 'normandy'
  | 'tokyo-tc'
  | 'club-other'
  | 'club-unknown'
  | 'private'
  | 'unknown'
  | 'fetch-failed';

export interface RawFoal {
  year: number;
  horseId: string | null;
  url: string | null;
  name: string | null;
  /** 牡/牝/セン。母の産駒一覧の性別列から（2026-08-30に追加）。 */
  sex: string | null;
  /** 父。母の産駒一覧の父名列から（2026-08-30に追加）。 */
  sire: string | null;
  /** 生年月日（YYYY-MM-DD）。個体ページから取れなかった馬は null（2026-08-30に追加）。 */
  birthDate: string | null;
  ownerRaw: string | null;
  ownerId: string | null;
  breederRaw: string | null;
  /** 募集したクラブ。キャロット募集馬は recruits.json / horses2026.ts を正として補正済み。 */
  club: ClubLabel;
  /** 馬主欄だけから判定した値（補正前）。 */
  clubByOwner: ClubLabel;
  isCarrotRecruit: boolean;
  recruitYear: number | null;
  sundaySilkCandidate: boolean;
  shares: number | null;
  pricePerShareManYen: number | null;
  starts: number | null;
  wins: number | null;
  chuoPrizeManYen: number | null;
  chihoPrizeManYen: number | null;
  totalPrizeManYen: number | null;
  mainWins: string[];
  gradeWins: string[];
  recordFound: boolean;
  note: string | null;
}

export interface RawDam {
  damId: string | null;
  damName: string | null;
  damUrl: string | null;
  /** ★母自身がどのクラブの現役馬だったか。 */
  damClub: ClubLabel;
  damOwnerRaw: string | null;
  damShares: number | null;
  damStarts: number | null;
  damWins: number | null;
  carrotRecruits: { recruitYear: number; no: string; name: string }[];
  foals: RawFoal[];
  note?: string;
}

/** 母が向こうのクラブ（サンデー・シルク・G1レーシング）の現役馬だった。 */
export const isMajorClubOrigin = (d: RawDam): boolean =>
  d.damClub === 'sunday' || d.damClub === 'silk' || d.damClub === 'g1';
/** 産駒が向こうのクラブ（サンデー・シルク・G1レーシング）で募集された。 */
export const isMajorClubFoal = (f: RawFoal): boolean =>
  f.club === 'sunday' || f.club === 'silk' || f.club === 'g1';
/** 出走した（0戦引退でない）。成績行が無い外国調教馬は starts=null で対象外。 */
export const hasRaced = (f: RawFoal): boolean => (f.starts ?? 0) > 0;

/** 記事の集計対象＝走る時間が十分な世代（この生年以前）。 */
export const MATURE_BIRTH_YEAR = 2021;
/** 母内比較の対象＝両群が出走可能な世代（この生年以前）。 */
export const SPLIT_MAX_BIRTH_YEAR = 2021;

// ---- 基本統計 ---------------------------------------------------------------

export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export interface GroupStats {
  /** 対象頭数。 */
  n: number;
  /** 成績が判明している頭数（出走率の分母）。 */
  withRecord: number;
  /** 出走した頭数。 */
  raced: number;
  /** 出走率 = raced / withRecord。 */
  debutRate: number;
  /** 出走馬の獲得賞金合計（万円）の中央値。 */
  medianPrize: number;
  meanPrize: number;
  maxPrize: number;
  /** 出走馬のうち1勝以上した割合。 */
  winRate: number;
  gradeWinners: number;
  gradeRate: number;
}

export function summarize(foals: readonly RawFoal[]): GroupStats {
  const withRecord = foals.filter((f) => f.starts != null);
  const raced = withRecord.filter(hasRaced);
  const prizes = raced.map((f) => f.totalPrizeManYen ?? 0);
  const winners = raced.filter((f) => (f.wins ?? 0) > 0);
  const grade = foals.filter((f) => f.gradeWins.length > 0);
  return {
    n: foals.length,
    withRecord: withRecord.length,
    raced: raced.length,
    debutRate: withRecord.length ? raced.length / withRecord.length : 0,
    medianPrize: median(prizes),
    meanPrize: mean(prizes),
    maxPrize: prizes.length ? Math.max(...prizes) : 0,
    winRate: raced.length ? winners.length / raced.length : 0,
    gradeWinners: grade.length,
    gradeRate: foals.length ? grade.length / foals.length : 0,
  };
}

// ---- 群1: 母の出身クラブ別に、キャロット募集馬の成績を比べる ------------------

/**
 * 記事で並べる群のキー。`majorClub` は向こうのクラブ（サンデー・シルク・G1レーシング）、
 * `other` は社台RH等の少数クラブをまとめたもの。
 */
export type DamOriginKey = 'majorClub' | 'carrot' | 'private' | 'unknown' | 'other';

export interface OriginGroups {
  matureBirthYear: number;
  /** 群ごとのキャロット募集馬。 */
  foals: Record<DamOriginKey, RawFoal[]>;
  stats: Record<DamOriginKey, GroupStats>;
  /** 全キャロット募集馬（同世代）。 */
  all: RawFoal[];
  allStats: GroupStats;
  /** 母が向こうのクラブ（サンデー・シルク・G1レーシング）出身だった母の数（生年フィルタ前）。 */
  majorClubDamCount: number;
}

function originKey(damClub: ClubLabel): DamOriginKey {
  if (damClub === 'sunday' || damClub === 'silk' || damClub === 'g1') return 'majorClub';
  if (damClub === 'carrot') return 'carrot';
  if (damClub === 'private') return 'private';
  if (damClub === 'unknown' || damClub === 'fetch-failed') return 'unknown';
  return 'other';
}

/**
 * キャロット募集馬を「母の出身クラブ」で分ける。`matureBirthYear` 以前生まれに限る
 * （まだ走る時間が無い世代を混ぜると出走率・賞金が不当に下がる）。
 */
export function groupByDamOrigin(
  results: readonly RawDam[],
  matureBirthYear: number = MATURE_BIRTH_YEAR,
): OriginGroups {
  const foals: Record<DamOriginKey, RawFoal[]> = {
    majorClub: [],
    carrot: [],
    private: [],
    unknown: [],
    other: [],
  };
  const all: RawFoal[] = [];
  let majorClubDamCount = 0;
  for (const d of results) {
    if (isMajorClubOrigin(d)) majorClubDamCount++;
    const key = originKey(d.damClub);
    for (const f of d.foals) {
      if (!f.isCarrotRecruit || f.year > matureBirthYear) continue;
      foals[key].push(f);
      all.push(f);
    }
  }
  const stats = Object.fromEntries(
    (Object.keys(foals) as DamOriginKey[]).map((k) => [k, summarize(foals[k])]),
  ) as Record<DamOriginKey, GroupStats>;
  return {
    matureBirthYear,
    foals,
    stats,
    all,
    allStats: summarize(all),
    majorClubDamCount,
  };
}

// ---- 群2: 同じ母で「同クラブに残った仔」vs「キャロットに来た仔」 --------------

export interface DamSplit {
  dam: RawDam;
  /** 向こうのクラブ（サンデー・シルク・G1レーシング）で募集された仔（＝母の出身クラブ側に残った仔）。 */
  stayed: RawFoal[];
  /** キャロットで募集された仔。 */
  came: RawFoal[];
}

export interface SplitView {
  splits: DamSplit[];
  stayedAll: RawFoal[];
  cameAll: RawFoal[];
  stayedStats: GroupStats;
  cameStats: GroupStats;
}

/**
 * 母が向こうのクラブ（サンデー・シルク・G1レーシング）出身で、かつ**同じクラブでも募集が
 * あった仔とキャロットに来た仔の両方がいる**母だけを取り出し、その母の中で成績を比べる。
 * 記事のメイン比較表。
 * 両群とも `maxYear` 以前生まれ・成績が判明しているものに限る。
 * 表示順は「その母の稼ぎ頭の賞金」降順。
 */
export function buildDamSplits(
  results: readonly RawDam[],
  maxYear: number = SPLIT_MAX_BIRTH_YEAR,
): SplitView {
  const usable = (f: RawFoal) => f.year <= maxYear && f.starts != null;
  const splits: DamSplit[] = [];
  for (const dam of results) {
    if (!isMajorClubOrigin(dam)) continue;
    const stayed = dam.foals.filter((f) => isMajorClubFoal(f) && usable(f));
    const came = dam.foals.filter((f) => f.club === 'carrot' && usable(f));
    if (!stayed.length || !came.length) continue;
    splits.push({ dam, stayed, came });
  }
  const best = (s: DamSplit) =>
    Math.max(...[...s.stayed, ...s.came].map((f) => f.totalPrizeManYen ?? 0));
  splits.sort((a, b) => best(b) - best(a));
  const stayedAll = splits.flatMap((s) => s.stayed);
  const cameAll = splits.flatMap((s) => s.came);
  return {
    splits,
    stayedAll,
    cameAll,
    stayedStats: summarize(stayedAll),
    cameStats: summarize(cameAll),
  };
}

// ---- 群3: 兄姉が向こうのクラブで重賞を勝っているのにキャロットに来た馬 --------

export interface GradeSiblingCase {
  dam: RawDam;
  /**
   * 向こうのクラブ（サンデー・シルク・G1レーシング）で募集された兄姉**全頭**（生年昇順）。
   * 重賞を勝っていない仔も含む。重賞馬だけを出すと「向こうは走る馬ばかり」に見えてしまい
   * 比較として不公平になるため（例: ライジングクロスはクロワデュノールだけでなく
   * チャリングクロスもいる）。
   */
  majorClubFoals: RawFoal[];
  /** うち重賞を勝った兄姉。 */
  gradeSiblings: RawFoal[];
  /** 同じ母からキャロットに来た仔（生年昇順）。 */
  carrotFoals: RawFoal[];
}

/**
 * 「向こうで重賞馬が出ている母なのに、この仔はキャロットに来た」ケース。
 * 母がキャロット出身の馬は除く（母がキャロットの繁殖なら産駒がキャロットに来るのが
 * 自然で、「回ってきた」に当たらないため）。
 * 表示順は重賞兄姉の獲得賞金降順（話題性の大きい順）。
 */
export function buildGradeSiblingCases(results: readonly RawDam[]): GradeSiblingCase[] {
  const cases: GradeSiblingCase[] = [];
  for (const dam of results) {
    if (dam.damClub === 'carrot') continue;
    const majorClubFoals = dam.foals.filter(isMajorClubFoal).sort((a, b) => a.year - b.year);
    const gradeSiblings = majorClubFoals.filter((f) => f.gradeWins.length > 0);
    const carrotFoals = dam.foals.filter((f) => f.club === 'carrot').sort((a, b) => a.year - b.year);
    if (!gradeSiblings.length || !carrotFoals.length) continue;
    cases.push({ dam, majorClubFoals, gradeSiblings, carrotFoals });
  }
  cases.sort(
    (a, b) =>
      Math.max(...b.gradeSiblings.map((f) => f.totalPrizeManYen ?? 0)) -
      Math.max(...a.gradeSiblings.map((f) => f.totalPrizeManYen ?? 0)),
  );
  return cases;
}

// ---- 最新年度の募集馬（記事のリードで使う） -----------------------------------

export interface CurrentRecruit {
  dam: RawDam;
  no: string;
  name: string;
  /**
   * 同じ母の、向こうのクラブ（サンデー・シルク・G1レーシング）で募集された仔
   * （＝この馬の兄姉）。生年昇順。
   */
  majorClubSiblings: RawFoal[];
}

/**
 * 指定年度の募集馬のうち、母が向こうのクラブ（サンデー・シルク・G1レーシング）出身のものを
 * No. 昇順で返す。
 */
export function currentYearMajorClubRecruits(
  results: readonly RawDam[],
  recruitYear: number,
): CurrentRecruit[] {
  const out: CurrentRecruit[] = [];
  for (const dam of results) {
    if (!isMajorClubOrigin(dam)) continue;
    for (const r of dam.carrotRecruits) {
      if (r.recruitYear !== recruitYear) continue;
      out.push({
        dam,
        no: r.no,
        name: r.name,
        majorClubSiblings: dam.foals.filter(isMajorClubFoal).sort((a, b) => a.year - b.year),
      });
    }
  }
  return out.sort((a, b) => Number(a.no) - Number(b.no));
}

// ---- 検定 -----------------------------------------------------------------

/** 標準正規の両側p値。 */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}
export function twoSidedP(z: number): number {
  return 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
}

/** Mann-Whitney U 検定（正規近似・同順位は平均順位）。 */
export function mannWhitney(a: readonly number[], b: readonly number[]): { z: number; p: number } {
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort(
    (x, y) => x.v - y.v,
  );
  const ranks = new Array<number>(all.length);
  let i = 0;
  while (i < all.length) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const r = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[k] = r;
    i = j + 1;
  }
  let R1 = 0;
  all.forEach((o, idx) => {
    if (o.g === 0) R1 += ranks[idx];
  });
  const n1 = a.length;
  const n2 = b.length;
  if (!n1 || !n2) return { z: 0, p: 1 };
  const U1 = R1 - (n1 * (n1 + 1)) / 2;
  const U = Math.min(U1, n1 * n2 - U1);
  const z = (U - (n1 * n2) / 2) / Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  return { z, p: twoSidedP(z) };
}

/**
 * 2群の比率の差の検定。**期待度数が5未満なら正規近似は信頼できない**ので `usable: false` を
 * 返す（重賞馬のような少数イベントを細かく切ると簡単に割る）。`usable` を見ずに p を読まないこと。
 */
export function twoProportionTest(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
): { z: number; p: number; usable: boolean; minExpected: number } {
  if (!n1 || !n2) return { z: 0, p: 1, usable: false, minExpected: 0 };
  const pooled = (x1 + x2) / (n1 + n2);
  const expected = [pooled * n1, pooled * n2, (1 - pooled) * n1, (1 - pooled) * n2];
  const minExpected = Math.min(...expected);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  const z = se === 0 ? 0 : (x1 / n1 - x2 / n2) / se;
  return { z, p: twoSidedP(z), usable: minExpected >= 5, minExpected };
}

/**
 * 「本来 p の確率で起きる事象が n 回中1度も起きない」確率。
 * 重賞馬0頭を検定の代わりに説明するのに使う（期待度数が足りず比率の検定が使えないため）。
 */
export function probabilityOfZero(p: number, n: number): number {
  return Math.pow(1 - p, n);
}

// ---- 表示ヘルパ -----------------------------------------------------------------

export const CLUB_JP: Record<string, string> = {
  carrot: 'キャロット',
  sunday: 'サンデーレーシング',
  silk: 'シルクレーシング',
  'shadai-rh': '社台レースホース',
  g1: 'G1レーシング',
  lord: 'ロード',
  normandy: 'ノルマンディー',
  'tokyo-tc': '東京TC',
  'club-other': '他クラブ',
  'club-unknown': 'クラブ（名義変更）',
  private: '個人馬主',
  unknown: '—',
  'fetch-failed': '—',
};

/** 群の日本語ラベル（記事の表・グラフで使う）。 */
export const ORIGIN_JP: Record<DamOriginKey, string> = {
  majorClub: '母がサンデー・シルク・G1レーシング出身',
  carrot: '母がキャロット出身',
  private: '母が個人馬主の馬',
  unknown: '母が海外・その他',
  other: '母がその他クラブ出身',
};

/** "n戦n勝" 表記。成績不明は "—"。 */
export function recordText(f: RawFoal): string {
  if (f.starts == null) return '—';
  return `${f.starts}戦${f.wins ?? 0}勝`;
}

/** 重賞名から年・グレードを落として短くする（"23'オールカマー(G2)" → "オールカマー(G2)"）。 */
export function shortGradeName(win: string): string {
  return win.replace(/^\d{2}'/, '');
}
