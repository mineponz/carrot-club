/**
 * 一覧ページの絞り込み条件と並び順を、その端末に覚えさせる。
 *
 * 開くたびに価格帯や父を入れ直すのが手間、という要望への対応。次に開いたときは
 * 前回の条件のまま表示する（画面を開いただけで条件が消えない）。
 *
 * - 保存先はブラウザの `localStorage` だけ。**サーバーには送らない**。
 *   「自分の評価（A〜E）で絞る」チェックはどの印を見たいかという画面の状態であって評価そのもの
 *   ではないが、条件の組み合わせから本人の見立てが読めてしまうので、ここは端末内に閉じる。
 * - キーは**募集年ごとに分ける**（`filterStorageKeyForYear`）。父の選択肢も頭数も年で違うため、
 *   共有すると別の年の条件が復元されて頭数が合わなくなる。評価の保存キーと同じ考え方。
 * - DOMには触れず、ページ側が集めた素の値だけを扱う（`node --test` で検証できるようにするため）。
 *
 * 保存する形は「id → 値」の対応表にしてある。絞り込みの入力欄が増えても、このファイルと
 * 保存済みデータの形は変えずに済む（知らないidは復元時に読み飛ばす）。
 */
import type { KeyValueStore } from './evaluations.ts';
import type { SortDirection, SortKey } from './horses.ts';

/** 並び順の既定値。一覧の初期表示（募集番号の昇順）と同じ。 */
export const DEFAULT_SORT_KEY: SortKey = 'id';
export const DEFAULT_SORT_DIRECTION: SortDirection = 'asc';

export interface FilterState {
  /** テキスト・数値・セレクトの入力値（コントロールのid → 値）。空文字の項目は持たない。 */
  values: Record<string, string>;
  /** チェックボックスの状態（コントロールのid → true）。オフの項目は持たない。 */
  toggles: Record<string, boolean>;
  /** 「自分の評価」チェックボックスで選んだ値（'A'〜'E' / 'none'）。 */
  ratings: string[];
  sortKey: SortKey;
  sortDirection: SortDirection;
}

export function filterStorageKeyForYear(year: number): string {
  return `carrot-club:filters:${year}`;
}

export function emptyFilterState(): FilterState {
  return {
    values: {},
    toggles: {},
    ratings: [],
    sortKey: DEFAULT_SORT_KEY,
    sortDirection: DEFAULT_SORT_DIRECTION,
  };
}

/** 条件も並び替えも既定のままか。既定なら保存キーごと消す（古い条件が残らないように）。 */
export function isEmptyFilterState(state: FilterState): boolean {
  return (
    Object.keys(state.values).length === 0 &&
    Object.keys(state.toggles).length === 0 &&
    state.ratings.length === 0 &&
    state.sortKey === DEFAULT_SORT_KEY &&
    state.sortDirection === DEFAULT_SORT_DIRECTION
  );
}

/** 入っている条件の数（並び順は数えない）。summaryの「N件の条件」に使う。 */
export function countActiveFilters(state: FilterState): number {
  return (
    Object.keys(state.values).length + Object.keys(state.toggles).length + state.ratings.length
  );
}

/** 空文字・false を落としてから保存する（保存済みデータに「未入力」を貯めない）。 */
export function serializeFilterState(state: FilterState): string {
  const values: Record<string, string> = {};
  for (const [id, value] of Object.entries(state.values)) {
    if (value.trim() !== '') values[id] = value;
  }
  const toggles: Record<string, boolean> = {};
  for (const [id, on] of Object.entries(state.toggles)) {
    if (on) toggles[id] = true;
  }
  return JSON.stringify({
    values,
    toggles,
    ratings: state.ratings,
    sortKey: state.sortKey,
    sortDirection: state.sortDirection,
  });
}

const SORT_KEYS: readonly SortKey[] = [
  'id',
  'name',
  'sex',
  'sire',
  'broodmareSire',
  'damAge',
  'birthDate',
  'stable',
  'pricePerShare',
  'height',
  'chestGirth',
  'caretGirth',
  'weight',
];

function stringRecord(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Record<string, string> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim() !== '') out[id] = value;
  }
  return out;
}

function booleanRecord(raw: unknown): Record<string, boolean> {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Record<string, boolean> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === true) out[id] = true;
  }
  return out;
}

/**
 * 保存済みの文字列を読む。壊れている・古い形・知らない値が入っていても例外を投げず、
 * 分かる範囲だけ拾って残りは既定値にする（保存データのせいで一覧が開けなくならないように）。
 */
export function parseFilterState(raw: string | null): FilterState {
  const state = emptyFilterState();
  if (!raw) return state;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return state;
  }
  if (typeof parsed !== 'object' || parsed === null) return state;
  const obj = parsed as Record<string, unknown>;

  state.values = stringRecord(obj.values);
  state.toggles = booleanRecord(obj.toggles);
  state.ratings = Array.isArray(obj.ratings)
    ? obj.ratings.filter((r): r is string => typeof r === 'string')
    : [];
  if (SORT_KEYS.includes(obj.sortKey as SortKey)) state.sortKey = obj.sortKey as SortKey;
  if (obj.sortDirection === 'asc' || obj.sortDirection === 'desc') {
    state.sortDirection = obj.sortDirection;
  }
  return state;
}

export function loadFilterState(store: KeyValueStore, key: string): FilterState {
  return parseFilterState(store.getItem(key));
}

/**
 * 保存する。既定の状態（＝条件なし・並び順も既定）なら保存せず消す。
 * 「条件をクリア」した状態が次回に持ち越されるだけの空データを残さないため。
 */
export function saveFilterState(
  store: KeyValueStore & { removeItem?(key: string): void },
  key: string,
  state: FilterState
): void {
  if (isEmptyFilterState(state)) {
    if (typeof store.removeItem === 'function') store.removeItem(key);
    else store.setItem(key, serializeFilterState(emptyFilterState()));
    return;
  }
  store.setItem(key, serializeFilterState(state));
}
