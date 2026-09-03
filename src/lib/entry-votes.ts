/**
 * 「募集申込票数（中間発表）」ページのロジック。
 *
 * `Horse`（客観データ）と `ENTRY_VOTE_SNAPSHOTS`（`src/data/entryVotes2026.ts`。回ごとの
 * 票数スナップショット）を突き合わせて行データを作り、並べ替える。
 * `tour-weight.ts` と同じく UI から切り離した純粋関数にしてあるので `node --test` で検証できる。
 *
 * 回数（列数）は固定ではない。`entryVoteRows()` は渡された `snapshots` と同じ長さ・同じ順の
 * `cells` を返す。回が増えたら `entryVotes2026.ts` の配列に足すだけでよい。
 */
import type { Horse, Sex } from './horses.ts';
import type { EntryVoteEntry, EntryVoteSnapshot } from '../data/entryVotes2026.ts';

export interface EntryVoteRow {
  id: string;
  name: string;
  sire: string;
  sex: Sex;
  /** `snapshots` と同じ長さ・同じ順。その回に未発表なら null */
  cells: (EntryVoteEntry | null)[];
  /** ソート・初期表示用。末尾（最新）から遡って最初に見つかった全体票数。全回未発表なら null */
  latestTotal: number | null;
}

/**
 * `horses` の各馬に、各回の票数スナップショットを突き合わせる。
 * どの回にも掲載が無い馬（＝票数が少なく発表対象外）は `cells` が全て null になる。
 */
export function entryVoteRows(
  horses: readonly Horse[],
  snapshots: readonly EntryVoteSnapshot[],
): EntryVoteRow[] {
  return horses.map((h) => {
    const cells = snapshots.map((snap) => snap.byId[h.id] ?? null);
    let latestTotal: number | null = null;
    for (let i = cells.length - 1; i >= 0; i--) {
      const cell = cells[i];
      if (cell !== null) {
        latestTotal = cell.total;
        break;
      }
    }
    return { id: h.id, name: h.name, sire: h.sire, sex: h.sex, cells, latestTotal };
  });
}

/**
 * `'total:0'`・`'total:1'` … その回の全体票数、`'top:0'`・`'top:1'` … その回の
 * 最優先枠票数で並べ替えるキー。
 */
export type EntryVoteSortKey =
  | 'id'
  | 'name'
  | 'sire'
  | 'sex'
  | 'latestTotal'
  | `total:${number}`
  | `top:${number}`;
export type SortDirection = 'asc' | 'desc';

/** ソートキーから「何回目の、どの数値の列か」を取り出す。回の列以外なら null。 */
function roundColumnOf(
  key: EntryVoteSortKey,
): { index: number; field: 'total' | 'topPriority' } | null {
  const mTotal = /^total:(\d+)$/.exec(key);
  if (mTotal) return { index: Number(mTotal[1]), field: 'total' };
  const mTop = /^top:(\d+)$/.exec(key);
  if (mTop) return { index: Number(mTop[1]), field: 'topPriority' };
  return null;
}

/**
 * 指定したキーで並べ替える。元の配列は変更しない。
 *
 * 票数が未発表（`latestTotal` が null、または対象の回・項目の数字が無い）の行は、
 * 昇順・降順どちらでも常に末尾に置く（`tour-weight.ts` の null 扱いと同じ。降順で
 * 先頭に出ると「票数が一番多い馬」と見間違えるため）。
 */
export function sortEntryVoteRows(
  rows: readonly EntryVoteRow[],
  key: EntryVoteSortKey,
  direction: SortDirection = 'asc',
): EntryVoteRow[] {
  const round = roundColumnOf(key);

  const valueOf = (row: EntryVoteRow): string | number | null => {
    if (key === 'id' || key === 'name' || key === 'sire' || key === 'sex') return row[key];
    if (key === 'latestTotal') return row.latestTotal;
    if (round !== null) {
      const cell = row.cells[round.index];
      return cell === null ? null : cell[round.field];
    }
    return null;
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
