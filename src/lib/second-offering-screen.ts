/**
 * 分析記事「第2次募集の15頭を、過去のデータで見比べる」用の判定ロジック。
 *
 * 物差しの根拠は [[20260913-size-predicts-roi-for-fillies-only]]（project scope, secondBrain）と
 * 同じ定義: 2017〜2023年度募集の牝（一口価格が判明している馬）で、募集時の馬体重・胸囲の
 * 中央値を計算し、「両方とも中央値を厳密に上回る」群と「それ以外」で回収率を比べる。
 * **「中央値超」は厳密に上回る場合だけ**（境界値ちょうどは含めない）。この定義で母集団を
 * 切ると n=113/172・回収率100%超35%/18%・中央値57%/18%と知見ノートの数値に一致する
 * （`>=`にすると119/166に割れてノートの数値と合わなくなる）。
 *
 * 牡は募集時データで有意な指標が無い（同ノート）ため、群分けはしない
 * （`screenSecondOffering`は牡をNo.順に並べるだけ）。
 */
import type { Horse } from './horses.ts';
import type { RecruitWithResult } from './analysis-data.ts';
import type { RawDam, RawFoal } from './dam-siblings.ts';
import { netkeibaHorseId } from './sibling-recruits.ts';
import { median, twoProportionZTest } from './chart-math.ts';

/** 回収率（％）＝獲得賞金 ÷ 募集総額。secondary-offering.astro / stable-leading.astro と同じ式。 */
export function roiPctOf(
  h: Pick<RecruitWithResult, 'offeringTotalManYen' | 'totalPrizeManYen'>,
): number | null {
  if (h.offeringTotalManYen === null || h.offeringTotalManYen <= 0) return null;
  return (h.totalPrizeManYen / h.offeringTotalManYen) * 100;
}

export interface RoiGroupStats {
  /** 募集総額（＝回収率）が計算できた頭数。 */
  n: number;
  medianRoiPct: number;
  over100Count: number;
  over100RatePct: number;
}

function roiGroupStatsOf(group: readonly RecruitWithResult[]): RoiGroupStats {
  const priced = group
    .map((h) => ({ h, roi: roiPctOf(h) }))
    .filter((r): r is { h: RecruitWithResult; roi: number } => r.roi !== null);
  const rois = priced.map((r) => r.roi);
  const over100Count = rois.filter((r) => r > 100).length;
  return {
    n: priced.length,
    medianRoiPct: median(rois),
    over100Count,
    over100RatePct: priced.length > 0 ? (100 * over100Count) / priced.length : 0,
  };
}

