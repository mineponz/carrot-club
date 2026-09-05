/**
 * `analysis/data/recruits.json`（2017〜2025年募集の全頭の募集時データ）と
 * `analysis/data/race-results.json`（現在の競走成績）をnetkeibaUrlで結合する。
 * 分析記事ページ（`src/pages/articles/*`）から使う。
 *
 * `analysis/` は `src/` の外（サイト表示用の `src/data/horsesYYYY.ts` とは別系統）。
 * `node:fs` + `import.meta.url` で読むと、ビルド後は `import.meta.url` が
 * バンドル先チャンクの場所を指すため相対パスが壊れる（`dist/.prerender/chunks/...` 基準に
 * なってしまう）。ViteのJSON importはビルド時に解決されるのでこの問題が起きない。
 */
import recruitsJson from '../../analysis/data/recruits.json';
import raceResultsJson from '../../analysis/data/race-results.json';
import damSiblingsJson from '../../analysis/data/dam-siblings.json';
import leadingTrainersJson from '../../analysis/data/leading-trainers.json';
import { damNameFromRecruitName, normalizeDamName } from './horse-meta.ts';
import type { RawDam } from './dam-siblings.ts';

export interface Recruit {
  recruitYear: number;
  no: string;
  /** 募集時点の仮の名前（例: "ナスケンアイリスの20"）。登録後の実名とは別物。 */
  name: string;
  sex: string | null;
  netkeibaUrl: string | null;
  /**
   * 母馬のnetkeiba個体ページ。スプレッドシートに母の列があるのは2024・2025年募集ぶんだけで、
   * 2021〜2023年募集は null（2017〜2020年募集ぶんは後からnetkeiba検索で埋めた）。
   * 同じ母の産駒（兄弟）を突き合わせるのに使う。
   */
  damUrl: string | null;
  /** 母馬名。2017〜2020年募集の取込元にだけある列（他の年度は無し）。 */
  damName?: string | null;
  /** 母馬名。2022年募集の取込元にだけある列（他の年度は無し）。 */
  dam?: string | null;
  sire: string | null;
  broodmareSire: string | null;
  /** 母齢（募集年 - 母の生年）。血統表ページから取得できなかった場合はnull。 */
  damAge: number | null;
  /**
   * 産次（母がその仔を何番目に産んだか。1=初仔）。母の産駒一覧ページの生年昇順での順位で、
   * 空胎年は行自体が無いため「実際に産んだ仔の中で何番目か」になる。
   * 取得方法は`scripts/fetch-birth-order.mjs`。取得できなかった場合はnull。
   */
  damParity: number | null;
  /** 母の産駒総数（産駒一覧ページに載っている頭数）。取得できなかった場合はnull。 */
  damProduceCount: number | null;
  /**
   * 直前の仔との出産間隔（年）。1なら連産、2以上なら間に空胎年がある（＝空胎明け）。
   * 初仔（直前の仔がいない）と未取得はnull。
   */
  damGapBeforeYears: number | null;
  /** 生年月日（YYYY-MM-DD）。個体ページから取得できなかった場合はnull。 */
  birthDate: string | null;
  pricePerShare: number | null;
  /**
   * 募集口数（一口の値段ではなく総口数）。大半は400口、一部100口、高額馬は40口など。
   * netkeibaの「募集情報」欄（`OwnerUnitPrice`の`<span>N口</span>`）から取得
   * （`scripts/enrich-share-count.mjs`）。現在の馬主がクラブ名義でない馬などnetkeibaに
   * 募集情報が載っていない馬は null（回収率の計算では既定の400口として扱う）。
   */
  shareCount: number | null;
  height: number | null;
  chestGirth: number | null;
  caretGirth: number | null;
  weight: number | null;
  /**
   * 現（最終）担当調教師名。netkeiba個体ページの「調教師」欄から取得
   * （`scripts/enrich-trainer-region.mjs`）。欄が空なら null。
   * 引退・厩舎解散後もこの欄は最後に在籍した厩舎を保持する。
   */
  finalTrainer?: string | null;
  /** netkeibaの調教師ID（例: "01070"）。欄が空なら null。 */
  finalTrainerId?: string | null;
  /** 調教師名の後ろの括弧内をそのまま（"美浦" / "栗東" / "大井" 等）。無ければ null。 */
  trainerAffiliation?: string | null;
  /**
   * 最終所属。"東"(美浦) / "西"(栗東) / "地方"(それ以外の所属) / "不明"(調教師欄が空)。
   * **募集時ではなく現在の所属**なので、募集後に地方へ移った馬は "地方" になる。
   */
  region?: '東' | '西' | '地方' | '不明' | null;
}

