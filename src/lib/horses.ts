/**
 * 募集馬の客観データ型と、ソート・フィルタの純粋関数。
 *
 * ここに入るのは公表されている客観情報のみ（血統・測尺・厩舎など）。個人の評価・メモ・
 * 見送り判定は `evaluations.ts`（ユーザーごとのlocalStorage）側の責務であり、
 * このファイルは一切関知しない。
 */

export type Sex = '牡' | '牝' | 'セ';

export interface Horse {
  /** クラブの募集番号（一覧での通し番号） */
  id: string;
  name: string;
  sex: Sex;
  /** netkeibaの馬個体ページ */
  netkeibaUrl: string;
  sire: string;
  broodmareSire: string;
  /** 母齢（出産時点の母の年齢） */
  damAge: number;
  /** ISO 8601形式 (YYYY-MM-DD) */
  birthDate: string;
  stable: string;
  /** 一口価格（万円） */
  pricePerShare: number;
  /** 体高 (cm) */
  height: number;
  /** 胸囲 (cm) */
  chestGirth: number;
  /** 管囲 (cm) */
  caretGirth: number;
  /** 馬体重 (kg) */
  weight: number;
  /** 兄弟情報（代表的な兄姉の馬名。無い場合は空文字） */
  sibling: string;
  /** 母優先。その母（繁殖牝馬）に出資している会員に優先枠がある馬（クラブ側の制度上の区分） */
  damPriority: boolean;
  /** 手術・既往歴の記載（無い場合は空文字。複数行になりうる） */
  surgery: string;
  /** X（旧Twitter）の検索URL */
  xSearchUrl: string;
}

export type SortKey =
  | 'id'
  | 'name'
  | 'sex'
  | 'sire'
  | 'broodmareSire'
  | 'damAge'
  | 'birthDate'
  | 'stable'
  | 'pricePerShare'
  | 'height'
  | 'chestGirth'
  | 'caretGirth'
  | 'weight';

export type SortDirection = 'asc' | 'desc';

/**
 * 指定したキーで昇順/降順にソートする。元の配列は変更しない。
 * 数値キーは引き算で、文字列キーは `localeCompare`（日本語の並び順を尊重）で比較する。
 * `id` は文字列だが実体は番号なので、数値として比較する。
 */
export function sortHorses(horses: Horse[], key: SortKey, direction: SortDirection = 'asc'): Horse[] {
  const sorted = [...horses].sort((a, b) => {
    const va = a[key];
    const vb = b[key];
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

export interface HorseFilter {
  /** 馬名の部分一致 */
  name?: string;
  /** 父名の部分一致 */
  sire?: string;
  /** 母父名の部分一致 */
  broodmareSire?: string;
  /** 厩舎名の部分一致 */
  stable?: string;
  /** 指定した性別のみ。未指定なら全性別 */
  sex?: Sex;
  minPrice?: number;
  maxPrice?: number;
  minHeight?: number;
  maxHeight?: number;
  minWeight?: number;
  maxWeight?: number;
  /** trueなら母優先の対象馬だけに絞る */
  damPriorityOnly?: boolean;
  /** trueなら手術・既往歴の記載がある馬を除外する */
  excludeSurgery?: boolean;
}

function includesCaseInsensitive(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** フィルタ条件をすべて満たす馬だけを残す（AND条件）。未指定の条件は無視される。 */
export function filterHorses(horses: Horse[], filter: HorseFilter): Horse[] {
  return horses.filter((h) => {
    if (filter.name && !includesCaseInsensitive(h.name, filter.name)) return false;
    if (filter.sire && !includesCaseInsensitive(h.sire, filter.sire)) return false;
    if (filter.broodmareSire && !includesCaseInsensitive(h.broodmareSire, filter.broodmareSire)) return false;
    if (filter.stable && !includesCaseInsensitive(h.stable, filter.stable)) return false;
    if (filter.sex && h.sex !== filter.sex) return false;
    if (filter.minPrice !== undefined && h.pricePerShare < filter.minPrice) return false;
    if (filter.maxPrice !== undefined && h.pricePerShare > filter.maxPrice) return false;
    if (filter.minHeight !== undefined && h.height < filter.minHeight) return false;
    if (filter.maxHeight !== undefined && h.height > filter.maxHeight) return false;
    if (filter.minWeight !== undefined && h.weight < filter.minWeight) return false;
    if (filter.maxWeight !== undefined && h.weight > filter.maxWeight) return false;
    if (filter.damPriorityOnly && !h.damPriority) return false;
    if (filter.excludeSurgery && h.surgery !== '') return false;
    return true;
  });
}

/** フィルタUIの選択肢を作るために、指定キーの値を重複なく昇順で返す。 */
export function uniqueValues(horses: Horse[], key: 'sire' | 'broodmareSire' | 'stable'): string[] {
  return [...new Set(horses.map((h) => h[key]).filter((v) => v !== ''))].sort((a, b) =>
    a.localeCompare(b, 'ja'),
  );
}
