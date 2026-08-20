/**
 * 集計API + 静的アセット配信のWorkerエントリ（wrangler.jsonc の "main"）。
 *
 * Phase1では "main" を持たず静的配信だけだった。Phase2で会員同士の評価を集計するために
 * **新しいサーバーは立てず**、同じWorkerプロジェクトにD1バインディングとこのファイルを足している。
 *
 * ## ルーティング
 * - `POST /api/evaluations`          … 自分のrating（A〜E）を1件upsert。ratingがnullなら削除
 * - `GET  /api/evaluations/summary`  … `?year=` で年度を指定し、馬IDごとのA〜E件数を返す
 * - それ以外                          … `env.ASSETS.fetch(request)` にそのまま流す
 *
 * 最後のフォールバックが重要。"main" を設定するとアセットに一致しないURLもWorkerに来るため、
 * ここでASSETSへ渡さないと 404-page（wrangler.jsonc の not_found_handling）が効かなくなり、
 * サイトの全ページが壊れる。**新しいルートを足すときは必ずこのフォールバックより前に書く。**
 *
 * ## 保存するもの
 * rating と匿名IDだけ。メモ・お気に入り・消フラグは受け取らないし、D1のテーブルにも
 * 列が無い（migrations/0001_create_evaluations.sql）。bodyの検証は
 * src/lib/evaluation-api.ts の `parseSubmissionBody()` に集約していて、既知の3キー以外は
 * 読まずに捨てる。
 */

import {
  ANON_ID_HEADER,
  EVALUATIONS_API_PATH,
  SUMMARY_API_PATH,
  isValidAnonId,
  isValidYear,
  parseSubmissionBody,
  summarizeRows,
  type SummaryRow,
} from '../src/lib/evaluation-api.ts';

/**
 * Workers ランタイムの型は最小限だけ自前で宣言している。
 * `@cloudflare/workers-types` を入れると Request / Response などのグローバルが
 * DOMの定義と衝突し、Astro側（`astro check`）の型チェックが壊れるため。
 * ここで使っているD1のAPIは prepare / bind / run / all だけ。
 */
interface D1Result<T> {
  results: T[];
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  all<T>(): Promise<D1Result<T>>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
}
interface Env {
  DB: D1Database;
  /** 静的アセット。wrangler.jsonc の assets.binding と名前を合わせること */
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const LOG_PREFIX = '[eval-api]';

/** POSTのbodyの上限。3フィールドしか無いので数百バイトで十分足りる */
const MAX_BODY_BYTES = 1024;

/**
 * 集計はリアルタイム性が要らない一方、一覧ページを開くたびに全頭ぶん読まれる。
 * D1の読み取り回数を抑えるためエッジキャッシュに短時間だけ載せる。
 */
const SUMMARY_CACHE_SECONDS = 60;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

async function handleSubmit(request: Request, env: Env): Promise<Response> {
  // 匿名IDはヘッダで受け取る（bodyは「何を評価したか」だけに保つ）
  const anonId = request.headers.get(ANON_ID_HEADER);
  if (!isValidAnonId(anonId)) {
    console.warn(LOG_PREFIX, 'POST 拒否: 匿名IDの形式が不正');
    return json({ error: 'invalid anon id' }, 400);
  }

  const contentLength = Number(request.headers.get('Content-Length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    console.warn(LOG_PREFIX, `POST 拒否: bodyが大きすぎる (${contentLength}B)`);
    return json({ error: 'body too large' }, 413);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    console.warn(LOG_PREFIX, 'POST 拒否: bodyがJSONとして読めない');
    return json({ error: 'invalid json' }, 400);
  }

  const parsed = parseSubmissionBody(raw);
  if (!parsed.ok) {
    console.warn(LOG_PREFIX, `POST 拒否: ${parsed.error}`);
    return json({ error: parsed.error }, 400);
  }
  const { horseId, year, rating } = parsed.value;

  try {
    if (rating === null) {
      // 未評価に戻した場合。0票として残すのではなく行ごと消す
      await env.DB.prepare(
        'DELETE FROM evaluations WHERE horse_id = ?1 AND year = ?2 AND anon_id = ?3',
      )
        .bind(horseId, year, anonId)
        .run();
      console.log(LOG_PREFIX, `評価を削除 year=${year} horse=${horseId}`);
    } else {
      // 主キー (horse_id, year, anon_id) で「1人1頭1票」を担保し、付け替えは上書きする
      await env.DB.prepare(
        `INSERT INTO evaluations (horse_id, year, anon_id, rating, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (horse_id, year, anon_id)
         DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at`,
      )
        .bind(horseId, year, anonId, rating, Date.now())
        .run();
      console.log(LOG_PREFIX, `評価を保存 year=${year} horse=${horseId} rating=${rating}`);
    }
  } catch (e) {
    console.error(LOG_PREFIX, 'D1への書き込みに失敗', e);
    return json({ error: 'storage error' }, 500);
  }

  return json({ ok: true });
}

async function handleSummary(request: Request, env: Env): Promise<Response> {
  const year = Number(new URL(request.url).searchParams.get('year'));
  if (!isValidYear(year)) {
    console.warn(LOG_PREFIX, 'GET 拒否: yearが不正');
    return json({ error: 'invalid year' }, 400);
  }

  try {
    const { results } = await env.DB.prepare(
      `SELECT horse_id, rating, COUNT(*) AS count
         FROM evaluations
        WHERE year = ?1
        GROUP BY horse_id, rating`,
    )
      .bind(year)
      .all<SummaryRow>();

    const summary = summarizeRows(results ?? []);
    console.log(LOG_PREFIX, `集計を返却 year=${year} horses=${Object.keys(summary).length}`);
    return json({ year, summary }, 200, {
      'Cache-Control': `public, max-age=${SUMMARY_CACHE_SECONDS}`,
    });
  } catch (e) {
    console.error(LOG_PREFIX, 'D1からの読み取りに失敗', e);
    return json({ error: 'storage error' }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === EVALUATIONS_API_PATH) {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      return handleSubmit(request, env);
    }

    if (pathname === SUMMARY_API_PATH) {
      if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
      return handleSummary(request, env);
    }

    // APIでないものは全部静的アセットへ。404-page の扱いもASSETS側が面倒を見る
    return env.ASSETS.fetch(request);
  },
};
