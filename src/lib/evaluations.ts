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

export const STORAGE_KEY = 'carrot-club:evaluations:2025';

export const DEFAULT_EVALUATION: Evaluation = {
  rating: null,
  favorite: false,
  skip: false,
  memo: '',
};

/**
 * storeからロードする。キーが無い・JSONとして壊れている場合は空のマップを返す
 * （エラーを投げて画面を壊さない）。
 */
export function loadEvaluations(store: KeyValueStore): EvaluationMap {
  const raw = store.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as EvaluationMap;
  } catch {
    return {};
  }
}

export function saveEvaluations(store: KeyValueStore, map: EvaluationMap): void {
  store.setItem(STORAGE_KEY, JSON.stringify(map));
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
