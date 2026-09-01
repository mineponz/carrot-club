/**
 * 評価APIの**送受信の形**を決める層。
 *
 * ブラウザ側（src/lib/evaluation-client.ts）とWorker側（worker/index.ts）の両方から
 * import する。ここに置いてあるのは副作用の無い純粋関数だけなので `node --test` で検証できる。
 *
 * ## 2つの用途をはっきり分ける（この層の一番の仕事）
 * 1. **他会員に見せる集計**（`/api/evaluations/summary`）… A〜Eの件数と**消（skip）の件数だけ**。
 *    `summarizeRows()` が rating と skip 以外を一切見ないので、メモが混ざる経路が無い。
 * 2. **本人だけが読む同期用データ**（`/api/evaluations/mine`）… 匿名IDに紐づいた
 *    rating・メモ・お気に入り・消。`X-Anon-Id` が一致する行しか返さない。
 *
 * 2026-08-20 以前は「メモ等はそもそも送らない」設計だった（他会員に見せないため）。
 * 端末間で自分のデータを持ち回りたいという要望を受けて、**他会員への公開範囲は変えずに**
 * 本人専用の置き場だけを足している。うっかり混線しないよう、送信の payload は
 * オブジェクトを丸ごと写さず `buildSubmissionBody()` でキーを明示的に組み立て、
 * 受け側の `parseSubmissionBody()` も既知のキーだけを1つずつ読む（スプレッドで写さない）。
 *
 * 2026-09-01、**消（skip）の件数だけ**を集計に足した（本人の指示。「消だけというのは
 * なんならEより下」＝見た上で切った馬が0票として見えないのは実態と違う、という判断）。
 * 公開が増えたのは skip の件数のみで、**memo と favorite は今まで通り `/mine` 専用**。
 * ここを緩めるときは必ず [[20260901-expose-skip-count-in-summary]] と同じ手順を踏むこと。
 */

import type { Evaluation, EvaluationMap, Rating } from './evaluations.ts';

/** 自分の評価を1件送る先（POST） */
export const EVALUATIONS_API_PATH = '/api/evaluations';
/** 年度ぶんの集計を取る先（GET）。**他会員に見せるのはこの結果だけ** */
export const SUMMARY_API_PATH = '/api/evaluations/summary';
/** 自分（`X-Anon-Id` のID）の評価だけを取る先（GET）。端末間の復元に使う */
export const MINE_API_PATH = '/api/evaluations/mine';

/**
 * 匿名IDはbodyではなく**リクエストヘッダ**で送る。
 * 「誰が」（＝匿名ID）と「何を」（＝rating）を別の場所に置いておくと、
 * bodyのバリデーションを rating まわりだけに閉じ込められる。
 */
export const ANON_ID_HEADER = 'X-Anon-Id';

export const RATINGS = ['A', 'B', 'C', 'D', 'E'] as const;

/** 馬IDごとの A〜E それぞれの件数 */
export type RatingCounts = Record<Rating, number>;

/**
 * 馬IDごとの集計の中身。A〜Eの件数に「消」を足したもの。
 *
 * **`skip` は A〜E とは独立した値**。同じ人が「Bだけど消」と付けることができる列なので、
 * `skip` と A〜E の合計は一致しないし、足し合わせても人数にはならない。
 * 「消をEより下に置く」ような重み付けは**読む側でやる**（APIは生の件数だけを返す）。
 *
 * `RatingCounts` を継承した形にしてあるので、A〜Eしか見ない既存の表示関数
 * （`peer-eval.ts`）にはそのまま渡せる。
 */
export interface HorseCounts extends RatingCounts {
  /** 「消（見送り）」を付けた人数。rating を付けずに消だけ、という行も含む */
  skip: number;
}

/** 馬IDごとの集計。A〜Eも消も1件も無い馬はキー自体を持たない */
export type EvaluationSummary = Record<string, HorseCounts>;

/**
 * POSTのbody。**ここに書いてあるフィールド以外は存在しない**（受け側も読まない）。
 *
 * memo / favorite / skip は**省略可能**で、省略＝「この項目は変えない」。
 * 古いJS（rating しか送らない Phase2 のキャッシュ）が動いていても、
 * サーバー上のメモを消してしまわないようにするため。
 */
