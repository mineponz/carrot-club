/**
 * `analysis/data/recruits.json`（818頭・2017〜2025年募集）全頭に`birthDate`（生年月日）を
 * 追加するスクリプト（本人指定 / 2026-08-24「誕生日が遅くて小さい馬は買いか」の検証のため）。
 *
 * 誕生日は募集馬自身の個体ページ（`db.netkeiba.com/horse/<id>/`）のプロフィール表
 * `生年月日`欄から取れる（`fetch-2026-data.mjs`の`fetchHorseProfile`と同じ抽出パターン）。
 * このページは`fetch-race-results.mjs`が成績取得のため既に全815頭ぶん`.cache/netkeiba/`に
 * キャッシュ済みなので、通常はキャッシュヒットのみで新規リクエストはほぼ発生しない。
 *
 * 使い方:
 *   node scripts/fetch-birth-date.mjs
 *   node scripts/fetch-birth-date.mjs --limit 10
 *   node scripts/fetch-birth-date.mjs --no-cache
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

/** 個体ページのプロフィール表から `<th>ラベル</th><td>値</td>` を引く。 */
function profileField(html, label) {
  const re = new RegExp(`<th>${label}</th>\\s*<td>([\\s\\S]*?)</td>`);
  return html.match(re)?.[1] ?? null;
}

function parseBirthDate(html) {
  const raw = stripTags(profileField(html, '生年月日') ?? '');
  const m = raw.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const recruitsPath = join(ROOT, 'analysis', 'data', 'recruits.json');
  const recruits = JSON.parse(readFileSync(recruitsPath, 'utf8'));
  // netkeibaUrlが無い馬も対象に含め、明示的に birthDate: null を書く
  // （キー自体が無いままだと、記事側の `h.birthDate !== null` フィルタを undefined がすり抜ける）。
  const targets = recruits.slice(0, Number.isFinite(args.limit) ? args.limit : undefined);

  let filled = 0;
  let noMatch = 0;
  let noUrl = 0;
  let cacheHits = 0;
  const notes = [];

  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    process.stdout.write(`\r[${i + 1}/${targets.length}] ${r.recruitYear}年No.${r.no} ${r.name}`.padEnd(70));
    if (!r.netkeibaUrl) {
      r.birthDate = null;
      noUrl++;
      continue;
    }
    const url = normalizeToDesktopUrl(r.netkeibaUrl);
    const { html, fromCache } = await fetchEucJp(url, { cache: args.cache });
    if (fromCache) cacheHits++;
    const birthDate = parseBirthDate(html);
    r.birthDate = birthDate; // 取れなければ parseBirthDate が返す null をそのまま入れる
    if (birthDate) {
      filled++;
    } else {
      noMatch++;
      notes.push(`${r.recruitYear}年No.${r.no} ${r.name}: 生年月日を取得できず`);
    }
  }
  console.log();

  writeFileSync(recruitsPath, JSON.stringify(recruits, null, 2) + '\n');
  console.log(`書き出し: ${recruitsPath}`);
  console.log(`対象 ${targets.length}頭 のうち: 生年月日 ${filled}件 を埋めました（キャッシュヒット ${cacheHits}件）`);
  console.log(`未取得: ${noMatch}件（netkeibaUrl無し ${noUrl}件を含まない。そちらは別カウント）`);
  if (notes.length) {
    console.log('\n--- 個別ログ ---');
    for (const n of notes) console.log(n);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
