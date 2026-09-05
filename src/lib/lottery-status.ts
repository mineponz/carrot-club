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

export type LotteryTone = 'strong' | 'mid' | 'clear';

export interface LotteryLabel {
  text: string;
  tone: LotteryTone;
}

/**
 * 1つの枠（母馬優先／通常）の結果をバッジ文言に変換する。
 *
 * - `cutoffRank === null`（未確定・未発表）→ 「発表待ち」/ tone:'mid'
 * - `lotteryOccurred === true`（そのランクで抽選が発生）→ 「◯◯抽選」/ tone:'strong'
 * - `lotteryOccurred === false`（そのランクでちょうど満口・抽選なし）→ 「◯◯で確保」/ tone:'clear'
 *
 * `ranks` はその枠で実際に使われる想定のランク集合（通常枠・母馬優先枠のいずれも今のところ
 * `ALL_LOTTERY_RANKS` 全部を使うが、実際の発表文言の実例が無いまま暫定設計しているため、
 * 呼び出し側に明示的に渡させることで「枠によってランク構成が違う」ことが判明した場合に
 * ここへ手を入れやすくしてある）。`cutoffRank` が `ranks` に含まれない場合はエラーにする
 * （呼び出し側のバグ・データ入力ミスに早く気づけるように）。
 */
export function lotteryLabel(
  frame: FrameLotteryResult,
  ranks: readonly LotteryRank[] = ALL_LOTTERY_RANKS,
): LotteryLabel {
  if (frame.cutoffRank === null) {
    return { text: '発表待ち', tone: 'mid' };
  }
  if (!ranks.includes(frame.cutoffRank)) {
    throw new Error(`lotteryLabel: cutoffRank "${frame.cutoffRank}" is not in ranks`);
  }
  const rankLabel = LOTTERY_RANK_LABELS[frame.cutoffRank];
  if (frame.lotteryOccurred) {
    return { text: `${rankLabel}抽選`, tone: 'strong' };
  }
  return { text: `${rankLabel}で確保`, tone: 'clear' };
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
  if (frame === null || frame.cutoffRank === null) return -1;
  const rankStrength = ALL_LOTTERY_RANKS.length - ALL_LOTTERY_RANKS.indexOf(frame.cutoffRank);
  return frame.lotteryOccurred ? 100 + rankStrength : 50 + rankStrength;
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
