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
 * - `topPriority` = そのうち最優先枠からの票数（本人いわく、母優先より重視すべき指標）。
 *                   母馬優先対象馬は発表の「母馬優先＋最優先」列の値、対象外の馬は
 *                   「最優先」列の値をそのまま入れる（後述）。その回に数字が出ていなければ null。
 * - `damPriority` = そのうち母優先枠（一般）からの票数。母馬優先対象馬は発表の
 *                   「母馬優先（一般）」列の値。母優先対象外の馬・その回に数字が
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
  /** そのうち最優先枠からの票数。母優先より重視する指標。その回に数字が無ければ null */
  topPriority: number | null;
  /** そのうち母優先枠（一般）からの票数。母優先対象外・その回に数字が無ければ null */
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
 * 9/3（第1回）は発表済み。9/4（第2回）は `byId` が空（＝まだ発表前の「器」の状態）。
 *
 * 第1回中間発表（9/3 17時現在）の列の割り当て（本人確認済み・2026-09-03）:
 * - 母馬優先対象馬は発表に4列ある（総申込数／母馬優先＋最優先／母馬優先（一般）／最優先）。
 *   このうち「母馬優先＋最優先」を `topPriority` に、「母馬優先（一般）」を `damPriority` に
 *   採用した。単独の「最優先」列（母優先を持たない最優先会員の分）は今回は取り込んでいない。
 * - 母馬優先非対象馬は発表に2列（総申込数／最優先）しか無く、この「最優先」を
 *   そのまま `topPriority` に採用（`damPriority` は対象外なので null）。
 */
export const ENTRY_VOTE_SNAPSHOTS: readonly EntryVoteSnapshot[] = [
  {
    asOf: '9/3',
    label: '第1回中間発表',
    byId: {
      '8': { total: 258, topPriority: 97, damPriority: 6 },
      '14': { total: 253, topPriority: 58, damPriority: 26 },
      '15': { total: 226, topPriority: 85, damPriority: 19 },
      '27': { total: 225, topPriority: 14, damPriority: 20 },
      '33': { total: 251, topPriority: 58, damPriority: 3 },
      '36': { total: 215, topPriority: 26, damPriority: 44 },
      '48': { total: 425, topPriority: 7, damPriority: 7 },
      '49': { total: 287, topPriority: 88, damPriority: 17 },
      '50': { total: 301, topPriority: 58, damPriority: 14 },
      '51': { total: 302, topPriority: 95, damPriority: 6 },
      '65': { total: 225, topPriority: 33, damPriority: 22 },
      '69': { total: 249, topPriority: 13, damPriority: 54 },
      '70': { total: 254, topPriority: 18, damPriority: 20 },
      '81': { total: 346, topPriority: 63, damPriority: 23 },
      '3': { total: 209, topPriority: 93, damPriority: null },
      '21': { total: 215, topPriority: 95, damPriority: null },
      '53': { total: 231, topPriority: 144, damPriority: null },
      '59': { total: 244, topPriority: 42, damPriority: null },
      '78': { total: 250, topPriority: 60, damPriority: null },
    },
  },
  { asOf: '9/4', label: '第2回中間発表', byId: {} },
];