/**
 * 募集口数が取れなかった馬を回収率の計算に含めるときに使う既定値。
 * 口数が判明している642頭のうち96%（616頭）が400口なので、不明分はこの値で近似する。
 */
export const DEFAULT_SHARE_COUNT = 400;

export interface RaceResult {
  netkeibaUrl: string;
  /** 競走馬登録後の実名。募集時の仮の名前とは別に付けられる。未登録なら null。 */
  name: string | null;
  chuoPrizeManYen: number | null;
  chihoPrizeManYen: number | null;
  starts: number | null;
  wins: number | null;
  seconds: number | null;
  thirds: number | null;
  others: number | null;
  /** 主な勝鞍（レース名。例: "23'日本ダービー(G1)"）。無ければ空配列。 */
  mainWins: string[];
  /** 主な勝鞍のうち重賞(G1〜G3・Jpn1〜3)のみ。 */
  gradeWins: string[];
}

export interface RecruitWithResult
  extends Omit<Recruit, 'name' | 'damName' | 'dam'>,
    Omit<RaceResult, 'netkeibaUrl' | 'name'> {
  /** 募集時の仮の名前。 */
  recruitName: string;
  /**
   * 母馬名（正規化済み。分からなければ null）。取込元の列が年度でばらばら
   * （2017〜2020は`damName`、2022は`dam`、それ以外は募集名「<母馬名>の<生年>」）なので
   * ここで1本に揃える。母のnetkeiba個体ページが無い2021〜2023年募集の兄姉を
   * 突き合わせるのに使う（`sibling-recruits.ts`）。
   */
  damName: string | null;
  /** 競走馬登録後の実名（無ければ null。募集直後でまだ未登録の場合など）。 */
  realName: string | null;
  /** 表示用の名前。実名があればそちらを優先する。 */
  displayName: string;
  /** 中央獲得賞金＋地方獲得賞金の合計（万円）。どちらもnullなら0扱い。 */
  totalPrizeManYen: number;
  /**
   * 募集総額（万円）＝ 一口価格 × 口数。口数が不明な馬は `DEFAULT_SHARE_COUNT` で近似する。
   * 一口価格が無い馬は null。
   */
  offeringTotalManYen: number | null;
  /** 募集口数が実データで判明しているか（false＝`DEFAULT_SHARE_COUNT`で近似）。 */
  shareCountKnown: boolean;
}

/** 成績（賞金・勝ち数）を取得した時点。「いつ時点の成績か」を画面に出すのに使う。 */
export const RACE_RESULTS_FETCHED_AT: string = raceResultsJson.fetchedAt;

let cache: RecruitWithResult[] | null = null;

