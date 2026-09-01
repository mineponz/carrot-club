/**
 * 集計API + 静的アセット配信のWorkerエントリ（wrangler.jsonc の "main"）。
 *
 * Phase1では "main" を持たず静的配信だけだった。Phase2で会員同士の評価を集計するために
 * **新しいサーバーは立てず**、同じWorkerプロジェクトにD1バインディングとこのファイルを足している。
 *
 * ## ルーティング
 * - 旧ドメイン（`carrot-club.mineponz.workers.dev`）宛のアクセス … 独自ドメインへ301リダイレクト
 * - 旧パス（`/horses/{id}/`・`/tour-weight/`・`/2026/`）… 正本URLへ301リダイレクト（src/lib/redirects.ts）
 * - `POST /api/evaluations`          … 自分の評価を1件upsert（rating・メモ・★・消）
 * - `GET  /api/evaluations/summary`  … `?year=` で年度を指定し、馬IDごとのA〜E件数と消の件数を返す
 * - `GET  /api/evaluations/mine`     … `?year=` + `X-Anon-Id`。**そのIDの行だけ**を返す
 * - それ以外                          … `env.ASSETS.fetch(request)` にそのまま流す
 *
 * 最後のフォールバックが重要。"main" を設定するとアセットに一致しないURLもWorkerに来るため、
 * ここでASSETSへ渡さないと 404-page（wrangler.jsonc の not_found_handling）が効かなくなり、
 * サイトの全ページが壊れる。**新しいルートを足すときは必ずこのフォールバックより前に書く。**
 *
 * ## 誰に何が見えるか（ここを崩さないこと）
 * - **他会員に見えるのは summary だけ**。SQLが SELECT するのは `rating` ごとの件数と
 *   `SUM(skip)`（消の人数）だけで、`memo` / `favorite` には触れない。
 *   ここに個人の項目を足してはいけない。
 * - 消（skip）の**件数だけ**は 2026-09-01 に summary へ出した（本人の指示。
 *   「消だけ」の馬が0票に見えるのが実態と違うため。[[20260901-expose-skip-count-in-summary]]）。
 *   誰が付けたかは出さない。**memo と favorite は引き続き summary に出さない。**
 * - メモ・★は `mine` でしか返さない。しかも `WHERE anon_id = ?` で本人の行に限る。
 *   匿名IDを知っている人は本人と同じものを読めるので、画面側で「他人に教えない」と明示している。
 * - bodyの検証は src/lib/evaluation-api.ts の `parseSubmissionBody()` に集約。
 *   既知のキー以外は読まずに捨てる。
 */

import {
  ANON_ID_HEADER,
  EVALUATIONS_API_PATH,
  MINE_API_PATH,
  SUMMARY_API_PATH,
  isValidAnonId,
  isValidYear,
  parseSubmissionBody,
  rowsToEvaluationMap,
  summarizeRows,
  type MineRow,
  type SummaryRow,
} from '../src/lib/evaluation-api.ts';
import { redirectTarget } from '../src/lib/redirects.ts';

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
  /** 複数の文をまとめて（1トランザクションとして）順に実行する */
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}
interface Env {
  DB: D1Database;
  /** 静的アセット。wrangler.jsonc の assets.binding と名前を合わせること */
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const LOG_PREFIX = '[eval-api]';
/** 301リダイレクトのログ用。集計APIのログ（`[eval-api]`）と混ざらないように分ける */
const REDIRECT_LOG_PREFIX = '[redirect]';

/** Cloudflareの無料サブドメイン（独自ドメイン移行前の本番URL）。既存の被リンク・検索インデックスを引き継ぐため301で転送し続ける */
const OLD_HOSTNAME = 'carrot-club.mineponz.workers.dev';
/** 独自ドメイン移行後の正式な本番ホスト名 */
const NEW_HOSTNAME = 'carrot.mineponz.com';

/**
 * POSTのbodyの上限。メモ（最大2000文字＝UTF-8で最大6KB）が入るので、
 * それが収まる程度に取る。長さそのものは parseSubmissionBody() でも弾く。
 */
const MAX_BODY_BYTES = 8 * 1024;

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
  const { horseId, year, rating, memo, favorite, skip } = parsed.value;

  // 送られてこなかった項目は「変えない」。SQL側で COALESCE(?, 既存値) にしたいので、
  // 未指定を null に寄せる（boolean は 0/1 に直す）。
  const memoParam = memo === undefined ? null : memo;
  const favoriteParam = favorite === undefined ? null : favorite ? 1 : 0;
  const skipParam = skip === undefined ? null : skip ? 1 : 0;