/** 四分位数（線形補間・R-7/numpyの既定と同じ方式）。`sortedValues`は昇順ソート済みであること。 */
function quantile(sortedValues: readonly number[], q: number): number {
  if (sortedValues.length === 0) return NaN;
  const pos = (sortedValues.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sortedValues[base + 1];
  return next === undefined ? sortedValues[base] : sortedValues[base] + rest * (next - sortedValues[base]);
}

export interface FillyBenchmark {
  /** 母集団の頭数（2017〜2023年度募集・牝・一口価格判明・測尺判明）。 */
  n: number;
  medianWeightKg: number;
  medianChestGirthCm: number;
  /**
   * 体重の下位1/4の境界（第1四分位数、線形補間法）。**この値未満**が「下位1/4」
   * （中央値の「厳密に上回る」と対になる書き方で、境界値ちょうどは下位1/4に含めない）。
   */
  bottomQuartileWeightBoundaryKg: number;
  /** 体重・胸囲とも中央値を厳密に上回る群。 */
  above: RoiGroupStats;
  /** それ以外（どちらか一方でも中央値以下）の群。 */
  restOrEqual: RoiGroupStats;
  /** 100%超の割合の差の検定（two-proportion z-test。期待成功数は両群とも28件以上あり正規近似が使える）。 */
  over100RateTest: { z: number; p: number };
}

const BENCHMARK_YEAR_MIN = 2017;
const BENCHMARK_YEAR_MAX = 2023;

/**
 * 牝・2017〜2023年度募集・一口価格判明馬の母集団から、体格の物差し（中央値・下位1/4境界）と
 * 回収率の群間比較を計算する。
 */
export function computeFillyBenchmark(recruits: readonly RecruitWithResult[]): FillyBenchmark {
  const population = recruits.filter(
    (h) =>
      h.sex === '牝' &&
      h.recruitYear >= BENCHMARK_YEAR_MIN &&
      h.recruitYear <= BENCHMARK_YEAR_MAX &&
      h.pricePerShare !== null &&
      h.weight !== null &&
      h.chestGirth !== null,
  );

  const weights = population.map((h) => h.weight as number);
  const chestGirths = population.map((h) => h.chestGirth as number);
  const medianWeightKg = median(weights);
  const medianChestGirthCm = median(chestGirths);
  const bottomQuartileWeightBoundaryKg = quantile([...weights].sort((a, b) => a - b), 0.25);

  const isAbove = (h: RecruitWithResult) =>
    (h.weight as number) > medianWeightKg && (h.chestGirth as number) > medianChestGirthCm;
  const above = population.filter(isAbove);
  const restOrEqual = population.filter((h) => !isAbove(h));

  const aboveStats = roiGroupStatsOf(above);
  const restStats = roiGroupStatsOf(restOrEqual);
  const over100RateTest = twoProportionZTest(
    aboveStats.over100Count,
    aboveStats.n,
    restStats.over100Count,
    restStats.n,
  );

  return {
    n: population.length,
    medianWeightKg,
    medianChestGirthCm,
    bottomQuartileWeightBoundaryKg,
    above: aboveStats,
    restOrEqual: restStats,
    over100RateTest,
  };
}

export type FemaleSizeCategory = 'both-above' | 'one-above' | 'below-median' | 'bottom-quartile-weight';

/** 記事に出す表示順（両方超→片方だけ→どちらも以下→下位1/4）。 */
export const FEMALE_SIZE_CATEGORY_ORDER: readonly FemaleSizeCategory[] = [
  'both-above',
  'one-above',
  'below-median',
  'bottom-quartile-weight',
];

export const FEMALE_SIZE_CATEGORY_LABEL: Readonly<Record<FemaleSizeCategory, string>> = {
  'both-above': '体重・胸囲とも中央値超',
  'one-above': '体重・胸囲のどちらか一方だけ中央値超',
  'below-median': 'どちらも中央値以下',
  'bottom-quartile-weight': '体重が過去の下位1/4',
};

/**
 * 牝の体格を`FillyBenchmark`と突き合わせて群に分ける。
 * 判定順: 両方中央値超 → 片方だけ中央値超 → （残り）体重が下位1/4か → どちらも中央値以下。
 */
export function categorizeFilly(
  horse: { weight: number; chestGirth: number },
  benchmark: Pick<FillyBenchmark, 'medianWeightKg' | 'medianChestGirthCm' | 'bottomQuartileWeightBoundaryKg'>,
): FemaleSizeCategory {
  const weightAbove = horse.weight > benchmark.medianWeightKg;
  const chestAbove = horse.chestGirth > benchmark.medianChestGirthCm;
  if (weightAbove && chestAbove) return 'both-above';
  if (weightAbove || chestAbove) return 'one-above';
  if (horse.weight < benchmark.bottomQuartileWeightBoundaryKg) return 'bottom-quartile-weight';
  return 'below-median';
}

/**
 * 地方所属予定の馬（クラブ発表の厩舎欄に「A厩舎or B厩舎」の形で複数候補が併記されている）。
 * 2026年度第2次募集ではNo.91〜94がこれに当たる（`horses2026.ts`の`stable`列から機械判定。
 * 直書きしない）。
 */
export function isRegionalStablePending(horse: Pick<Horse, 'stable'>): boolean {
  return horse.stable.includes('or');
}

export interface FemaleScreenRow {
  horse: Horse;
  category: FemaleSizeCategory;
  regionalStablePending: boolean;
}

export interface MaleScreenRow {
  horse: Horse;
  regionalStablePending: boolean;
}

export interface SecondOfferingScreen {
  benchmark: FillyBenchmark;
  /** 表示順（群→No.昇順）に並べ済み。 */
  females: FemaleScreenRow[];
  /** No.昇順に並べ済み。群分けはしない。 */
  males: MaleScreenRow[];
}

/**
 * 対象馬ID（募集番号）の集合を、性別で牝は群分け・牡は素通しで整形する。
 * `targetIds`の順序には依存しない。
 */
export function screenSecondOffering(
  horses: readonly Horse[],
  targetIds: readonly string[],
  recruits: readonly RecruitWithResult[],
): SecondOfferingScreen {
  const benchmark = computeFillyBenchmark(recruits);
  const byId = new Map(horses.map((h) => [h.id, h]));
  const targets = targetIds.map((id) => byId.get(id)).filter((h): h is Horse => h !== undefined);

  const females = targets
    .filter((h) => h.sex === '牝')
    .map((h) => ({
      horse: h,
      category: categorizeFilly(h, benchmark),
      regionalStablePending: isRegionalStablePending(h),
    }))
    .sort((a, b) => {
      const orderDiff =
        FEMALE_SIZE_CATEGORY_ORDER.indexOf(a.category) - FEMALE_SIZE_CATEGORY_ORDER.indexOf(b.category);
      return orderDiff !== 0 ? orderDiff : Number(a.horse.id) - Number(b.horse.id);
    });

  const males = targets
    .filter((h) => h.sex === '牡')
    .map((h) => ({ horse: h, regionalStablePending: isRegionalStablePending(h) }))
    .sort((a, b) => Number(a.horse.id) - Number(b.horse.id));

  return { benchmark, females, males };
}

/**
 * 兄姉に重賞勝ち馬がいる馬を探す（どのクラブの募集歴でもよい。`sibling-recruits.ts`の
 * `findSiblingRecruits`は「キャロットで募集された兄姉」しか拾えない一方、`dam-siblings.json`
 * は母の産駒全頭を持っているので、キャロット外・海外・引退済みの兄姉の重賞勝ちも拾える
 * （実例: No.20 マハーバーラタの25の半兄ヒンドゥタイムズは2017年より前に生まれておりキャロット
 * 募集データには無いが、`dam-siblings.json`側には載っている）。
 */
export function gradeWinningSiblingsOf(
  horse: Pick<Horse, 'damUrl'>,
  damRoster: ReadonlyMap<string, RawDam>,
): RawFoal[] {
  const damId = netkeibaHorseId(horse.damUrl);
  if (damId === null) return [];
  const dam = damRoster.get(damId);
  if (!dam) return [];
  return dam.foals.filter((f) => f.gradeWins.length > 0);
}
