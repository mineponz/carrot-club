/**
 * 年別のJRA調教師リーディングを netkeiba（db.netkeiba.com/trainer/trainer_leading_jra.html）
 * から取得して `analysis/data/leading-trainers.json` に書き出す。
 * `scripts/fetch-leading-trainers.mjs`（umapia版）の後継。umapia は上位およそ50位までしか
 * 載らず、それより下の調教師は「圏外」表示になっていた（stable-leading記事）。netkeibaの
 * この表はページ送りで深い順位まで取れる（本人確認・2017〜2026年、各年5ページ確認済み）。
 * URL: https://db.netkeiba.com/trainer/trainer_leading_jra.html?year=YYYY&page=N
 *
 * 各年5ページで打ち止め（2017・2023・2025年でページャの最終ページが5であることを確認済み。
 * 保険として、取得したページのpagerに次ページが無ければそこで止める＝5ページより少ない年が
 * あっても壊れない。逆に5ページ超の年があった場合に備え、pagerに次ページがある限り最大10ページ
 * まで追う）。1ページ50行（同着は同順位で複数行）。

 * 個体ページへのリンクからnetkeibaの調教師ID（例 "01157"）を取得する。このIDは
 * `analysis/data/recruits.json` の `finalTrainerId`（馬の個体ページから取得済み）と
 * 同じ体系（5桁ゼロ埋め）なので、IDでの直接突合ができる
 * （`src/lib/analysis-data.ts` 側で対応。IDが無い/一致しない場合だけ氏名4文字一致にフォールバック）。
 *
 * 列: 順位 / 調教師名+ID / 所属 / 生年月日 / 1着(勝利数) / 2着 / 3着 / 着外 / 重賞出走/勝利 / …
 *   このスクリプトが使うのは 順位・調教師名・ID・1着数（＝勝利数。umapia版の`wins`と同じ定義）のみ。
 *
 * アクセス礼儀は他のnetkeibaスクレイパ（`fetch-race-results.mjs`等）と同じ
 * （1リクエスト700〜1100msウェイト・EUC-JPデコード・`.cache/netkeiba/`にキャッシュ・
 * 失敗時3回リトライ）。
 *
 *   node scripts/fetch-leading-trainers-netkeiba.mjs
 *   node scripts/fetch-leading-trainers-netkeiba.mjs --no-cache
 *   node scripts/fetch-leading-trainers-netkeiba.mjs --limit 1   # 動作確認用（先頭1年のみ）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'netkeiba');
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MIN_INTERVAL_MS = 700;
const MAX_INTERVAL_MS = 1100;
const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const MAX_PAGES = 10; // 保険の上限（実際には5ページ目のpagerに「次」が無くなった時点で止まる）

// ---------------------------------------------------------------- HTTP（fetch-race-results.mjsと同じ方式）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequestAt = 0;
async function throttle() {
  const wait = MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < wait) await sleep(wait - elapsed);
  lastRequestAt = Date.now();
}
async function fetchEucJp(url, { cache = true } = {}) {
  const cachePath = join(CACHE_DIR, `${createHash('sha1').update(url).digest('hex')}.html`);
  if (cache && existsSync(cachePath)) {
    return { html: readFileSync(cachePath, 'utf8'), fromCache: true };
  }
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await throttle();
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = new TextDecoder('euc-jp').decode(await res.arrayBuffer());
      if (cache) {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(cachePath, html);
      }
      return { html, fromCache: false };
    } catch (e) {
      lastError = e;
      console.warn(`  [warn] 取得失敗 (${attempt}/3) ${url}: ${e.message}`);
      await sleep(1500 * attempt);
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------- パース

/** そのページの次にページがあるか（pagerに現在ページ+1へのリンクがあるか）で判定する。 */
function hasNextPage(html, currentPage) {
  return new RegExp(`title="ページ ${currentPage + 1}"`).test(html);
}

function parseLeadingPage(html) {
  const tableM = html.match(/<table[^>]*summary="リーディング順位"[^>]*>([\s\S]*?)<\/table>/);
  const scope = tableM ? tableM[1] : html;
  const rows = [...scope.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const out = [];
  for (const row of rows) {
    const rankM = row.match(/<td nowrap>(\d+)<\/td>/);
    if (!rankM) continue; // ヘッダ行など
    const rank = Number(rankM[1]);
    const nameM = row.match(/<a href="[^"]*\/trainer\/result\/recent\/(\d+)\/"[^>]*>([^<]+)<\/a>/);
    if (!nameM) continue;
    const trainerId = nameM[1];
    const trainer = nameM[2].trim();
    // 1着数 = 勝利数（mode=r1 のリンクの中身）。umapia版の`wins`と同じ定義に合わせる。
    const winsM = row.match(/mode=r1"[^>]*>(\d+)<\/a>/);
    const wins = winsM ? Number(winsM[1]) : null;
    out.push({ rank, trainer, trainerId, wins });
  }
  return out;
}

async function fetchYear(year, { cache }) {
  const rows = [];
  let page = 1;
  let fromCacheCount = 0;
  while (page <= MAX_PAGES) {
    const url = `https://db.netkeiba.com/trainer/trainer_leading_jra.html?year=${year}&page=${page}`;
    const { html, fromCache } = await fetchEucJp(url, { cache });
    if (fromCache) fromCacheCount++;
    const pageRows = parseLeadingPage(html);
    rows.push(...pageRows);
    const nextExists = hasNextPage(html, page);
    if (!nextExists) break;
    page++;
  }
  return { rows, lastPage: page, fromCacheCount };
}

async function main() {
  const args = process.argv.slice(2);
  const cache = !args.includes('--no-cache');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
  const years = YEARS.slice(0, Number.isFinite(limit) ? limit : YEARS.length);

  const byYear = {};
  for (const year of years) {
    const { rows, lastPage, fromCacheCount } = await fetchYear(year, { cache });
    // 検算: 順位が飛んでいないか（同着以外で欠番が無いか）を簡易チェックする。
    const maxRank = rows.reduce((a, r) => Math.max(a, r.rank), 0);
    const withId = rows.filter((r) => r.trainerId).length;
    byYear[year] = rows;
    console.log(
      `${year}: ${rows.length}行（${lastPage}ページ、最大順位${maxRank}、ID取得${withId}/${rows.length}）` +
        `  例: ${rows.slice(0, 3).map((r) => `${r.rank}.${r.trainer}(${r.trainerId})=${r.wins}勝`).join(' / ')}` +
        `  [cache ${fromCacheCount}/${lastPage}]`
    );
  }

  const outPath = join(ROOT, 'analysis', 'data', 'leading-trainers.json');
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        source: 'db.netkeiba.com/trainer/trainer_leading_jra.html (JRA)',
        byYear,
      },
      null,
      2
    ) + '\n'
  );
  console.log(`\n書き出し: ${outPath}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
