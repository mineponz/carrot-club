/**
 * 集計APIを叩くブラウザ側の薄い層。fetch と localStorage に触るのはここだけで、
 * 送受信の形と検証は evaluation-api.ts（純粋関数・テストあり）に置いてある。
 *
 * ## 失敗しても画面を壊さない
 * 他会員の評価は「あれば嬉しい」情報で、このサイトの主目的（自分で並べ替えて選ぶ）には
 * 必須ではない。オフライン・APIエラー・レスポンス破損のいずれでも例外を投げず、
 * 送信は黙って諦め、取得は空の集計を返す。原因を追えるように console には必ず残す。
 *
 * ## 送るもの
 * rating（A〜E）と匿名IDだけ。メモ・お気に入り・消フラグはこの層にも渡ってこない
 * （引数がプリミティブ3つなので、評価オブジェクトごと渡すことができない）。
 */

import type { Rating } from './evaluations.ts';
import { getOrCreateAnonId, randomAnonId } from './anon-id.ts';
import {
  ANON_ID_HEADER,
  EVALUATIONS_API_PATH,
  buildSubmissionBody,
  parseSummaryResponse,
  summaryUrlForYear,
  type EvaluationSummary,
} from './evaluation-api.ts';

const LOG_PREFIX = '[peer-eval]';

/**
 * localStorage は プライベートモードや設定次第で参照そのものが例外になる。
 * 取れなければ匿名IDを持てない＝送信しない、という扱いにする。
 */
function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch (e) {
    console.warn(LOG_PREFIX, 'localStorageが使えないため集計への参加を見送ります', e);
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
 * 自分のratingをサーバーへ送る（付け替え・取り消しも含む）。
 * awaitしなくてよいように、この関数自身が例外を飲み込む。
 */
export async function submitRating(year: number, horseId: string, rating: Rating | null): Promise<void> {
  const anonId = currentAnonId();
  if (!anonId) return;

  try {
    const res = await fetch(EVALUATIONS_API_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [ANON_ID_HEADER]: anonId,
      },
      body: JSON.stringify(buildSubmissionBody(horseId, year, rating)),
      // 集計は個人を識別しない。Cookieを付けないことを明示しておく
      credentials: 'omit',
      keepalive: true,
    });
    if (!res.ok) {
      console.warn(LOG_PREFIX, `評価の送信に失敗 (${res.status})`, { horseId, year });
      return;
    }
    console.debug(LOG_PREFIX, '評価を送信', { horseId, year, rating });
  } catch (e) {
    // オフライン等。localStorage には保存済みなので利用者の手元のデータは失われない
    console.warn(LOG_PREFIX, '評価を送信できませんでした（オフライン等）', e);
  }
}

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