  try {
    await env.DB.batch([
      // 主キー (horse_id, year, anon_id) で「1人1頭1行」を担保し、付け替えは上書きする。
      // rating は毎回上書き（null = A〜Eを外した）だが、メモ等は送られてきた時だけ上書きする。
      env.DB.prepare(
        `INSERT INTO evaluations (horse_id, year, anon_id, rating, memo, favorite, skip, updated_at)
         VALUES (?1, ?2, ?3, ?4, COALESCE(?5, ''), COALESCE(?6, 0), COALESCE(?7, 0), ?8)
         ON CONFLICT (horse_id, year, anon_id)
         DO UPDATE SET rating = excluded.rating,
                       memo = COALESCE(?5, evaluations.memo),
                       favorite = COALESCE(?6, evaluations.favorite),
                       skip = COALESCE(?7, evaluations.skip),
                       updated_at = excluded.updated_at`,
      ).bind(horseId, year, anonId, rating, memoParam, favoriteParam, skipParam, Date.now()),
      // 全部空になった行（A〜Eを外し、メモも★も消も無い）は残さず消す。
      // 「未評価の行」を溜めても集計にも同期にも使わないうえ、集計の分母を汚さない。
      env.DB.prepare(
        `DELETE FROM evaluations
          WHERE horse_id = ?1 AND year = ?2 AND anon_id = ?3
            AND rating IS NULL AND memo = '' AND favorite = 0 AND skip = 0`,
      ).bind(horseId, year, anonId),
    ]);
    // メモの中身はログに出さない（あるか無いかだけ）
    console.log(
      LOG_PREFIX,
      `評価を保存 year=${year} horse=${horseId} rating=${rating ?? 'none'} memo=${
        memo === undefined ? 'unchanged' : memo === '' ? 'empty' : `${memo.length}chars`
      }`,
    );
  } catch (e) {
    console.error(LOG_PREFIX, 'D1への書き込みに失敗', e);
    return json({ error: 'storage error' }, 500);
  }

  return json({ ok: true });
}

/**
 * 自分の評価だけを返す（端末間の復元用）。
 *
 * **集計APIとは別物**として分けてある。`WHERE anon_id = ?` でヘッダのIDの行に限り、
 * 他人の行は1件も返らない。返す内容は localStorage と同じ形なので、
 * 受け取った側はそのまま保存できる。
 */
async function handleMine(request: Request, env: Env): Promise<Response> {
  const anonId = request.headers.get(ANON_ID_HEADER);
  if (!isValidAnonId(anonId)) {
    console.warn(LOG_PREFIX, 'GET(mine) 拒否: 匿名IDの形式が不正');
    return json({ error: 'invalid anon id' }, 400);
  }

  const year = Number(new URL(request.url).searchParams.get('year'));
  if (!isValidYear(year)) {
    console.warn(LOG_PREFIX, 'GET(mine) 拒否: yearが不正');
    return json({ error: 'invalid year' }, 400);
  }

  try {
    const { results } = await env.DB.prepare(
      `SELECT horse_id, rating, memo, favorite, skip
         FROM evaluations
        WHERE year = ?1 AND anon_id = ?2`,
    )
      .bind(year, anonId)
      .all<MineRow>();

    const evaluations = rowsToEvaluationMap(results ?? []);
    // 件数だけログに残す。匿名IDもメモも出さない
    console.log(LOG_PREFIX, `自分の評価を返却 year=${year} horses=${Object.keys(evaluations).length}`);
    // 本人だけのデータなので、経路上のどこにもキャッシュさせない
    return json({ year, evaluations }, 200, { 'Cache-Control': 'no-store' });
  } catch (e) {
    console.error(LOG_PREFIX, 'D1からの読み取りに失敗', e);
    return json({ error: 'storage error' }, 500);
  }
}

async function handleSummary(request: Request, env: Env): Promise<Response> {
  const year = Number(new URL(request.url).searchParams.get('year'));
  if (!isValidYear(year)) {
    console.warn(LOG_PREFIX, 'GET 拒否: yearが不正');
    return json({ error: 'invalid year' }, 400);
  }

  try {
    // rating ごとの件数に加えて、そのグループで消が付いている行数（`SUM(skip)`）を数える。
    // rating が NULL のグループ（＝A〜Eを付けずに消・★・メモだけ付けた行）も返ってくるが、
    // summarizeRows() が使うのはその skip_count だけで count は捨てる
    // （★やメモしか付いていない人数を漏らさないため）。
    // このグループを拾わないと「消だけ付けられた馬」が集計から丸ごと消える。
    const { results } = await env.DB.prepare(
      `SELECT horse_id, rating, COUNT(*) AS count, SUM(skip) AS skip_count
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
    const url = new URL(request.url);

    // 旧URL（workers.devの無料サブドメイン）は独自ドメインへ301で転送する。
    // パス・クエリはそのまま引き継ぐ。API/静的アセットどちらの判定より前に置く。
    if (url.hostname === OLD_HOSTNAME) {
      url.hostname = NEW_HOSTNAME;
      return Response.redirect(url.toString(), 301);
    }

    const { pathname } = url;

    // 旧パス → 正本URLの301（規則と「来年やること」は src/lib/redirects.ts のコメント参照）。
    // これは**最新年度への別名**の付け替えであり、`/` と同じ扱いで恒久的に残すもの。
    // 旧ドメイン301の直後・APIルーティングより前に置く（APIパスは対象外だが、
    // 静的アセットへ流す前に必ず通す必要がある）。クエリ文字列はそのまま引き継ぐ。
    const redirect = redirectTarget(pathname);
    if (redirect !== null) {
      const target = new URL(redirect, url);
      target.search = url.search;
      console.log(REDIRECT_LOG_PREFIX, `301 ${pathname} -> ${target.pathname}`);
      return Response.redirect(target.toString(), 301);
    }

    if (pathname === EVALUATIONS_API_PATH) {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      return handleSubmit(request, env);
    }

    if (pathname === SUMMARY_API_PATH) {
      if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
      return handleSummary(request, env);
    }

    if (pathname === MINE_API_PATH) {
      if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
      return handleMine(request, env);
    }

    // APIでないものは全部静的アセットへ。404-page の扱いもASSETS側が面倒を見る
    return env.ASSETS.fetch(request);
  },
};
