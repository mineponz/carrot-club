/**
 * 一覧ページの「表示のしかた」だけを覚えておく場所（メモ欄の一括開閉・隠している列）。
 *
 * 絞り込み条件（`filter-state.ts`）とはわざと分けている。メモ列を出すかどうかは
 * 表示の好みであって条件ではないので、混ぜると summary の「N件の条件」に数えられ、
 * 「条件をクリア」でも消えてしまい、頭数が減っていないのに条件が付いて見える。
 *
 * - 保存先はブラウザの `localStorage` だけ。**サーバーには送らない**。
 * - キーは募集年ごとに分ける（`/` と `/2025/` で別々に覚えられる。評価・条件の保存と同じ考え方）。
 * - DOMには触れず素の値だけを扱う（`node --test` で検証できるようにするため）。
 */
import type { KeyValueStore } from './evaluations.ts';

/** メモ列を出すかどうかの保存キー。 */
export function showMemoStorageKeyForYear(year: number): string {
  return `carrot-club:show-memo:${year}`;
}

/**
 * 保存済みの値を読む。既定は false（メモ列は隠す）。
 * `'1'` 以外はすべて false 扱いにして、壊れた値が入っていても表が崩れないようにする。
 */
export function loadShowMemo(store: KeyValueStore, key: string): boolean {
  return store.getItem(key) === '1';
}

/** 既定（false）のときはキーごと消す（「隠している」だけの空データを残さない）。 */
export function saveShowMemo(
  store: KeyValueStore & { removeItem?(key: string): void },
  key: string,
  show: boolean,
): void {
  if (show) {
    store.setItem(key, '1');
    return;
  }
  if (typeof store.removeItem === 'function') store.removeItem(key);
  else store.setItem(key, '0');
}

/** 隠している列の保存キー。メモ列（show-memo）とは別に持つ（トグルの出所が違うため）。 */
export function hiddenColumnsStorageKeyForYear(year: number): string {
  return `carrot-club:hidden-columns:${year}`;
}

/**
 * 保存するのは**隠している列**のほうだけにする。既定（何も設定していない＝全列表示）が
 * 空データで表せるので、列が増えても保存済みデータを触らずに済む（新しい列は自動で表示側に
 * 倒れる。列を消したときも、知らないキーが残るだけで表示は壊れない）。
 *
 * 区切りはカンマ。列のキーは COLUMNS で決めた英数字だけなので値に混ざらない
 * （`filter-state.ts` の複数選択と同じ考え方）。
 */
const HIDDEN_COLUMNS_SEPARATOR = ',';

/** 保存済みの値を読む。既定は空（＝全列表示）。壊れた値は空要素として捨てる。 */
export function loadHiddenColumns(store: KeyValueStore, key: string): Set<string> {
  const raw = store.getItem(key);
  if (!raw) return new Set();
  const keys = raw
    .split(HIDDEN_COLUMNS_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return new Set(keys);
}

/** 既定（1列も隠していない）のときはキーごと消す（空データを残さない）。 */
export function saveHiddenColumns(
  store: KeyValueStore & { removeItem?(key: string): void },
  key: string,
  hiddenKeys: Set<string>,
): void {
  if (hiddenKeys.size === 0) {
    if (typeof store.removeItem === 'function') store.removeItem(key);
    else store.setItem(key, '');
    return;
  }
  store.setItem(key, [...hiddenKeys].join(HIDDEN_COLUMNS_SEPARATOR));
}
