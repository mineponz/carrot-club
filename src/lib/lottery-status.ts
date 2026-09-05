/**
 * 抽選ステータス（募集馬ごとの抽選ランク発表結果）のラベル生成・行データ組み立て。
 *
 * `Horse`（客観データ）と `LOTTERY_STATUS_SNAPSHOTS`（`src/data/lotteryStatus2026.ts`。
 * 発表ごとのスナップショット配列）を突き合わせて行データを作る。UIから切り離した
 * 純粋関数にしてあるので `node --test` で検証できる（`tour-weight.ts` と同じ考え方）。
 *
 * 複数回の発表があっても**最新（配列末尾）のsnapshotだけ**を見る。中間発表を並べて
 * 比較したい `entry-votes.ts` とは違い、抽選ステータスは「今の結果」だけが意味を持つため。
 */
import type { Horse, Sex } from './horses.ts';
import type {
  FrameLotteryResult,
  LotteryRank,
  LotteryStatusEntry,
  LotteryStatusSnapshot,
} from '../data/lotteryStatus2026.ts';

/** 強い順（x2 → x1 → none → general）。ランクの妥当性チェック・ソートの基準に使う。 */
export const ALL_LOTTERY_RANKS: readonly LotteryRank[] = ['x2', 'x1', 'none', 'general'];

/** ランク→日本語表記。表示文言の唯一の出所（ここ以外でランク名を書かない）。 */
export const LOTTERY_RANK_LABELS: Readonly<Record<LotteryRank, string>> = {
  x2: '最優先×2',
  x1: '最優先×1',
  none: '最優先×なし',
  general: '一般',
};

/**
 * バッジの配色キー。`'mid'` は未発表（バッジにせず地の文で出す）。それ以外はランクそのもので、
 * CSS側は `rank-x2` が最も濃く、`rank-general` に向かって薄くなる（本人依頼・2026-09-05
 * 「最優先バツ2から濃色に」）。抽選が発生したか（塗りつぶし）・一般枠で確保できたか
 * （枠線のみ。一般以外のランクには存在しない状態）は呼び出し側が `outcome.lotteryOccurred`
 * から別クラス（`occurred`/`secured`）を足して表現する（`lottery-status-row.ts` 参照）。
 */
export type LotteryBadgeRank = LotteryRank | 'mid';

export interface LotteryLabel {
  text: string;
  rank: LotteryBadgeRank;
}

/**
 * 1つの枠（母馬優先／通常）の結果をバッジ文言に変換する。
 *
 * - `outcome === null`（未確定・未発表）→ 「発表待ち」/ rank:'mid'
 * - `lotteryOccurred === true`（そのランクで抽選が発生）→ 「◯◯抽選」
 * - `lotteryOccurred === false`（一般枠で申込者が口数に届かなかった）→ 「残口あり」
 *   （`LotteryOutcome`の型上、これが起こりうるのは一般枠だけ）。**「一般で確保」のような
 *   「ちょうど満口」を思わせる文言は使わない**（本人指摘・2026-09-05「ぴったりじゃないと
 *   この表現ない」——実際にはぴったり満口になることは稀で、大半は口数が余る。
 *   これは1.5次募集の目安である`remainingShares`と同じ状態を指すため「残口あり」で表す）。
 */
export function lotteryLabel(frame: FrameLotteryResult): LotteryLabel {
  if (frame.outcome === null) {
    return { text: '発表待ち', rank: 'mid' };
  }
  const { rank, lotteryOccurred } = frame.outcome;
  if (!lotteryOccurred) {
    return { text: '残口あり', rank };
  }
  const text = `${LOTTERY_RANK_LABELS[rank]}抽選`;
  return { text, rank };
}

export interface LotteryStatusRow {
  id: string;
  name: string;
  sire: string;
  sex: Sex;
  /** 母馬優先枠の対象馬か（`horse.damPriority`） */
  hasDamPriority: boolean;
  /** 母馬優先枠の結果。対象外の馬・未発表なら null */
  damPriority: FrameLotteryResult | null;
  /** 通常枠の結果。未発表なら null */
  normal: FrameLotteryResult | null;
  /** 残り口数（1.5次募集の目安）。未発表・未確定は null */
  remainingShares: number | null;
}

