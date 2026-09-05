/**
 * **不使用（2026-09-05〜）**: `scripts/fetch-leading-trainers-netkeiba.mjs` に置き換え済み。
 * umapiaの表はJRA上位およそ50位までしか無く、それより下の調教師が「圏外」表示になっていた
 * （stable-leading記事）。netkeiba db.netkeiba.com/trainer/trainer_leading_jra.html
 * （ページ送りで各年5〜6ページ・200位超まで取得可）に切り替えた。削除するか残すかは未確認
 * （vault: `1-projects/carrot-club/tasks/20260905-stable-leading-netkeiba-source.md`）。
 * 以下は旧スクリプトの説明（参考として残す）。
 *
 * 年別のJRA調教師リーディングを取得して `analysis/data/leading-trainers.json` に書き出す。
 * 9本目の分析記事「東西＋調教師」追加カットA用（vault: 20260902-trainer-region-article-scan.md）。
 *
 * 取得元: umapia（https://umapia.jp/search/trainers?year=YYYY）。
 *   netkeiba db.netkeiba.com の `pid=leading_trainer` は現在エラーpage（URLを返すだけ）で
 *   使えなかったため、タスクで代替として挙げられている umapia を使用（2026-09-02 確認）。
 *   umapia のこの表はJRAのみ（矢作芳人47勝/2023 等、地方の多勝利調教師は載らない）。
 *   1ページに上位およそ50名（＝N=10/20/30 の判定には十分）。
 * 列: 順位 / 調教師名 / 1着 / 2着 / 3着 / 着外 / 出走回数 / 勝率 / 連対率 / 複勝率 / 通算勝利数 / 総賞金
 *
 * アクセス礼儀は netkeiba スクレイパと同じ（1リクエスト 700〜1100ms ウェイト、
 * `.cache/umapia/` にキャッシュして再実行時に叩き直さない）。
 *
 *   node scripts/fetch-leading-trainers.mjs
 *   node scripts/fetch-leading-trainers.mjs --no-cache
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'umapia');
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MIN_INTERVAL_MS = 700;
const MAX_INTERVAL_MS = 1100;
const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequestAt = 0;
async function throttle() {
  const wait = MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < wait) await sleep(wait - elapsed);
  lastRequestAt = Date.now();
}
async function fetchHtml(url, { cache = true } = {}) {
  const cachePath = join(CACHE_DIR, `${createHash('sha1').update(url).digest('hex')}.html`);
  if (cache && existsSync(cachePath)) return { html: readFileSync(cachePath, 'utf8'), fromCache: true };
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await throttle();
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
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

const cleanName = (s) =>
  s.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim();

function parseLeading(html) {
  const bodyM = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  const scope = bodyM ? bodyM[1] : html;
  const rows = [...scope.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const out = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 3) continue;
    const rank = Number(cells[0].replace(/<[^>]+>/g, '').trim());
    if (!Number.isFinite(rank)) continue;
    const idM = cells[1].match(/\/search\/trainers\/(\d+)/);
    const name = cleanName(cells[1]);
    const wins = Number(cells[2].replace(/<[^>]+>/g, '').replace(/,/g, '').trim());
    if (!name) continue;
    out.push({ rank, trainer: name, umapiaId: idM ? idM[1] : null, wins: Number.isFinite(wins) ? wins : null });
  }
  return out;
}

async function main() {
  const cache = !process.argv.includes('--no-cache');
  const byYear = {};
  let fromCacheCount = 0;
  for (const year of YEARS) {
    const url = `https://umapia.jp/search/trainers?year=${year}`;
    const { html, fromCache } = await fetchHtml(url, { cache });
    if (fromCache) fromCacheCount++;
    const rows = parseLeading(html);
    byYear[year] = rows;
    const maxRank = rows.reduce((a, r) => Math.max(a, r.rank), 0);
    console.log(
      `${year}: ${rows.length}行 (最大順位 ${maxRank})  例: ${rows
        .slice(0, 3)
        .map((r) => `${r.rank}.${r.trainer}(${r.wins})`)
        .join(' / ')}${fromCache ? '  [cache]' : ''}`
    );
  }
  const outPath = join(ROOT, 'analysis', 'data', 'leading-trainers.json');
  writeFileSync(
    outPath,
    JSON.stringify(
      { fetchedAt: new Date().toISOString(), source: 'umapia.jp/search/trainers (JRA)', byYear },
      null,
      2
    ) + '\n'
  );
  console.log(`\n書き出し: ${outPath}  / キャッシュヒット ${fromCacheCount}/${YEARS.length}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
