/**
 * 2017〜2020年募集分（`recruits.json`の`legacySource: true`）は、クラブ公式の測尺一覧ページに
 * 血統・一口価格が載っていなかったため`sire`/`broodmareSire`/`pricePerShare`がnullのままだった。
 * netkeiba側から追加で埋めるスクリプト（本人指定 / 2026-08-23「父の名前や一口の値段を拡充して」）。
 *
 * - 父・母父: 個体の血統表ページ（`/horse/ped/<id>/`）の5代血統表から取る。
 *   表は「rowspan=16のb_mlセル＝父」「rowspan=16のb_fmlセル＝母」「そのb_fml直後に来る
 *   rowspan=8のb_mlセル＝母父」という並びになっている（fetch-2026-data.mjsの
 *   fetchDamFromPedigreeが父側の対称パターンで母を取っているのと同じ考え方）。
 * - 一口価格: 個体ページ（`/horse/<id>/`）の「募集情報」欄
 *   （`<a class="OwnerUnitPrice">1口:7万円/<span>400口</span></a>`）から取る。これは
 *   netkeibaの「セリ取引価格」（せり上場時の総額。非市場馬は空、桁も一口価格とは別物）とは
 *   **別のフィールド**で、クラブの一口出資価格そのもの。ただし現在の馬主が個人名義に変わって
 *   いる馬（引退後に繁殖入りして所有者が変わった等）ではこの欄自体が無いことがあり、
 *   その場合はnullのまま（無理に埋めない）。
 *
 * 個体ページは`fetch-race-results.mjs`が既にキャッシュ済み（`.cache/netkeiba/`）なので、
 * 一口価格の取得は追加リクエスト無しでキャッシュヒットする想定。血統表ページは今回初めて
 * 取得するので、345頭ぶん新規リクエストが発生する。
 *
 * 使い方:
 *   node scripts/enrich-legacy-pedigree-price.mjs
 *   node scripts/enrich-legacy-pedigree-price.mjs --limit 5
 *   node scripts/enrich-legacy-pedigree-price.mjs --no-cache
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
  const args = { limit: Infinity, cache: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--no-cache') args.cache = false;
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

async function fetchEucJp(url, { cache = true } = {}) {
  const cachePath = join(CACHE_DIR, `${createHash('sha1').update(url).digest('hex')}.html`);
  if (cache && existsSync(cachePath)) return { html: readFileSync(cachePath, 'utf8'), fromCache: true };
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

const stripTags = (html) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function normalizeToDesktopUrl(url) {
  return url.replace('db.sp.netkeiba.com', 'db.netkeiba.com');
}

/**
 * 血統表セルから馬名だけ取る。`<a>`内は「和名<br />英名(産地)」の2行構成のことがあり
 * （例:「サンデーサイレンス<br />Sunday Silence(米)」）、セル全体をstripTagsすると
 * 和名と英名がスペース1つでくっついてしまう。`<a>`タグの中身だけ取り、`<br`より前（＝和名）
 * だけを残す。
 */
function cellHorseName(cellHtml) {
  const aM = cellHtml.match(/<a[^>]*>([\s\S]*?)<\/a>/);
  const inner = aM ? aM[1] : cellHtml;
  return stripTags(inner.split(/<br/)[0]);
}

/** 血統表から父・母父の馬名を取る（IDは使わないので名前だけ）。 */
function parsePedigree(html) {
  const sireM = html.match(
    /<td[^>]*rowspan="16"[^>]*class="b_ml"[^>]*>([\s\S]*?)<\/td>/
  );
  const sire = sireM ? cellHorseName(sireM[1]) || null : null;

  const damM = html.match(/<td[^>]*rowspan="16"[^>]*class="b_fml"[^>]*>[\s\S]*?<\/td>/);
  let broodmareSire = null;
  if (damM) {
    const after = html.slice(damM.index + damM[0].length);
    const bmsM = after.match(/<td[^>]*rowspan="8"[^>]*class="b_ml"[^>]*>([\s\S]*?)<\/td>/);
    if (bmsM) broodmareSire = cellHorseName(bmsM[1]) || null;
  }
  return { sire: sire || null, broodmareSire };
}

/**
 * 個体ページの「募集情報」欄から一口価格(万円)を取る。
 * `<a class="OwnerUnitPrice">1口:7万円/<span>400口</span></a>` の形。無ければnull。
 */
function parsePricePerShare(html) {
  const m = html.match(/class="OwnerUnitPrice"[^>]*>\s*1口:([\d,.]+)万円\s*\/\s*<span>(\d+)口<\/span>/);
  if (!m) return null;
  return Number(m[1].replace(/,/g, ''));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const recruitsPath = join(ROOT, 'analysis', 'data', 'recruits.json');
  const recruits = JSON.parse(readFileSync(recruitsPath, 'utf8'));
  const targets = recruits
    .filter((r) => r.legacySource && r.netkeibaUrl)
    .slice(0, Number.isFinite(args.limit) ? args.limit : undefined);

  let sireFilled = 0;
  let bmsFilled = 0;
  let priceFilled = 0;

  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    process.stdout.write(`\r[${i + 1}/${targets.length}] ${r.recruitYear}年No.${r.no} ${r.name}`.padEnd(70));
    const url = normalizeToDesktopUrl(r.netkeibaUrl);
    const pedUrl = url.replace('/horse/', '/horse/ped/');

    const { html: profileHtml } = await fetchEucJp(url, { cache: args.cache });
    const price = parsePricePerShare(profileHtml);
    if (price !== null) {
      r.pricePerShare = price;
      priceFilled++;
    }

    const { html: pedHtml } = await fetchEucJp(pedUrl, { cache: args.cache });
    const { sire, broodmareSire } = parsePedigree(pedHtml);
    if (sire) {
      r.sire = sire;
      sireFilled++;
    }
    if (broodmareSire) {
      r.broodmareSire = broodmareSire;
      bmsFilled++;
    }
  }
  console.log();

  writeFileSync(recruitsPath, JSON.stringify(recruits, null, 2) + '\n');
  console.log(`書き出し: ${recruitsPath}`);
  console.log(`対象 ${targets.length}頭 のうち: 父 ${sireFilled}件 / 母父 ${bmsFilled}件 / 一口価格 ${priceFilled}件 を埋めました`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