export interface EvaluationSubmission {
  horseId: string;
  year: number;
  /** null は「A〜Eを外した」。メモ等が空なら行ごと消える（worker/index.ts） */
  rating: Rating | null;
  memo?: string;
  favorite?: boolean;
  skip?: boolean;
}

/** `buildSubmissionBody()` に渡す本人専用の項目（他会員には公開されない） */
export interface PersonalFields {
  memo: string;
  favorite: boolean;
  skip: boolean;
}

/**
 * メモの上限。1頭ぶんの覚え書きとしては十分な長さで、
 * D1に長文を溜め込めないようにする（超えた場合はサーバーが400で弾く）。
 */
export const MAX_MEMO_LENGTH = 2000;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function emptyRatingCounts(): RatingCounts {
  return { A: 0, B: 0, C: 0, D: 0, E: 0 };
}

/** A〜E＋消のゼロ値。集計（`EvaluationSummary`）に入れる箱はこちらを使う */
export function emptyHorseCounts(): HorseCounts {
  return { ...emptyRatingCounts(), skip: 0 };
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
 *
 * `personal` を渡さなければ rating だけの body になり、サーバー側のメモ等は変更されない。
 * 渡す場合もキーを1つずつ書き写す（`...evaluation` のようなスプレッドは使わない）。
 * 将来 `Evaluation` に項目が増えても、ここを直さない限り勝手に送信対象にはならない。
 */
export function buildSubmissionBody(
  horseId: string,
  year: number,
  rating: Rating | null,
  personal?: PersonalFields,
): EvaluationSubmission {
  const body: EvaluationSubmission = { horseId, year, rating };
  if (personal) {
    body.memo = personal.memo;
    body.favorite = personal.favorite;
    body.skip = personal.skip;
  }
  return body;
}

/** `Evaluation` から送信する3項目だけを取り出す（rating は別引数で渡す） */
export function personalFieldsOf(evaluation: Evaluation): PersonalFields {
  return { memo: evaluation.memo, favorite: evaluation.favorite, skip: evaluation.skip };
}

/**
 * 受け取ったbodyを検証する。既知のキーだけを1つずつ読み、
 * 他のフィールド（例: bodyに紛れ込ませた anonId）は**読まずに捨てる**。
 *
 * memo / favorite / skip は未指定なら `undefined` のままにする。サーバーは
 * `undefined` を「変更しない」として扱うので、空文字（＝メモを消した）と区別が要る。
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

  const value: EvaluationSubmission = { horseId: body.horseId, year: body.year, rating };

  if (body.memo !== undefined) {
    if (typeof body.memo !== 'string') return { ok: false, error: 'invalid memo' };
    if (body.memo.length > MAX_MEMO_LENGTH) return { ok: false, error: 'memo too long' };
    value.memo = body.memo;
  }
  if (body.favorite !== undefined) {
    if (typeof body.favorite !== 'boolean') return { ok: false, error: 'invalid favorite' };
    value.favorite = body.favorite;
  }
  if (body.skip !== undefined) {
    if (typeof body.skip !== 'boolean') return { ok: false, error: 'invalid skip' };
    value.skip = body.skip;
  }

  return { ok: true, value };
}

/**
 * D1の `GROUP BY horse_id, rating` の結果1行ぶん。
 *
 * `rating` は **null がありうる**（A〜Eを付けずに消・★・メモだけ付けた行のグループ）。
 * そのグループの `count` は使わない（★やメモだけの人数を漏らさないため）が、
 * `skip_count` は数える。「消だけ」がここに入るので、これを無視すると
 * **見た上で切られた馬が0票に見える**。
 */
export interface SummaryRow {
  horse_id: string;
  rating: string | null;
  count: number;
  /** そのグループのうち消が付いている行数（D1では `SUM(skip)`） */
  skip_count?: number | null;
}

/**
 * 集計クエリの行を馬IDごとのマップに畳む。
 * A〜Eも消も無い馬はキーを作らない（94頭ぶんのゼロだけのオブジェクトを毎回返さない）。
 *
 * **rating と skip は別々に足す。** 同じ行が「Dかつ消」でありうるので、
 * skip を A〜E のどれかに繰り込んだり、逆にA〜Eから差し引いたりはしない。
 */
export function summarizeRows(rows: readonly SummaryRow[]): EvaluationSummary {
  const summary: EvaluationSummary = {};
  for (const row of rows) {
    const skip = Number(row.skip_count) || 0;
    const rating = isRating(row.rating) ? row.rating : null; // CHECK制約があるので想定外の文字列は来ないが、防御的に無視する
    if (rating === null && skip === 0) continue;

    const counts = summary[row.horse_id] ?? emptyHorseCounts();
    if (rating !== null) counts[rating] += Number(row.count) || 0;
    counts.skip += skip;
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
    const counts = emptyHorseCounts();
    let hasAny = false;
    for (const key of [...RATINGS, 'skip'] as const) {
      const n = (value as Record<string, unknown>)[key];
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
        counts[key] = Math.floor(n);
        hasAny = true;
      }
    }
    // skip を返さない古いデプロイのレスポンス（A〜Eだけ）もそのまま読める。
    // その場合 skip は 0 のままになる（「消が0件」ではなく「まだ数えていない」だが、
    // 表示は止めてあるので区別しない）。
    if (hasAny) result[horseId] = counts;
  }
  return result;
}

