/**
 * `recruits.json`（818頭・2017〜2025年募集）全頭に`damAge`（母齢 = 募集年 - 母の生年）を
 * 追加するスクリプト（本人指定 / 2026-08-23「母令と結果の相関」の一次検証のため）。
 *
 * 母のID・生年は、募集馬自身の5代血統表ページ（`/horse/ped/<netkeibaId>/`）の
 * `rowspan="16" class="b_fml"`セルから直接取れる（`fetch-2026-data.mjs`の
 * `fetchDamFromPedigree`と同じ手法。血統表内に母の生年が併記されているので、
 * 既存の`damUrl`の有無やスプシの母列の有無に関係なく全頭同じ経路で取れる）。
 * これにより副産物として、2021〜2023年募集（`damUrl`が元々null）の`damUrl`も埋まる。
 *
 * 対象は`netkeibaUrl`がある頭（818頭中ほぼ全頭）。無い頭は募集馬自身が特定できておらず
 * 血統表ページも引けないためスキップ（`damAge`はnullのまま）。
 *
 * 血統表ページは2017〜2020年募集分（`enrich-legacy-pedigree-price.mjs`で父・母父取得済み）
 * は既に`.cache/netkeiba/`にキャッシュ済みなので追加リクエストなし。それ以外の年度は
 * 初回のみ新規リクエストが発生する。
 *
 * 使い方:
 *   node scripts/fetch-dam-age.mjs
 *   node scripts/fetch-dam-age.mjs --limit 10
 *   node scripts/fetch-dam-age.mjs --no-cache
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

/** 血統表ページの`b_fml`セル（母）からID・馬名・生年を取る。 */
function parseDamFromPedigree(html) {
  const m = html.match(
    /<td[^>]*rowspan="16"[^>]*class="b_fml"[^>]*>\s*<a href="https:\/\/db\.netkeiba\.com\/horse\/(\w+)\/">([\s\S]*?)<\/a>\s*<br \/>\s*(\d{4})?/,
  );
  if (!m) return null;
  return { id: m[1], name: stripTags(m[2]), birthYear: m[3] ? Number(m[3]) : null };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const recruitsPath = join(ROOT, 'analysis', 'data', 'recruits.json');
  const recruits = JSON.parse(readFileSync(recruitsPath, 'utf8'));
  const targets = recruits
    .filter((r) => r.netkeibaUrl)
    .slice(0, Number.isFinite(args.limit) ? args.limit : undefined);

  let damAgeFilled = 0;
  let damUrlFilled = 0;
  let noBirthYear = 0;
  let noPedigreeMatch = 0;
  const notes = [];

  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    process.stdout.write(`\r[${i + 1}/${targets.length}] ${r.recruitYear}年No.${r.no} ${r.name}`.padEnd(70));
    const pedUrl = normalizeToDesktopUrl(r.netkeibaUrl).replace('/horse/', '/horse/ped/');

    const { html } = await fetchEucJp(pedUrl, { cache: args.cache });
    const dam = parseDamFromPedigree(html);
    if (!dam) {
      noPedigreeMatch++;
      notes.push(`${r.recruitYear}年No.${r.no} ${r.name}: 血統表から母を特定できず`);
      continue;
    }
    if (!r.damUrl) {
      r.damUrl = `https://db.netkeiba.com/horse/${dam.id}/`;
      damUrlFilled++;
    }
    if (dam.birthYear) {
      r.damAge = r.recruitYear - dam.birthYear;
      damAgeFilled++;
    } else {
      noBirthYear++;
      notes.push(`${r.recruitYear}年No.${r.no} ${r.name}: 母「${dam.name}」の生年を血統表から取得できず`);
    }
  }
  console.log();

  writeFileSync(recruitsPath, JSON.stringify(recruits, null, 2) + '\n');
  console.log(`書き出し: ${recruitsPath}`);
  console.log(
    `対象 ${targets.length}頭 のうち: 母齢 ${damAgeFilled}件 / 母URL新規 ${damUrlFilled}件 を埋めました`,
  );
  console.log(`未取得: 血統表で母不明 ${noPedigreeMatch}件 / 母の生年不明 ${noBirthYear}件`);
  if (notes.length) {
    console.log('\n--- 個別ログ ---');
    for (const n of notes) console.log(n);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
