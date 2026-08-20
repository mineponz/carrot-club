/**
 * 会員同士の評価（印）を集計するAPIの**送受信の形**を決める層。
 *
 * ブラウザ側（src/lib/evaluation-client.ts）とWorker側（worker/index.ts）の両方から
 * import する。ここに置いてあるのは副作用の無い純粋関数だけなので `node --test` で検証できる。
 *
 * ## 送るものを絞る（この層の一番の仕事）
 * サーバーへ送るのは **rating（A〜E）と匿名IDだけ**。メモ・お気に入り・消フラグは
 * 個人的な内容になりうるので送らない。これは src/lib/evaluations.ts 冒頭に書かれた
 * 当初からの設計方針で、D1のテーブルにもその3つの列を作っていない。
 *
 * 「うっかり混ざる」ことを防ぐため、payload は**オブジェクトを丸ごと渡さず**
 * `buildSubmissionBody()` で3つのキーを明示的に組み立て、受け側の
 * `parseSubmissionBody()` も既知のキーだけを1つずつ読む（スプレッドで写さない）。
 * evaluation-api.test.ts でメモ入りのオブジェクトを渡しても落ちることを検証している。
 */

import type { Rating } from './evaluations.ts';

/** 自分の評価を1件送る先（POST） */
export const EVALUATIONS_API_PATH = '/api/evaluations';
/** 年度ぶんの集計を取る先（GET） */
export const SUMMARY_API_PATH = '/api/evaluations/summary';

/**
 * 匿名IDはbodyではなく**リクエストヘッダ**で送る。
 * 「誰が」（＝匿名ID）と「何を」（＝rating）を別の場所に置いておくと、
 * bodyのバリデーションを rating まわりだけに閉じ込められる。
 */
export const ANON_ID_HEADER = 'X-Anon-Id';

export const RATINGS = ['A', 'B', 'C', 'D', 'E'] as const;

/** 馬IDごとの A〜E それぞれの件数 */
export type RatingCounts = Record<Rating, number>;

/** 馬IDごとの集計。1票も入っていない馬はキー自体を持たない */
export type EvaluationSummary = Record<string, RatingCounts>;

/** POSTのbody。**この3つ以外のフィールドは存在しない** */
export interface EvaluationSubmission {
  horseId: string;
  year: number;
  /** null は「評価を外した」= サーバー側の行を消す指示 */
  rating: Rating | null;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function emptyRatingCounts(): RatingCounts {
  return { A: 0, B: 0, C: 0, D: 0, E: 0 };
}

export function isRating(value: unknown): value is Rating {
  return typeof value === 'string' && (RATINGS as readonly string[]).includes(value);
}

/**
 * 匿名IDは `crypto.randomUUID()` が返す形式（小文字のUUID）だけを受け付ける。
 * 形式を固定しておくと、長さ無制限の任意文字列が主キーに入るのを防げる。
 */
export const ANON_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isValidAnonId(value: unknown): value is string {
  return typeof value === 'string' && ANON_ID_PATTERN.test(value);
}

/**
 * 馬IDはクラブの募集番号（"1" 〜 "94" など）。桁数の想定は緩めに取りつつ、
 * 長い文字列や記号を主キーに入れられないよう英数字とハイフンに限る。
 */
export function isValidHorseId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9A-Za-z-]{1,16}$/.test(value);
}

/**
 * 募集年。過去年度ページ（2025）と将来の年度を通せる範囲に留め、
 * 桁の壊れた値でテーブルを汚さないようにする。
 */
export function isValidYear(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 2000 && value <= 2100;
}

/**
 * POSTのbodyを組み立てる。**必ずこの関数を通す**こと。
 * 呼び出し側の `Evaluation` オブジェクトをそのまま渡すとメモが混ざるため、
 * 引数を3つのプリミティブに分けてある。
 */
export function buildSubmissionBody(
  horseId: string,
  year: number,
  rating: Rating | null,
): EvaluationSubmission {
  return { horseId, year, rating };
}

/**
 * 受け取ったbodyを検証する。既知の3キーだけを1つずつ読み、
 * 他のフィールドは**読まずに捨てる**（保存する経路が存在しない）。
 */
export function parseSubmissionBody(raw: unknown): ParseResult<EvaluationSubmission> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const body = raw as Record<string, unknown>;

  if (!isValidHorseId(body.horseId)) return { ok: false, error: 'invalid horseId' };
  if (!isValidYear(body.year)) return { ok: false, error: 'invalid year' };

  const rawRating = body.rating;
  // 未評価に戻した場合は null（または未指定）で来る。空文字も同じ扱いにしておく
  // （selectのvalueが '' なので、クライアントの実装ミスで素通りしても壊れないように）。
  const rating = rawRating === null || rawRating === undefined || rawRating === '' ? null : rawRating;
  if (rating !== null && !isRating(rating)) return { ok: false, error: 'invalid rating' };

  return { ok: true, value: { horseId: body.horseId, year: body.year, rating } };
}

/** D1の `GROUP BY horse_id, rating` の結果1行ぶん */
export interface SummaryRow {
  horse_id: string;
  rating: string;
  count: number;
}

/**
 * 集計クエリの行を馬IDごとのマップに畳む。
 * 1票も無い馬はキーを作らない（94頭ぶんのゼロだけのオブジェクトを毎回返さない）。
 */
export function summarizeRows(rows: readonly SummaryRow[]): EvaluationSummary {
  const summary: EvaluationSummary = {};
  for (const row of rows) {
    if (!isRating(row.rating)) continue; // CHECK制約があるので通常来ないが、防御的に無視する
    const counts = summary[row.horse_id] ?? emptyRatingCounts();
    counts[row.rating] += Number(row.count) || 0;
    summary[row.horse_id] = counts;
  }
  return summary;
}

/**
 * 集計APIのレスポンスを読む。**壊れていても例外を投げずに空を返す**
 * （他会員の評価は「あれば嬉しい」情報であって、これで画面全体を落とさない）。
 */
export function parseSummaryResponse(raw: unknown): EvaluationSummary {
  if (typeof raw !== 'object' || raw === null) return {};
  const summary = (raw as Record<string, unknown>).summary;
  if (typeof summary !== 'object' || summary === null || Array.isArray(summary)) return {};

  const result: EvaluationSummary = {};
  for (const [horseId, value] of Object.entries(summary as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const counts = emptyRatingCounts();
    let hasAny = false;
    for (const rating of RATINGS) {
      const n = (value as Record<string, unknown>)[rating];
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
        counts[rating] = Math.floor(n);
        hasAny = true;
      }
    }
    if (hasAny) result[horseId] = counts;
  }
  return result;
}

export function summaryUrlForYear(year: number): string {
  return `${SUMMARY_API_PATH}?year=${encodeURIComponent(String(year))}`;
}

/** A〜Eの合計票数 */
export function totalOf(counts: RatingCounts): number {
  return RATINGS.reduce((sum, r) => sum + counts[r], 0);
}