export function summaryUrlForYear(year: number): string {
  return `${SUMMARY_API_PATH}?year=${encodeURIComponent(String(year))}`;
}

// ---- 自分のデータ（端末間同期） --------------------------------------------
//
// ここから下は `/api/evaluations/mine` 専用。集計（上）とは別の関数・別の型にして、
// 「集計のつもりでメモまで返す」実装ミスが起きないようにしている。

export function mineUrlForYear(year: number): string {
  return `${MINE_API_PATH}?year=${encodeURIComponent(String(year))}`;
}

/** D1から1人ぶんを引いた行。0/1 で入る favorite・skip を boolean に直すのが下の関数 */
export interface MineRow {
  horse_id: string;
  rating: string | null;
  memo: string | null;
  favorite: number | boolean | null;
  skip: number | boolean | null;
}

function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

/**
 * 自分の行を localStorage と同じ形（`EvaluationMap`）に畳む。
 * この形のまま保存できるので、復元側で項目を組み替える必要がない。
 */
export function rowsToEvaluationMap(rows: readonly MineRow[]): EvaluationMap {
  const map: EvaluationMap = {};
  for (const row of rows) {
    if (!isValidHorseId(row.horse_id)) continue;
    map[row.horse_id] = {
      rating: isRating(row.rating) ? row.rating : null,
      favorite: toBool(row.favorite),
      skip: toBool(row.skip),
      memo: typeof row.memo === 'string' ? row.memo : '',
    };
  }
  return map;
}

/**
 * `/api/evaluations/mine` のレスポンスを読む。**壊れていても例外を投げない**。
 * 読めない・形が違う場合は `null`（＝復元できなかった）を返し、空の `{}`（＝0件だった）
 * と区別する。区別しないと「通信に失敗したのに0件で上書き」が起こりうる。
 */
export function parseMineResponse(raw: unknown): EvaluationMap | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const evaluations = (raw as Record<string, unknown>).evaluations;
  if (typeof evaluations !== 'object' || evaluations === null || Array.isArray(evaluations)) return null;

  const map: EvaluationMap = {};
  for (const [horseId, value] of Object.entries(evaluations as Record<string, unknown>)) {
    if (!isValidHorseId(horseId)) continue;
    if (typeof value !== 'object' || value === null) continue;
    const v = value as Record<string, unknown>;
    map[horseId] = {
      rating: isRating(v.rating) ? v.rating : null,
      favorite: toBool(v.favorite),
      skip: toBool(v.skip),
      memo: typeof v.memo === 'string' ? v.memo.slice(0, MAX_MEMO_LENGTH) : '',
    };
  }
  return map;
}

/**
 * 復元時の突き合わせ。**同じ馬はサーバー側（remote）で上書きし、
 * サーバーに無い馬のローカルの評価はそのまま残す。**
 *
 * 丸ごと置き換えにすると、まだアップロードしていないこの端末だけの評価が消える。
 * 逆にローカル優先にすると復元にならない。「同じ馬はサーバーが勝つ」が
 * 復元の意図に沿っていて、かつ失うものが無い。
 */
export function mergeEvaluationMaps(local: EvaluationMap, remote: EvaluationMap): EvaluationMap {
  return { ...local, ...remote };
}

/** A〜Eの合計票数。**消は含まない**（A〜Eと独立した値なので足すと二重に数える） */
export function totalOf(counts: RatingCounts): number {
  return RATINGS.reduce((sum, r) => sum + counts[r], 0);
}
