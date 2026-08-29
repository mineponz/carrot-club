/**
 * `recruits.json` の各馬に `shareCount`（募集口数）を埋めるスクリプト。
 *
 * 背景（2026-08-29）: 分析記事の「回収率」を `獲得賞金合計 ÷ 一口価格` で出していたが、
 * キャロットの募集口数は馬ごとに違う（大半は400口、一部100口、40口の高額馬もある）ため
 * この値は口数に左右されて意味をなさなかった。`回収率 = 獲得賞金合計 ÷ 募集総額`
 * （募集総額 = 一口価格 × 口数）に直すために口数が要る。
 *
 * 口数の取得元: netkeibaの個体ページ（`/horse/<id>/`）の「募集情報」欄
 *   `<a class="OwnerUnitPrice">1口:7万円/<span>400口</span></a>` の `<span>` 側。
 *   一口価格（`OwnerUnitPrice` の先頭の金額）は `pricePerShare` と突き合わせて検算する
 *   （既存キャッシュ642頭で全一致を確認済み）。
 *   現在の馬主がクラブ名義でなくなっている馬（引退→繁殖入り等）はこの欄自体が無く、
 *   その場合は `shareCount: null` のまま残す。
 *
 * 個体ページは `fetch-race-results.mjs` が既にキャッシュ済み（`.cache/netkeiba/`）。
 * 大半はキャッシュヒットで新規リクエストは発生しない。欄が無いキャッシュ（古い時期に
 * 取得したページ）だけ再取得する。
 *
 * 使い方:
 *   node scripts/enrich-share-count.mjs
 *   node scripts/enrich-share-count.mjs --limit 5
 *   node scripts/enrich-share-count.mjs --no-refetch   # キャッシュに無い分の再取得をしない
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

function parseArgs(argv) {
  const args = { limit: Infinity, refetch: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--no-refetch') args.refetch = false;
    else throw new Error(`未知の引数: ${a}`);
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequestAt = 0;
async function throttle() {
  const wait = MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < wait) await sleep(wait - elapsed);
  lastRequestAt = Date.now();
}

function cachePathFor(url) {
  return join(CACHE_DIR, `${createHash('sha1').update(url).digest('hex')}.html`);
}

function readCache(url) {
  const p = cachePathFor(url);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

async function fetchEucJp(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await throttle();
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = new TextDecoder('euc-jp').decode(await res.arrayBuffer());
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(cachePathFor(url), html);
      return html;
    } catch (e) {
      lastError = e;
      console.warn(`  [warn] 取得失敗 (${attempt}/3) ${url}: ${e.message}`);
      await sleep(1500 * attempt);
    }
  }
  throw lastError;
}

const OWNER_UNIT_RX =
  /class="OwnerUnitPrice"[^>]*>\s*1口:([\d,.]+)万円\s*\/\s*<span>(\d+)口<\/span>/;

/** 個体ページHTMLから { pricePerShare(万円), shareCount(口) } を取る。無ければnull。 */
function parseOffering(html) {
  const m = html && html.match(OWNER_UNIT_RX);
  if (!m) return null;
  return { pricePerShare: Number(m[1].replace(/,/g, '')), shareCount: Number(m[2]) };
}

function idOf(netkeibaUrl) {
  return (netkeibaUrl.match(/horse\/([0-9a-z]+)/) || [])[1] || null;
}

/** その馬の個体ページとして考えられるキャッシュURL（PC版・SP版・スラッシュ有無）。 */
function candidateUrls(netkeibaUrl) {
  const id = idOf(netkeibaUrl);
  const set = new Set([netkeibaUrl]);
  if (id) {
    set.add(`https://db.netkeiba.com/horse/${id}/`);
    set.add(`https://db.sp.netkeiba.com/horse/${id}/`);
    set.add(`https://db.sp.netkeiba.com/horse/${id}`);
  }
  return [...set];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const recruitsPath = join(ROOT, 'analysis', 'data', 'recruits.json');
  const recruits = JSON.parse(readFileSync(recruitsPath, 'utf8'));

  const targets = recruits
    .filter((r) => r.pricePerShare != null && r.netkeibaUrl)
    .slice(0, Number.isFinite(args.limit) ? args.limit : undefined);

  let fromCache = 0;
  let refetched = 0;
  let filled = 0;
  let priceMismatch = 0;
  const stillMissing = [];

  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    process.stdout.write(
      `\r[${i + 1}/${targets.length}] ${r.recruitYear}年No.${r.no} ${r.name}`.padEnd(72)
    );

    let offering = null;
    for (const u of candidateUrls(r.netkeibaUrl)) {
      offering = parseOffering(readCache(u));
      if (offering) {
        fromCache++;
        break;
      }
    }

    if (!offering && args.refetch) {
      const desktop = `https://db.netkeiba.com/horse/${idOf(r.netkeibaUrl)}/`;
      const html = await fetchEucJp(desktop);
      offering = parseOffering(html);
      refetched++;
    }

    if (!offering) {
      r.shareCount = r.shareCount ?? null;
      stillMissing.push(`${r.recruitYear}/No.${r.no}`);
      continue;
    }

    if (Math.abs(offering.pricePerShare - r.pricePerShare) > 0.01) {
      priceMismatch++;
      console.warn(
        `\n  [warn] 一口価格不一致 ${r.recruitYear}年No.${r.no}: sheet=${r.pricePerShare} netkeiba=${offering.pricePerShare}`
      );
    }
    r.shareCount = offering.shareCount;
    filled++;
  }
  console.log();

  // 全頭に `shareCount` キーを持たせる（一口価格が無い馬・取れなかった馬は null）。
  for (const r of recruits) {
    if (!('shareCount' in r)) r.shareCount = null;
  }

  writeFileSync(recruitsPath, JSON.stringify(recruits, null, 2) + '\n');

  const dist = {};
  for (const r of recruits) {
    if (r.shareCount != null) dist[r.shareCount] = (dist[r.shareCount] || 0) + 1;
  }
  console.log(`書き出し: ${recruitsPath}`);
  console.log(
    `対象 ${targets.length}頭 / キャッシュから ${fromCache} / 再取得 ${refetched} / 口数を埋めた ${filled} / 一口価格不一致 ${priceMismatch}`
  );
  console.log(`口数の分布: ${JSON.stringify(dist)}`);
  console.log(
    `口数が取れなかった ${stillMissing.length}頭: ${stillMissing.join(', ') || '(なし)'}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
