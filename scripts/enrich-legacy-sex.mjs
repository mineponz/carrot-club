/**
 * 2017〜2020年募集分（`recruits.json`の`legacySource: true`）の性別を埋めるスクリプト。
 *
 * クラブ公式の測尺一覧ページには性別の列が無く、この4年分348頭は`sex`がnullのままだった。
 * 分析記事の散布図は点を性別で塗り分けているため、null をそのまま牡として扱うと牡の点が
 * 実際より348頭ぶん多く見える（2026-08-23の指摘で発覚。記事側は「性別不明」の灰色として
 * 別系列に出すよう直してあり、このスクリプトで埋まれば灰色の点は自然に消える）。
 *
 * 取得元は netkeiba の個体ページの見出し（`<p class="txt_01">牝5 鹿毛 …</p>`）。この個体ページは
 * `fetch-race-results.mjs` / `enrich-legacy-pedigree-price.mjs` が既に `.cache/netkeiba/` に
 * 落としているので、**キャッシュがある端末では追加リクエストが1件も出ない**（キャッシュが
 * 無い馬だけ、他のスクリプトと同じ間隔で取りに行く）。
 *
 * 去勢馬について: netkeibaが出すのは**今の**性別なので、募集後に去勢された馬は「セン」と
 * 書かれている。募集時点では牡なので `牡` として書き込む（何頭がそれだったかは最後に出す）。
 *
 * 使い方:
 *   node scripts/enrich-legacy-sex.mjs --dry-run   # 書き込まずに何頭埋まるか見る
 *   node scripts/enrich-legacy-sex.mjs
 *   node scripts/enrich-legacy-sex.mjs --limit 5
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
  const args = { limit: Infinity, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--dry-run') args.dryRun = true;
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

async function fetchEucJp(url) {
  const cachePath = join(CACHE_DIR, `${createHash('sha1').update(url).digest('hex')}.html`);
  if (existsSync(cachePath)) return { html: readFileSync(cachePath, 'utf8'), fromCache: true };
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await throttle();
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = new TextDecoder('euc-jp').decode(await res.arrayBuffer());
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(cachePath, html);
      return { html, fromCache: false };
    } catch (e) {
      lastError = e;
      console.warn(`  [warn] 取得失敗 (${attempt}/3) ${url}: ${e.message}`);
      await sleep(1500 * attempt);
    }
  }
  throw lastError;
}

function normalizeToDesktopUrl(url) {
  return url.replace('db.sp.netkeiba.com', 'db.netkeiba.com');
}

const COAT_COLORS = '鹿毛|黒鹿毛|青鹿毛|青毛|栗毛|栃栗毛|芦毛|白毛';

/**
 * 個体ページの見出しから性別（牡/牝/セン）を取る。
 * 1. `<p class="txt_01">牝5 鹿毛 2015年3月10日生</p>` の先頭。引退馬は馬齢が無く「牝 鹿毛」の形。
 * 2. 1で取れないとき用に、ページ全体から「性別＋（馬齢）＋毛色」の並びを探す。
 *    毛色とセットで見るのは、本文中の「牡馬」「牝系」といった語を拾わないため。
 */
function parseSex(html) {
  const titleM = html.match(/class="txt_01"[^>]*>([\s\S]{0,80}?)<\/p>/);
  if (titleM) {
    const text = titleM[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    const m = text.match(/^(セン|牡|牝)/);
    if (m) return m[1];
  }
  const anyM = html.match(new RegExp(`(セン|牡|牝)\\s*\\d*\\s*(?:歳)?\\s*(?:${COAT_COLORS})`));
  return anyM ? anyM[1] : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const recruitsPath = join(ROOT, 'analysis', 'data', 'recruits.json');
  const recruits = JSON.parse(readFileSync(recruitsPath, 'utf8'));
  const targets = recruits
    .filter((r) => r.legacySource && r.sex === null && r.netkeibaUrl)
    .slice(0, Number.isFinite(args.limit) ? args.limit : undefined);
  const noUrl = recruits.filter((r) => r.legacySource && r.sex === null && !r.netkeibaUrl).length;

  let filled = 0;
  let gelded = 0;
  let fetched = 0;
  const unmatched = [];

  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    process.stdout.write(`\r[${i + 1}/${targets.length}] ${r.recruitYear}年No.${r.no} ${r.name}`.padEnd(70));
    const { html, fromCache } = await fetchEucJp(normalizeToDesktopUrl(r.netkeibaUrl));
    if (!fromCache) fetched++;
    const sex = parseSex(html);
    if (!sex) {
      unmatched.push(`${r.recruitYear}年No.${r.no} ${r.name}`);
      continue;
    }
    // 募集時点の性別で持つ（去勢は募集後なので「セン」は牡に寄せる）
    r.sex = sex === 'セン' ? '牡' : sex;
    if (sex === 'セン') gelded++;
    filled++;
  }
  console.log();

  if (!args.dryRun) {
    writeFileSync(recruitsPath, JSON.stringify(recruits, null, 2) + '\n');
    console.log(`書き出し: ${recruitsPath}`);
  } else {
    console.log('--dry-run のため書き出していません');
  }
  console.log(
    `対象 ${targets.length}頭 のうち ${filled}頭 の性別を埋めました（うち現在セン馬 ${gelded}頭 は牡として記録）`
  );
  console.log(`netkeibaへの新規リクエスト: ${fetched}件（残りはキャッシュ）`);
  if (noUrl > 0) console.log(`netkeiba個体ページが不明で対象外: ${noUrl}頭`);
  if (unmatched.length > 0) {
    console.log(`見出しから性別を読めなかった ${unmatched.length}頭:`);
    for (const label of unmatched) console.log(`  - ${label}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