/**
 * `snapshots` の最新（配列末尾）から、その馬の抽選結果を引く。
 * 発表が1件も無い（配列が空、またはその馬がまだどのsnapshotにも掲載されていない）場合は
 * `entry: null` を返す（呼び出し側は damPriority/normal ともに null として扱う）。
 */
function latestEntry(
  horseId: string,
  snapshots: readonly LotteryStatusSnapshot[],
): LotteryStatusEntry | null {
  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  return latestSnapshot?.byId[horseId] ?? null;
}

/**
 * `horses` の各馬に、最新の抽選ステータスを突き合わせる。
 * 一覧列・特設ページ・詳細ページfactsのすべてがこの行データを共通の出所にする。
 */
export function lotteryStatusRows(
  horses: readonly Horse[],
  snapshots: readonly LotteryStatusSnapshot[],
): LotteryStatusRow[] {
  return horses.map((h) => {
    const entry = latestEntry(h.id, snapshots);
    return {
      id: h.id,
      name: h.name,
      sire: h.sire,
      sex: h.sex,
      hasDamPriority: h.damPriority,
      damPriority: entry?.damPriority ?? null,
      normal: entry?.normal ?? null,
      remainingShares: entry?.remainingShares ?? null,
    };
  });
}

/**
 * 特設ページの初期表示・並べ替え用の「severity」（数値が大きいほど上に見せたい）。
 *
 * 「抽選が発生している」ことがこのツールを見に来る利用者にとって一番の関心事なので、
 * 抽選発生（tone:'strong'）を最優先で上位に、その中でも強いランク（×2側）で抽選が
 * 発生している馬ほど「その馬自体の人気が高い」ことを示すため上位に置く。
 * 次に抽選なしで確保（tone:'clear'）、最後に未発表（null）の順。
 * 未発表は昇順・降順どちらでも常に末尾に落ちる（`tour-weight.ts` 等と同じ「null は末尾」方針）。
 */
export function lotterySeverity(frame: FrameLotteryResult | null): number {
  if (frame === null || frame.outcome === null) return -1;
  const { rank, lotteryOccurred } = frame.outcome;
  const rankStrength = ALL_LOTTERY_RANKS.length - ALL_LOTTERY_RANKS.indexOf(rank);
  return lotteryOccurred ? 100 + rankStrength : 50 + rankStrength;
}

export type LotteryStatusSortKey =
  | 'id'
  | 'name'
  | 'sire'
  | 'sex'
  | 'damPriority'
  | 'normal'
  | 'remainingShares';
export type SortDirection = 'asc' | 'desc';

/**
 * 指定したキーで並べ替える。元の配列は変更しない。
 * `damPriority` / `normal` は `lotterySeverity()` で、`remainingShares` は数値そのもので比べる。
 * 未発表（severityが -1 になる行・remainingSharesがnullの行）は常に末尾に置く。
 */
export function sortLotteryStatusRows(
  rows: readonly LotteryStatusRow[],
  key: LotteryStatusSortKey,
  direction: SortDirection = 'asc',
): LotteryStatusRow[] {
  const valueOf = (row: LotteryStatusRow): string | number | null => {
    if (key === 'id' || key === 'name' || key === 'sire' || key === 'sex') return row[key];
    if (key === 'remainingShares') return row.remainingShares;
    const severity = lotterySeverity(row[key]);
    return severity === -1 ? null : severity;
  };

  const sorted = [...rows].sort((a, b) => {
    const va = valueOf(a);
    const vb = valueOf(b);
    if (va === null || vb === null) {
      if (va === null && vb === null) return 0;
      return va === null ? 1 : -1;
    }
    let cmp: number;
    if (key === 'id') {
      cmp = Number(va) - Number(vb);
    } else if (typeof va === 'number' && typeof vb === 'number') {
      cmp = va - vb;
    } else {
      cmp = String(va).localeCompare(String(vb), 'ja');
    }
    return direction === 'asc' ? cmp : -cmp;
  });
  return sorted;
}
