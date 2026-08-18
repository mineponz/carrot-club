/**
 * ユーザー個人の評価データ。ブラウザの localStorage に保存する。
 *
 * DOMや`localStorage`グローバルに直接触れず、`KeyValueStore`インタフェース越しに
 * 読み書きすることでテスト可能にしている（`window.localStorage`はこの型を満たす）。
 *
 * 将来Phase2で「他ユーザーの評価傾向を集計」する機能を足す際は、この形状
 * （馬IDごとのフラットなJSON）のまま`rating`と匿名IDだけをAPIに送る想定。
 * メモは個人情報になりうるため送信対象に含めない設計にしてある。
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type Rating = 'A' | 'B' | 'C' | 'D' | 'E';

export interface Evaluation {
  rating: Rating | null;
  favorite: boolean;
  /** 見送り（「消」）フラグ */
  skip: boolean;
  memo: string;
}

export type EvaluationMap = Record<string, Evaluation>;

/**
 * 保存キーは**募集年ごとに分ける**。
 *
 * 馬IDはクラブの募集番号で、年ごとに1から振り直される。年度をまたいで同じキーを使うと
 * 2025年募集のNo.1に付けた評価が2026年募集のNo.1に出てしまう（実際に `/` と `/2025/` を
 * 併存させた時に混線する）。2025年版ページは既存ユーザーのデータを壊さないよう、
 * 従来と同じ `carrot-club:evaluations:2025` を使い続ける。
 */
export function storageKeyForYear(year: number): string {
  return `carrot-club:evaluations:${year}`;
}

/** 2025年募集ぶんの保存キー。既存ユーザーのデータがこのキーに入っている。 */
export const STORAGE_KEY = storageKeyForYear(2025);

export const DEFAULT_EVALUATION: Evaluation = {
  rating: null,
  favorite: false,
  skip: false,
  memo: '',
};

/**
 * storeからロードする。キーが無い・JSONとして壊れている場合は空のマップを返す
 * （エラーを投げて画面を壊さない）。
 *
 * `key` は呼び出し側が年度ぶんを明示する（既定値を持たせると、年度を渡し忘れたページが
 * 黙って他の年度のデータを読み書きしてしまうため）。
 */
export function loadEvaluations(store: KeyValueStore, key: string): EvaluationMap {
  const raw = store.getItem(key);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as EvaluationMap;
  } catch {
    return {};
  }
}

export function saveEvaluations(store: KeyValueStore, key: string, map: EvaluationMap): void {
  store.setItem(key, JSON.stringify(map));
}

/** 指定した馬の評価を取得する。未評価ならデフォルト値を返す（マップは変更しない）。 */
export function getEvaluation(map: EvaluationMap, horseId: string): Evaluation {
  return map[horseId] ?? { ...DEFAULT_EVALUATION };
}

/** 指定した馬の評価を部分更新した新しいマップを返す（元のマップは変更しない）。 */
export function updateEvaluation(map: EvaluationMap, horseId: string, patch: Partial<Evaluation>): EvaluationMap {
  const current = getEvaluation(map, horseId);
  return {
    ...map,
    [horseId]: { ...current, ...patch },
  };
}
