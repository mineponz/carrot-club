/**
 * 評価APIを叩くブラウザ側の薄い層。fetch と localStorage に触るのはここだけで、
 * 送受信の形と検証は evaluation-api.ts（純粋関数・テストあり）に置いてある。
 *
 * ## 失敗しても画面を壊さない
 * localStorage が正本で、サーバーは端末間で持ち回るための控え。オフライン・APIエラー・
 * レスポンス破損のいずれでも例外を投げず、送信は黙って諦め、取得は空（または null）を返す。
 * 原因を追えるように console には必ず残す。
 *
 * ## 送るもの
 * rating（A〜E）に加えて、2026-08-20 から**本人専用の同期用データ**として
 * メモ・お気に入り・消も送る。送り先は同じ行（匿名IDが主キーの一部）で、
 * 他会員に見える集計（`/api/evaluations/summary`）は今まで通り rating の件数だけを返す。
 * 送信の組み立ては必ず `buildSubmissionBody()` を通す（キーを明示的に写す）。
 *
 * ## メモは打鍵のたびに送らない
 * メモ欄は1文字ごとに localStorage へ保存している。同じ頻度でPOSTすると無駄なので、
 * `queueEvaluationSync()` で少しまとめてから送る。まとめている途中でページを離れる場合は
 * `pagehide` / `visibilitychange` で送り切る（`keepalive: true` なので離脱中でも飛ぶ）。
 */

import type { Evaluation, EvaluationMap, Rating } from './evaluations.ts';
import { isEmptyEvaluation } from './evaluations.ts';
import { getOrCreateAnonId, randomAnonId, setAnonId } from './anon-id.ts';
import {
  ANON_ID_HEADER,
  EVALUATIONS_API_PATH,
  buildSubmissionBody,
  mineUrlForYear,
  parseMineResponse,
  parseSummaryResponse,
  personalFieldsOf,
  summaryUrlForYear,
  type EvaluationSummary,
} from './evaluation-api.ts';

const LOG_PREFIX = '[peer-eval]';

/** 入力が途切れてから送信するまでの待ち時間（メモの打鍵をまとめるため） */
const SYNC_DEBOUNCE_MS = 800;

/**
 * localStorage は プライベートモードや設定次第で参照そのものが例外になる。
 * 取れなければ匿名IDを持てない＝送信しない、という扱いにする。
 */
function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch (e) {
    console.warn(LOG_PREFIX, 'localStorageが使えないため同期・集計への参加を見送ります', e);
    return null;
  }
}

/** この端末の匿名ID。取得できなければ空文字（＝送信しない） */
export function currentAnonId(): string {
  const store = safeLocalStorage();
  if (!store) return '';
  try {
    return getOrCreateAnonId(store, randomAnonId);
  } catch (e) {
    console.warn(LOG_PREFIX, '匿名IDを用意できませんでした', e);
    return '';
  }
}

/**
 * この端末の匿名IDを、別の端末で発行されたIDに乗り換える（同期の取り込み）。
 * 形式が不正・localStorageが使えない場合は false（呼び出し側が画面に理由を出す）。
 */
export function useAnonId(id: string): boolean {
  const store = safeLocalStorage();
  if (!store) return false;
  try {
    const ok = setAnonId(store, id);
    // IDそのものはログに出さない（コンソールに合言葉を残さない）
    console.debug(LOG_PREFIX, ok ? '同期IDを取り込みました' : '同期IDの形式が不正');
    return ok;
  } catch (e) {
    console.warn(LOG_PREFIX, '同期IDを保存できませんでした', e);
    return false;
  }
}

/**
 * 自分の評価を1件サーバーへ送る（付け替え・取り消しも含む）。
 * awaitしなくてよいように、この関数自身が例外を飲み込む。
 *
 * `evaluation` を省略すると rating だけを送る（メモ等はサーバー側の値が維持される）。
 * 戻り値は成功したかどうか。アップロードの進捗表示だけが使う。
 */
export async function submitEvaluation(
  year: number,
  horseId: string,
  rating: Rating | null,
  evaluation?: Evaluation,
  anonIdOverride?: string,
): Promise<boolean> {
  const anonId = anonIdOverride || currentAnonId();
  if (!anonId) return false;

  try {
    const res = await fetch(EVALUATIONS_API_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [ANON_ID_HEADER]: anonId,
      },
      body: JSON.stringify(
        buildSubmissionBody(horseId, year, rating, evaluation ? personalFieldsOf(evaluation) : undefined),
      ),
      // 認証はこの匿名IDだけ。Cookieを付けないことを明示しておく
      credentials: 'omit',
      keepalive: true,
    });
    if (!res.ok) {
      console.warn(LOG_PREFIX, `評価の送信に失敗 (${res.status})`, { horseId, year });
      return false;
    }
    // メモの中身はログに出さない（コンソールに個人の書き込みを残さない）
    console.debug(LOG_PREFIX, '評価を送信', { horseId, year, rating });
    return true;
  } catch (e) {
    // オフライン等。localStorage には保存済みなので利用者の手元のデータは失われない
    console.warn(LOG_PREFIX, '評価を送信できませんでした（オフライン等）', e);
    return false;
  }
}