/** 全頭ぶんを結合して返す（成績が取れていない馬は成績側の値がすべてnull）。 */
export function loadRecruitsWithResults(): RecruitWithResult[] {
  if (cache) return cache;

  const recruits = recruitsJson as unknown as Recruit[];
  const raceResults = raceResultsJson.results as unknown as RaceResult[];
  const byUrl = new Map(raceResults.map((r) => [r.netkeibaUrl, r]));

  cache = recruits.map((h) => {
    const r = h.netkeibaUrl ? byUrl.get(h.netkeibaUrl) : undefined;
    const chuo = r?.chuoPrizeManYen ?? null;
    const chiho = r?.chihoPrizeManYen ?? null;
    return {
      ...h,
      recruitName: h.name,
      damName: h.damName
        ? normalizeDamName(h.damName)
        : h.dam
          ? normalizeDamName(h.dam)
          : damNameFromRecruitName(h.name),
      realName: r?.name ?? null,
      displayName: r?.name ?? h.name,
      chuoPrizeManYen: chuo,
      chihoPrizeManYen: chiho,
      totalPrizeManYen: (chuo ?? 0) + (chiho ?? 0),
      starts: r?.starts ?? null,
      wins: r?.wins ?? null,
      seconds: r?.seconds ?? null,
      thirds: r?.thirds ?? null,
      others: r?.others ?? null,
      mainWins: r?.mainWins ?? [],
      gradeWins: r?.gradeWins ?? [],
      offeringTotalManYen:
        h.pricePerShare != null
          ? h.pricePerShare * (h.shareCount ?? DEFAULT_SHARE_COUNT)
          : null,
      shareCountKnown: h.shareCount != null,
    };
  });
  return cache;
}

/** 出走実績がある馬（0戦を除く）だけを返す。成績クロス集計はこちらを使う。 */
export function racedOnly(horses: readonly RecruitWithResult[]): RecruitWithResult[] {
  return horses.filter((h): h is RecruitWithResult & { starts: number } => (h.starts ?? 0) > 0);
}

/**
 * 母ごとの全産駒ロスター（`analysis/data/dam-siblings.json`）を母のnetkeiba馬IDで引ける形にする。
 * 個別ページの「きょうだい」表（キャロット以外の産駒も並べる）で使う。
 * 486母×平均7頭を毎ページ走査しないよう、Mapはモジュール内で1回だけ作る。
 */
let damRosterCache: Map<string, RawDam> | null = null;

export function loadDamRoster(): Map<string, RawDam> {
  if (damRosterCache) return damRosterCache;
  const file = damSiblingsJson as unknown as { results: RawDam[] };
  damRosterCache = new Map(
    file.results.filter((d): d is RawDam & { damId: string } => d.damId != null).map((d) => [d.damId, d])
  );
  return damRosterCache;
}

/* ===================== JRAリーディング（年別の調教師順位）との結合 =====================
 *
 * `analysis/data/leading-trainers.json`（umapia の年別JRAリーディング上位50・2017〜2025）を、
 * 各馬の担当調教師と突き合わせる。厩舎記事（`src/pages/articles/stable-leading.astro`）用。
 *
 * ## 名寄せは「氏名の先頭4文字一致」
 * netkeibaの個体ページは長い調教師名を4文字に切って出す（"中内田充正" → "中内田充"）ため、
 * IDでは突き合わせられない（umapia側のIDはnetkeibaのIDと別系統）。両方を先頭4文字にして
 * 突き合わせる。**同じ年の上位内で先頭4文字が衝突したらビルドを落とす**（下の索引作成時に検算）。
 *
 * ## 参照する年は「募集年そのもの」
 * 出資を検討する人がその時点で見られる情報だけで分けるため（2026-09-05にこの基準へ切り替えた）。
 * 以前は「募集年+2」＝その馬の3歳シーズンを参照していたが、それだとリーディングの勝利数に
 * **その馬自身の勝利が入りうる**（測定窓が重なる）。実際、3歳シーズン基準で見えていた強い差は
 * 募集年基準に直すとほぼ消えた。**3歳シーズン基準の関数は残していない** ―― 2つ生きていると
 * 次の改修で取り違えるため（vault: 20260903-trainer-region-article）。
 * リーディングの表は2017〜2025年の全年ぶんあり、募集年も同じ範囲なので**代用は起きない**
 * （`substituted` は常に false になる前提で、記事側のアサーションがそれを検算する）。
 */

interface LeadingTrainerEntry {
  rank: number;
  trainer: string;
  umapiaId: string;
  wins: number;
}

