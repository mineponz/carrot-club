/**
 * 一覧ページの「表示のしかた」だけを覚えておく場所。
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