// ---- まとめ送り ------------------------------------------------------------

/** 送信待ちの評価。同じ馬を続けて編集したら最後の状態だけを送る */
const pending = new Map<string, { year: number; horseId: string; evaluation: Evaluation }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** 溜まっているぶんを今すぐ送る（離脱時にも呼ばれる） */
export function flushEvaluationSync(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pending.size === 0) return;
  const items = [...pending.values()];
  pending.clear();
  for (const item of items) {
    void submitEvaluation(item.year, item.horseId, item.evaluation.rating, item.evaluation);
  }
}

/**
 * 評価が変わったことを伝える。少し待ってからまとめて送る（失敗しても画面は壊れない）。
 * 呼び出し側は localStorage への保存が終わった後に、その馬の**現在の全項目**を渡すこと。
 */
export function queueEvaluationSync(year: number, horseId: string, evaluation: Evaluation): void {
  pending.set(`${year}:${horseId}`, { year, horseId, evaluation });
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushEvaluationSync, SYNC_DEBOUNCE_MS);
}

if (typeof document !== 'undefined') {
  // タブを閉じる・別アプリへ切り替える時に送り残しを出さない。
  // pagehide だけだとモバイルSafariでバックグラウンドに回った場合に発火しないことがある。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushEvaluationSync();
  });
  window.addEventListener('pagehide', flushEvaluationSync);
}

// ---- 取得 ------------------------------------------------------------------

/** 年度ぶんの集計を取得する。失敗したら空（＝どの馬も「まだ評価なし」表示） */
export async function fetchPeerSummary(year: number): Promise<EvaluationSummary> {
  try {
    const res = await fetch(summaryUrlForYear(year), { credentials: 'omit' });
    if (!res.ok) {
      console.warn(LOG_PREFIX, `集計の取得に失敗 (${res.status})`);
      return {};
    }
    const summary = parseSummaryResponse(await res.json());
    console.debug(LOG_PREFIX, `集計を取得: ${Object.keys(summary).length}頭ぶん`);
    return summary;
  } catch (e) {
    console.warn(LOG_PREFIX, '集計を取得できませんでした（オフライン等）', e);
    return {};
  }
}

/**
 * 指定した匿名IDに保存されている自分の評価を取得する（端末間の復元）。
 *
 * 失敗は `null`。0件（`{}`）と区別できるようにしてあるので、呼び出し側は
 * 「取得に失敗したのにローカルを空で上書きする」ことがない。
 */
export async function fetchMyEvaluations(year: number, anonId: string): Promise<EvaluationMap | null> {
  try {
    const res = await fetch(mineUrlForYear(year), {
      headers: { [ANON_ID_HEADER]: anonId },
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn(LOG_PREFIX, `自分の評価の取得に失敗 (${res.status})`);
      return null;
    }
    const map = parseMineResponse(await res.json());
    if (!map) {
      console.warn(LOG_PREFIX, '自分の評価のレスポンスが読めませんでした');
      return null;
    }
    console.debug(LOG_PREFIX, `自分の評価を取得: ${Object.keys(map).length}頭ぶん`);
    return map;
  } catch (e) {
    console.warn(LOG_PREFIX, '自分の評価を取得できませんでした（オフライン等）', e);
    return null;
  }
}

/**
 * この端末に溜まっている評価をまとめてアップロードする（同期を始める1回目のために使う）。
 *
 * 何も入っていない馬は送らない。サーバーを叩きすぎないよう1件ずつ順番に送る
 * （94頭でも数秒で終わる規模）。戻り値は成功・失敗の件数。
 */
export async function uploadAllEvaluations(
  year: number,
  map: EvaluationMap,
  onProgress?: (done: number, total: number) => void,
): Promise<{ sent: number; failed: number }> {
  const entries = Object.entries(map).filter(([, evaluation]) => !isEmptyEvaluation(evaluation));
  let sent = 0;
  let failed = 0;
  for (const [horseId, evaluation] of entries) {
    const ok = await submitEvaluation(year, horseId, evaluation.rating, evaluation);
    if (ok) sent += 1;
    else failed += 1;
    onProgress?.(sent + failed, entries.length);
  }
  console.debug(LOG_PREFIX, `アップロード完了: 成功${sent}件 / 失敗${failed}件`);
  return { sent, failed };
}
