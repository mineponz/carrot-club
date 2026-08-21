/**
 * `analysis/data/recruits.json`（過去5年470頭の募集時データ）の各馬について、
 * netkeiba個体ページから現在の中央/地方獲得賞金・通算成績を取得し、
 * `analysis/data/race-results.json` に書き出すスクリプト。
 *
 * 使い方:
 *   node scripts/fetch-race-results.mjs
 *   node scripts/fetch-race-results.mjs --limit 5      # 動作確認用
 *   node scripts/fetch-race-results.mjs --no-cache
 *
 * recruits.json とは別ファイルに出力する（netkeibaUrlで結合する設計）。成績は今後も
 * 変わり続けるデータなので、募集時データ（不変）と分けて再取得しやすくするため。
 *
 * netkeibaへのアクセスは`scripts/fetch-2026-data.mjs`と同じ礼儀（1リクエストごとに
 * 700〜1100msのウェイト、`.cache/netkeiba/`にキャッシュして再実行時に叩き直さない）。
 *
 * netkeiba個体ページのプロフィールテーブルは未出走でも「0万円」「0戦0勝 [0-0-0-0]」の形で
 * 固定フォーマットで存在するため、正規表現で安定して拾える（2026-08-21に実ページで確認済み）。
 * URLホストが `db.sp.netkeiba.com` のものは `db.netkeiba.com` に正規化してから取得する
 * （どちらも同じ内容だが、デスクトップ版の方でパース済み）。
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

// ---------------------------------------------------------------- HTTP（fetch-2026-data.mjsと同じ方式）

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

function normalizeToDesktopUrl(url) {
  return url.replace('db.sp.netkeiba.com', 'db.netkeiba.com');
}

function toYen10k(raw) {
  // "1,930万円" → 1930 / "0万円" → 0 / "-" → null
  const trimmed = raw.trim();
  if (trimmed === '-' || trimmed === '') return null;
  const m = trimmed.match(/^([\d,]+)万円$/);
  if (!m) return null;
  return Number(m[1].replace(/,/g, ''));
}

function parseHorsePage(html, url) {
  const chuoM = html.match(/獲得賞金\s*\(中央\)<\/th>\s*<td>\s*([^<]+?)\s*<\/td>/);
  const chihoM = html.match(/獲得賞金\s*\(地方\)<\/th>\s*<td>\s*([^<]+?)\s*<\/td>/);
  const recordM = html.match(
    /通算成績<\/th>\s*<td>(\d+)戦(\d+)勝\s*\[<a[^>]*>(\d+)-(\d+)-(\d+)-(\d+)<\/a>\]/
  );

  if (!chuoM && !chihoM && !recordM) {
    return { ok: false, url };
  }

  return {
    ok: true,
    url,
    chuoPrizeManYen: chuoM ? toYen10k(chuoM[1]) : null,
    chihoPrizeManYen: chihoM ? toYen10k(chihoM[1]) : null,
    starts: recordM ? Number(recordM[1]) : null,
    wins: recordM ? Number(recordM[2]) : null,
    seconds: recordM ? Number(recordM[3]) : null,
    thirds: recordM ? Number(recordM[4]) : null,
    others: recordM ? Number(recordM[5]) : null,
  };
}

// ---------------------------------------------------------------- メイン処理

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
  const cache = !args.includes('--no-cache');

  const recruitsPath = join(ROOT, 'analysis', 'data', 'recruits.json');
  const recruits = JSON.parse(readFileSync(recruitsPath, 'utf8'));
  const targets = recruits.slice(0, Number.isFinite(limit) ? limit : recruits.length);

  const results = [];
  let failCount = 0;
  let cacheHits = 0;

  for (let i = 0; i < targets.length; i++) {
    const horse = targets[i];
    const url = normalizeToDesktopUrl(horse.netkeibaUrl);
    process.stdout.write(`\r[${i + 1}/${targets.length}] ${horse.recruitYear}年No.${horse.no} ${horse.name}`.padEnd(80));

    const { html, fromCache } = await fetchEucJp(url, { cache });
    if (fromCache) cacheHits++;
    const parsed = parseHorsePage(html, url);
    if (!parsed.ok) {
      failCount++;
      console.warn(`\n  [warn] パース失敗: ${horse.name} ${url}`);
      continue;
    }
    results.push({
      netkeibaUrl: horse.netkeibaUrl,
      recruitYear: horse.recruitYear,
      no: horse.no,
      ...parsed,
    });
  }
  console.log();

  const outDir = join(ROOT, 'analysis', 'data');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'race-results.json');
  writeFileSync(
    outPath,
    JSON.stringify(
      { fetchedAt: new Date().toISOString(), results },
      null,
      2
    ) + '\n'
  );

  const unraced = results.filter((r) => r.starts === 0).length;
  const raced = results.filter((r) => r.starts > 0).length;
  console.log(`\n合計 ${results.length}/${targets.length}頭 を ${outPath} に書き出しました`);
  console.log(`  パース失敗: ${failCount}件 / キャッシュヒット: ${cacheHits}件`);
  console.log(`  出走済み: ${raced}頭 / 未出走(0戦): ${unraced}頭`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
