/**
 * `recruits.json` の各馬に、netkeiba個体ページの「調教師」欄から
 *   - `finalTrainer`      … 現(最終)調教師名。欄が空なら null
 *   - `finalTrainerId`    … netkeibaの調教師ID。欄が空なら null
 *   - `trainerAffiliation`… 調教師名の後ろの括弧内をそのまま（"美浦" / "栗東" / "大井" / "地方" 等）。無ければ null
 *   - `region`            … "東"(美浦) / "西"(栗東) / "地方"(上記以外の所属) / "不明"(欄が空)
 * を書き足すスクリプト。9本目の分析記事「東西＋調教師」用（vault:
 * 1-projects/carrot-club/tasks/20260902-trainer-region-article-scan.md）。
 *
 * netkeiba個体ページ（`db.netkeiba.com/horse/<id>/`）のプロフィールテーブルは
 *   <th>調教師</th><td><a href="/trainer/01053/" title="角居勝彦">角居勝彦</a> (栗東)</td>
 * の形。引退・厩舎解散後もこの欄は最後に在籍した厩舎＋所属を保持する（2026-09-02、
 * 角居勝彦=2021引退 / サートゥルナーリアで "(栗東)" が残ることを確認）。
 *
 * 個体ページは `fetch-race-results.mjs` / `enrich-share-count.mjs` が既にキャッシュ済み
 * （`.cache/netkeiba/`）。既存キャッシュ815頭ぶんで新規リクエストは発生しない見込み。
 * キャッシュに無い分だけ再取得する（礼儀は既存スクリプトと同じ 700〜1100ms ウェイト）。
 *
 * 使い方:
 *   node scripts/enrich-trainer-region.mjs
 *   node scripts/enrich-trainer-region.mjs --limit 5
 *   node scripts/enrich-trainer-region.mjs --no-refetch
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

const idOf = (u) => (u.match(/horse\/([0-9a-z]+)/) || [])[1] || null;

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

/** 個体ページHTMLから { name, id, affiliation } を取る。欄自体が無ければ null。 */
function parseTrainer(html) {
  const m = html && html.match(/<th>調教師<\/th>\s*<td>(.*?)<\/td>/s);
  if (!m) return null;
  const cell = m[1];
  const nameM = cell.match(/\/trainer\/\w+\/"\s+title="([^"]+)"/);
  const idM = cell.match(/\/trainer\/(\w+)\//);
  const parM = cell.match(/\(([^)]*)\)\s*$/);
  return {
    name: nameM ? nameM[1] : null,
    id: idM ? idM[1] : null,
    affiliation: parM ? parM[1].trim() : null,
  };
}

function regionOf(affiliation) {
  if (affiliation === '美浦') return '東';
  if (affiliation === '栗東') return '西';
  if (affiliation) return '地方'; // NAR地区名 / "地方" / "北海道" 等
  return '不明';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const recruitsPath = join(ROOT, 'analysis', 'data', 'recruits.json');
  const recruits = JSON.parse(readFileSync(recruitsPath, 'utf8'));
  const targets = recruits.slice(0, Number.isFinite(args.limit) ? args.limit : undefined);

  let fromCache = 0;
  let refetched = 0;
  let noUrl = 0;
  let noTrainerRow = 0;
  const regionDist = {};
  const affDist = {};

  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    process.stdout.write(
      `\r[${i + 1}/${targets.length}] ${r.recruitYear}年No.${r.no} ${r.name}`.padEnd(72)
    );

    if (!r.netkeibaUrl) {
      noUrl++;
      r.finalTrainer = null;
      r.finalTrainerId = null;
      r.trainerAffiliation = null;
      r.region = '不明';
      continue;
    }

    let html = null;
    for (const u of candidateUrls(r.netkeibaUrl)) {
      html = readCache(u);
      if (html) break;
    }
    if (html) {
      fromCache++;
    } else if (args.refetch) {
      html = await fetchEucJp(`https://db.netkeiba.com/horse/${idOf(r.netkeibaUrl)}/`);
      refetched++;
    }

    const t = html ? parseTrainer(html) : null;
    if (!t) noTrainerRow++;
    r.finalTrainer = t ? t.name : null;
    r.finalTrainerId = t ? t.id : null;
    r.trainerAffiliation = t ? t.affiliation : null;
    r.region = regionOf(t ? t.affiliation : null);

    regionDist[r.region] = (regionDist[r.region] || 0) + 1;
    const ak = r.trainerAffiliation || '(欄なし/空)';
    affDist[ak] = (affDist[ak] || 0) + 1;
  }
  console.log();

  // 全頭にキーを持たせる（--limit時の取りこぼし防止）
  for (const r of recruits) {
    if (!('region' in r)) {
      r.finalTrainer = r.finalTrainer ?? null;
      r.finalTrainerId = r.finalTrainerId ?? null;
      r.trainerAffiliation = r.trainerAffiliation ?? null;
      r.region = r.region ?? '不明';
    }
  }

  writeFileSync(recruitsPath, JSON.stringify(recruits, null, 2) + '\n');

  console.log(`書き出し: ${recruitsPath}`);
  console.log(
    `対象 ${targets.length}頭 / キャッシュから ${fromCache} / 再取得 ${refetched} / netkeibaUrl無し ${noUrl} / 調教師欄なし ${noTrainerRow}`
  );
  console.log(`region 分布: ${JSON.stringify(regionDist)}`);
  console.log(`所属(生値) 分布: ${JSON.stringify(affDist)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
