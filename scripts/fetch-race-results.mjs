/**
 * `analysis/data/recruits.json`（2017〜2025年募集の全頭の募集時データ）の各馬について、
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
  // "1,930万円" → 1930 / "0万円" → 0 / "6億5,897万円" → 65897 / "-" → null
  // 1億円以上は netkeiba が「X億Y,YYY万円」表記に切り替える（当初 "([\d,]+)万円" 単体の
  // 正規表現だとこの形式にマッチせず、ダービー馬級の高額賞金馬が軒並みnull扱いになるバグが
  // あった。2026-08-22、本人から「タスティエーラ(6億稼いでいるはず)が反映されていない」との
  // 指摘で発覚）。
  const trimmed = raw.trim();
  if (trimmed === '-' || trimmed === '') return null;
  const m = trimmed.match(/^(?:(\d+)億)?([\d,]*)万円$/);
  if (!m) return null;
  const oku = m[1] ? Number(m[1]) : 0;
  const man = m[2] ? Number(m[2].replace(/,/g, '')) : 0;
  return oku * 10000 + man;
}

/** 主な勝鞍セルには表示分に加えてHTMLコメントで隠れた追加の勝鞍が入ることがある
 *  （例: タスティエーラは日本ダービー(G1)が表示・クイーンエリザベス2世C(G1)がコメント内）。
 *  コメントの内外を問わず <a href="/race/...">のtitleを全部拾う。 */
function extractMainWins(cellHtml) {
  const wins = [];
  const re = /<a href="\/race\/[^"]*"\s+title="([^"]+)"/g;
  let m;
  while ((m = re.exec(cellHtml))) {
    wins.push(m[1]);
  }
  return wins;
}

const GRADE_RE = /\((G1|G2|G3|Jpn1|Jpn2|Jpn3)\)/;

/**
 * netkeibaの「主な勝鞍」欄は地方（NAR）限定の重賞だと格付け表記「(Jpn2)」等が付かないことがある
 * （例: 京浜盃はJpn2格だがnetkeibaの表示は「京浜盃」のみで括弧書きが無い）。本人が地方重賞と
 * 確認したレース名はここに追記する（2026-08-22・ロックターミガンの京浜盃で発覚）。
 */
const KNOWN_UNGRADED_NAR_STAKES = new Set(['京浜盃']);

function parseHorsePage(html, url) {
  const chuoM = html.match(/獲得賞金\s*\(中央\)<\/th>\s*<td>\s*([^<]+?)\s*<\/td>/);
  const chihoM = html.match(/獲得賞金\s*\(地方\)<\/th>\s*<td>\s*([^<]+?)\s*<\/td>/);
  // 通算成績の[ ]内は [1着-2着-3着-着外] の順（1着は勝ち数と同じ値になるはずの検算用）。
  const recordM = html.match(
    /通算成績<\/th>\s*<td>(\d+)戦(\d+)勝\s*\[<a[^>]*>(\d+)-(\d+)-(\d+)-(\d+)<\/a>\]/
  );
  const nameM = html.match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/);
  const mainWinM = html.match(/主な勝鞍<\/th>\s*<td>([\s\S]*?)<\/td>/);
  const mainWins = mainWinM ? extractMainWins(mainWinM[1]) : [];
  const gradeWins = mainWins.filter((w) => GRADE_RE.test(w) || KNOWN_UNGRADED_NAR_STAKES.has(w));

  if (!chuoM && !chihoM && !recordM) {
    return { ok: false, url };
  }

  return {
    ok: true,
    url,
    name: nameM ? nameM[1] : null,
    chuoPrizeManYen: chuoM ? toYen10k(chuoM[1]) : null,
    chihoPrizeManYen: chihoM ? toYen10k(chihoM[1]) : null,
    starts: recordM ? Number(recordM[1]) : null,
    wins: recordM ? Number(recordM[2]) : null,
    seconds: recordM ? Number(recordM[4]) : null,
    thirds: recordM ? Number(recordM[5]) : null,
    others: recordM ? Number(recordM[6]) : null,
    mainWins,
    gradeWins,
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

  let noUrlCount = 0;
  for (let i = 0; i < targets.length; i++) {
    const horse = targets[i];
    if (!horse.netkeibaUrl) {
      // 2017〜2020年募集ぶん（legacySource）はnetkeiba個体ページを自動特定できなかった馬が
      // 少数いる（母馬名検索が空振り等）。成績を取りようがないのでスキップする。
      noUrlCount++;
      continue;
    }
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
  const gradeWinners = results.filter((r) => r.gradeWins.length > 0).length;
  const overOku = results.filter((r) => (r.chuoPrizeManYen ?? 0) >= 10000).length;
  console.log(`\n合計 ${results.length}/${targets.length}頭 を ${outPath} に書き出しました`);
  console.log(`  パース失敗: ${failCount}件 / netkeibaUrl無しでスキップ: ${noUrlCount}件 / キャッシュヒット: ${cacheHits}件`);
  console.log(`  出走済み: ${raced}頭 / 未出走(0戦): ${unraced}頭`);
  console.log(`  重賞(G1〜G3/Jpn1〜3)勝ち馬: ${gradeWinners}頭 / 中央獲得賞金1億円以上: ${overOku}頭`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
