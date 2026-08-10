/**
 * 募集馬の客観データ型と、ソート・フィルタの純粋関数。
 *
 * ここに入るのは公表可能な客観情報のみ（血統・測尺など）。個人の評価・メモ・
 * 見送り判定は `evaluations.ts`（ユーザーごとのlocalStorage）側の責務であり、
 * このファイルは一切関知しない。
 */

export interface Horse {
  /** 例: "2025-001" */
  id: string;
  name: string;
  sire: string;
  broodmareSire: string;
  /** ISO 8601形式 (YYYY-MM-DD) */
  birthDate: string;
  /** 体高 (cm) */
  height: number;
  /** 胸囲 (cm) */
  chestGirth: number;
  /** 管囲 (cm) */
  caretGirth: number;
  /** 馬体重 (kg) */
  weight: number;
  /** 母齢 */
  damAge: number;
  /** 兄弟情報（自由記述） */
  siblingInfo: string;
}

export type SortKey =
  | 'name'
  | 'sire'
  | 'broodmareSire'
  | 'birthDate'
  | 'height'
  | 'chestGirth'
  | 'caretGirth'
  | 'weight'
  | 'damAge';

export type SortDirection = 'asc' | 'desc';

/**
 * 指定したキーで昇順/降順にソートする。元の配列は変更しない。
 * 文字列キーは `localeCompare`（日本語の順序を尊重）、数値キーは引き算で比較する。
 */
export function sortHorses(horses: Horse[], key: SortKey, direction: SortDirection = 'asc'): Horse[] {
  const sorted = [...horses].sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    let cmp: number;
    if (typeof va === 'number' && typeof vb === 'number') {
      cmp = va - vb;
    } else {
      cmp = String(va).localeCompare(String(vb), 'ja');
    }
    return direction === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

export interface HorseFilter {
  /** 父名の部分一致（大文字小文字区別なし） */
  sire?: string;
  /** 母父名の部分一致（大文字小文字区別なし） */
  broodmareSire?: string;
  minHeight?: number;
  maxHeight?: number;
  minWeight?: number;
  maxWeight?: number;
  /** 生年月日の下限 (ISO 8601、この日を含む) */
  bornAfter?: string;
  /** 生年月日の上限 (ISO 8601、この日を含む) */
  bornBefore?: string;
}

function includesCaseInsensitive(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** フィルタ条件をすべて満たす馬だけを残す。未指定の条件は無視される。 */
export function filterHorses(horses: Horse[], filter: HorseFilter): Horse[] {
  return horses.filter((h) => {
    if (filter.sire && !includesCaseInsensitive(h.sire, filter.sire)) return false;
    if (filter.broodmareSire && !includesCaseInsensitive(h.broodmareSire, filter.broodmareSire)) return false;
    if (filter.minHeight !== undefined && h.height < filter.minHeight) return false;
    if (filter.maxHeight !== undefined && h.height > filter.maxHeight) return false;
    if (filter.minWeight !== undefined && h.weight < filter.minWeight) return false;
    if (filter.maxWeight !== undefined && h.weight > filter.maxWeight) return false;
    if (filter.bornAfter && h.birthDate < filter.bornAfter) return false;
    if (filter.bornBefore && h.birthDate > filter.bornBefore) return false;
    return true;
  });
}
