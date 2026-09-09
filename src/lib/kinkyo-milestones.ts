/**
 * `analysis/data/kinkyo-milestones.json`（近況バックナンバーから機械抽出した育成の節目）を読む。
 *
 * クラブの近況は1件ごとに「日付＋所在地」の見出しが付いている。そこから
 * 1歳8月の測尺日を起点として、
 *  - `honshuDays` … ＮＦ天栄／ＮＦしがらき に到着するまでの日数
 *  - `stableDays` … 美浦・栗東のトレセンへ初入厩するまでの日数
 * を求めてある。所在地は構造化されているので機械的に取れるが、ゲート試験の合格日や
 * デビュー日を本文テキストから拾うと誤検出する（「合格を目指す」を合格と読むなど）ため、
 * 日付が要る指標は所在地からのみ取っている。
 *
 * 成績の物差しに使えるのは成績が固まった2017〜2022年募集だけ。それ以降の馬（＝出資馬の
 * 記事で主役になる馬）は現役なので、母集団に混ぜず「当てはめる側」として扱うこと。
 */
import milestonesJson from '../../analysis/data/kinkyo-milestones.json';

export interface KinkyoMilestone {
  /** クラブの馬ページのid（`horse.asp?id=`）。募集2022年以前は募集年下2桁+番号2桁。 */
  clubId: string;
  recruitYear: number;
  no: string;
  sex: string;
  /** 募集時の仮名（例: "クラシックリディアの2024"）。 */
  name: string | null;
  netkeibaUrl: string | null;
  /** 1歳8月の測尺で計った馬体重。recruits.json と突合済み。 */
  measuredWeight: number;
  /** 測尺日から本州（ＮＦ天栄／しがらき）到着までの日数。未到達は null。 */
  honshuDays: number | null;
  /** 測尺日からトレセン初入厩までの日数。未入厩は null。 */
  stableDays: number | null;
  /** 募集中止までの日数（中止馬のみ）。 */
  cancelDays: number | null;
}

const file = milestonesJson as unknown as {
  fetchedAt: string;
  source: string;
  note: string;
  results: KinkyoMilestone[];
};

export const MILESTONES_FETCHED_AT: string = file.fetchedAt;

export function loadMilestones(): KinkyoMilestone[] {
  return file.results;
}

/** 募集年と番号で1頭引く。記事で主役の馬を名指しで取り出すのに使う。 */
export function findMilestone(recruitYear: number, no: string): KinkyoMilestone | undefined {
  return file.results.find((m) => m.recruitYear === recruitYear && m.no === no);
}

/**
 * 「本州入り」＝本州の育成場到着とトレセン入厩の早い方。
 * 天栄・しがらきを経由せず直接トレセンへ入る馬がいるので、片方だけで見ると取りこぼす。
 */
export function honshuArrivalDays(m: KinkyoMilestone): number | null {
  const candidates = [m.honshuDays, m.stableDays].filter((d): d is number => d !== null);
  return candidates.length ? Math.min(...candidates) : null;
}

/** 成績が固まった世代（2017〜2022年募集）だけを母集団として返す。 */
export function settledCohort(sex: string): KinkyoMilestone[] {
  return file.results.filter(
    (m) => m.sex === sex && m.recruitYear >= 2017 && m.recruitYear <= 2022,
  );
}

/** 値 `v` が昇順の配列 `xs` の中で下から何パーセントの位置かを返す。 */
export function percentileOf(v: number, xs: readonly number[]): number {
  if (!xs.length) return NaN;
  return (100 * xs.filter((x) => x < v).length) / xs.length;
}
