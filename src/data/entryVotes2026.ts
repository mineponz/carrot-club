/**
 * 2026年募集馬の「募集申込票数」中間発表（クラブ公式・各回17時公開）。
 *
 * 出所: キャロットクラブ公式サイトの「募集申し込み票数 中間発表」。
 *   TODO(データ投入時に確定): 発表ページの正確なURLに差し替える。暫定でトップを置いている。
 *   https://carrotclub.net/
 *
 * クラブは**票数が多い馬だけ**を掲載する。したがってここに入るのは各回で発表された
 * 高票数馬のキーだけで、未発表の馬はキーごと持たない（ページ側では「—」表示になる）。
 *
 * - キー = 募集番号（string）。`horses2026.ts` の `id` と対応する。
 * - `total`       = その回時点の全体票数。
 * - `damPriority` = そのうち母優先枠からの票数。母優先対象外の馬・その回に母優の数字が
 *                   出ていない場合は `null`。
 *
 * このデータは自動取得の手段が無いため、発表のたびに手で埋める（`horses2026.ts` の
 * `weight` や `tourWeight2026.ts` と同じ運用）。
 * **第3回以降の中間発表が出たら、`ENTRY_VOTE_SNAPSHOTS` 配列に
 * `{ asOf, label, byId }` を1つ足すだけ**でページの列が増える（コード変更は不要）。
 */

/** ある回の1頭ぶんの票数。 */
export interface EntryVoteEntry {
  /** その回時点の全体票数 */
  total: number;
  /** そのうち母優先枠からの票数。母優先対象外・その回に数字が無ければ null */
  damPriority: number | null;
}

/** 1回ぶんの中間発表スナップショット。 */
export interface EntryVoteSnapshot {
  /** 表示用の計測時点（例 '9/3', '9/4'）。ページと個別ページで共有する唯一の出所 */
  asOf: string;
  /** 例 '第1回中間発表' */
  label: string;
  /** 募集番号(string) → 票数。**発表された馬のキーだけ**入れる（未発表はキーごと無し） */
  byId: Readonly<Record<string, EntryVoteEntry>>;
}

/**
 * 中間発表の時系列（古い回が先頭）。回が増えても配列に足すだけで、ページ・個別ページの
 * 表示は自動で追従する。
 *
 * 現時点では 9/3・9/4 の2回とも `byId` が空（＝まだ発表前の「器」の状態）。
 */
export const ENTRY_VOTE_SNAPSHOTS: readonly EntryVoteSnapshot[] = [
  { asOf: '9/3', label: '第1回中間発表', byId: {} },
  { asOf: '9/4', label: '第2回中間発表', byId: {} },
];
