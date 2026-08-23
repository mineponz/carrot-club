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
import { damNameFromRecruitName, normalizeDamName } from './horse-meta.ts';

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
  pricePerShare: number | null;
  height: number | null;
  chestGirth: number | null;
  caretGirth: number | null;
  weight: number | null;
}

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
    };
  });
  return cache;
}

/** 出走実績がある馬（0戦を除く）だけを返す。成績クロス集計はこちらを使う。 */
export function racedOnly(horses: readonly RecruitWithResult[]): RecruitWithResult[] {
  return horses.filter((h): h is RecruitWithResult & { starts: number } => (h.starts ?? 0) > 0);
}
