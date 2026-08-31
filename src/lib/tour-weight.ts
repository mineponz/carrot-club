/**
 * 「募集時馬体重」と「ツアー後馬体重」を見比べるためのロジック。
 *
 * `Horse`（客観データ）と `TOUR_WEIGHT_BY_ID`（`src/data/tourWeight2026.ts`。別時点の
 * 計測値なので `Horse` 型には持たせない）を突き合わせて行データを作り、並べ替える。
 * UIから切り離した純粋関数にしてあるので `node --test` で検証できる。
 */
import type { Horse, Sex } from './horses.ts';

export interface TourWeightRow {
  id: string;
  name: string;
  sire: string;
  sex: Sex;
  /** 募集時馬体重 (kg) */
  weight: number;
  /** ツアー後馬体重 (kg)。PDF側が未計測（空欄）の馬は null */
  tourWeight: number | null;
  /** ツアー後 − 募集時。tourWeight が null なら null */
  diff: number | null;
}

/**
 * `horses` の各馬に `tourWeightById`（募集番号→ツアー後馬体重）を突き合わせる。
 * 対応表に無い馬（該当年度で無い等）は `tourWeight: null` として扱う。
 */
export function tourWeightRows(
  horses: readonly Horse[],
  tourWeightById: Readonly<Record<string, number | null>>,
): TourWeightRow[] {
  return horses.map((h) => {
    const tourWeight = tourWeightById[h.id] ?? null;
    return {
      id: h.id,
      name: h.name,
      sire: h.sire,
      sex: h.sex,
      weight: h.weight,
      tourWeight,
      diff: tourWeight === null ? null : tourWeight - h.weight,
    };
  });
}

export type TourWeightSortKey = 'id' | 'name' | 'sire' | 'sex' | 'weight' | 'tourWeight' | 'diff';
export type SortDirection = 'asc' | 'desc';

/**
 * 指定したキーで並べ替える。元の配列は変更しない。
 *
 * `tourWeight` / `diff` が `null`（未計測）の行は、昇順・降順どちらでも常に末尾に置く
 * （降順で先頭に出ると「増減が一番大きい馬」と見間違えるため）。
 */
export function sortTourWeightRows(
  rows: readonly TourWeightRow[],
  key: TourWeightSortKey,
  direction: SortDirection = 'asc',
): TourWeightRow[] {
  const sorted = [...rows].sort((a, b) => {
    const va = a[key];
    const vb = b[key];
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