const leadingFile = leadingTrainersJson as unknown as {
  fetchedAt: string;
  source: string;
  byYear: Record<string, LeadingTrainerEntry[]>;
};

/** リーディングの取得時点。 */
export const LEADING_TRAINERS_FETCHED_AT: string = leadingFile.fetchedAt;
/** リーディングの出所（画面の「データについて」に出す）。 */
export const LEADING_TRAINERS_SOURCE: string = leadingFile.source;
/** 表を持っている年（昇順）。 */
export const LEADING_TRAINER_YEARS: number[] = Object.keys(leadingFile.byYear)
  .map(Number)
  .sort((a, b) => a - b);
/** 表を持っている最新の年。募集年の表が無い場合だけこの年で代用する（現状は起きない）。 */
export const LEADING_TRAINERS_LATEST_YEAR: number =
  LEADING_TRAINER_YEARS[LEADING_TRAINER_YEARS.length - 1];

/** 調教師名の突き合わせキー（netkeibaが4文字に切るので両方を4文字にする）。 */
function trainerKey(name: string): string {
  return [...name].slice(0, 4).join('');
}

let leadingIndexCache: Map<number, Map<string, number>> | null = null;

/** 年 → （調教師キー → 順位）の索引。 */
function leadingIndex(): Map<number, Map<string, number>> {
  if (leadingIndexCache) return leadingIndexCache;
  const index = new Map<number, Map<string, number>>();
  for (const year of LEADING_TRAINER_YEARS) {
    const byKey = new Map<string, number>();
    const seen = new Map<string, string>();
    for (const entry of leadingFile.byYear[String(year)]) {
      const key = trainerKey(entry.trainer);
      const already = seen.get(key);
      if (already !== undefined && already !== entry.trainer) {
        // 先頭4文字が衝突すると、別人の順位を掴んだまま記事が出てしまう。
        throw new Error(
          `${year}年のリーディングで調教師名の先頭4文字が衝突した（${already} と ${entry.trainer}）。` +
            'analysis-data.ts の名寄せ（先頭4文字一致）を作り直すこと。'
        );
      }
      seen.set(key, entry.trainer);
      // 同名の重複は無い前提だが、万一あっても上位の順位を残す。
      if (!byKey.has(key) || entry.rank < (byKey.get(key) as number)) byKey.set(key, entry.rank);
    }
    index.set(year, byKey);
  }
  leadingIndexCache = index;
  return index;
}

export interface LeadingRank {
  /** その年のJRAリーディング順位。表の圏外（上位50位外）・調教師不明なら null。 */
  rank: number | null;
  /** 実際に参照した年。 */
  year: number;
  /** 募集年の表が無く、最新年で代用したか（2017〜2025年募集では起きない）。 */
  substituted: boolean;
}

/** **その馬の募集年**のリーディングでの、担当調教師の順位（募集時点で見られる情報）。 */
export function leadingRankOf(h: Pick<Recruit, 'recruitYear' | 'finalTrainer'>): LeadingRank {
  const index = leadingIndex();
  const wanted = h.recruitYear;
  const substituted = !index.has(wanted);
  const year = substituted ? LEADING_TRAINERS_LATEST_YEAR : wanted;
  const byKey = index.get(year);
  const rank = h.finalTrainer && byKey ? (byKey.get(trainerKey(h.finalTrainer)) ?? null) : null;
  return { rank, year, substituted };
}

/** 募集年時点で担当調教師がリーディングN位以内だったか。 */
export function isLeadingTopN(h: Pick<Recruit, 'recruitYear' | 'finalTrainer'>, n: number): boolean {
  const { rank } = leadingRankOf(h);
  return rank !== null && rank <= n;
}

/** 現在JRA（美浦・栗東）に所属しているか。地方転厩・所属不明は false。 */
export function isJraRegion(h: Pick<Recruit, 'region'>): boolean {
  return h.region === '東' || h.region === '西';
}
