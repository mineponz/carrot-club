/**
 * `analysis/data/recruits.json`（818頭・2017〜2025年募集）の母（`damUrl`が815頭にあり）について、
 * netkeibaの母個体ページ（sp版）の「生産者(産地)」欄から産地を取得し、
 * `analysis/data/dam-birthplace.json` に書き出す。同じ母は1回だけ取得する（445母）。
 *
 * ## どこから取るか
 * `db.sp.netkeiba.com/horse/<damId>/` のプロフィール表に「生産者(産地)」という行があり、
 *   <th>生産者(産地)</th><td><a href="...">ノーザンファーム</a>\n(早来町)</td>
 * のように「生産者名 + 改行 + (産地)」の形で入っている（`fetch-my-horse-races.mjs`と同じsp版
 * ページ・同じUAを使う。実測ではこのページはUTF-8で配信されており、他スクリプトのようなEUC-JP
 * デコードは不要——ただし`db.netkeiba.com`（デスクトップ版）はEUC-JPなので混同しないこと）。
 * 生産者が不明・非公開の馬は行の中身が丸ごと「-」になる（この場合は産地も取れない＝欠測であって
 * パース失敗ではない。区別してカウントする）。
 *
 * ## isForeign の判定ルール
 * 括弧内の文字列（例:「早来町」「浦河町」「アメリカ」「アイルランド」）を見て、
 *   - 日本の地名（市区町村・郡＝末尾が「市」「町」「村」「郡」、または北海道の支庁表記等）
 *     なら isForeign=false（国内生産）
 *   - 上記に当てはまらない場合（カタカナの国名等）は isForeign=true（外国産）と仮に判定するが、
 *     **機械的な地名末尾判定だけでは誤判定しうる**ため、値の一覧を目視して手直しする前提。
 *     このスクリプトは`birthplaceRaw`（生文字列）を必ず残すので、判定ミスがあれば
 *     `isForeign`の算出ロジック（`classifyBirthplace`）側で個別に直せる。
 *   - 欄が「-」（生産者非公開等） → isForeign=null, birthplaceRaw=null, かつ`fieldMissing=true`
 *   - 「生産者(産地)」の行自体が見つからない（ページ構造が違う・パース失敗） → isForeign=null,
 *     birthplaceRaw=null, `fieldMissing=false`（＝パース失敗として別カウント）
 *
 * 使い方:
 *   node scripts/fetch-dam-birthplace.mjs
 *   node scripts/fetch-dam-birthplace.mjs --limit 10
 *   node scripts/fetch-dam-birthplace.mjs --no-cache
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'netkeiba-sp');
const RECRUITS_PATH = join(ROOT, 'analysis', 'data', 'recruits.json');
const OUT_PATH = join(ROOT, 'analysis', 'data', 'dam-birthplace.json');
const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
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

async function fetchPage(url, { cache = true } = {}) {
  const cachePath = join(CACHE_DIR, `${createHash('sha1').update(url).digest('hex')}.html`);
  if (cache && existsSync(cachePath)) return { html: readFileSync(cachePath, 'utf-8'), fromCache: true };
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await throttle();
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      // 実測で1件、HTTP 200のままnetkeibaのトップページ（一時的なソフトエラー）が返り、
      // それがそのままキャッシュされて「産地欄が見つからない」誤判定になったことがある。
      // 個体ページのtitleを持たないレスポンスはキャッシュせずリトライする。
      if (html.includes('netkeiba.com ｜ 国内最大級の競馬情報サイト')) {
        throw new Error('個体ページでなくトップページが返された（一時的なソフトエラーの疑い）');
      }
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
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

function normalizeToSpUrl(url) {
  return url.replace('db.netkeiba.com', 'db.sp.netkeiba.com');
}

/**
 * 「生産者(産地)」行のtd中身を返す。行自体が見つからなければnull（=パース失敗）。
 * 中身が「-」（生産者非公開等）ならフラグを立てて返す。
 */
function extractBreederField(html) {
  const m = html.match(/生産者\(産地\)\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/);
  if (!m) return null;
  const text = stripTags(m[1]);
  if (text === '' || text === '-') return { fieldMissing: true, raw: null };
  return { fieldMissing: false, raw: text };
}

/** stripTags済みの「ノーザンファーム (早来町)」のような文字列から括弧内の産地を取り出す。 */
function extractPlace(text) {
  const m = text.match(/\(([^()]+)\)\s*$/);
  return m ? m[1].trim() : null;
}

/** 日本の地名（市区町村・郡・北海道の総合振興局/振興局）か、国名等かを機械判定する。 */
function classifyBirthplace(place) {
  if (!place) return null;
  if (/(市|区|町|村|郡|振興局|支庁)$/.test(place)) return false; // 国内
  return true; // それ以外はカタカナ国名等とみなし外国産
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const recruits = JSON.parse(readFileSync(RECRUITS_PATH, 'utf-8'));

  // 母URLごとに対象の募集馬数を数える（母単位/募集馬単位の両方の集計に使う）。
  const damEntries = new Map(); // damUrl(sp正規化) -> { damUrl, damName, recruitCount }
  for (const r of recruits) {
    if (!r.damUrl) continue;
    const url = normalizeToSpUrl(r.damUrl);
    // `damName`列は2017〜2020年募集、`dam`列は2021〜2025年募集にしかない
    // （年度でスプレッドシートの列名が違う。[[20260830-horses2025-has-no-dam-url]]と同種の落とし穴）。
    // どちらも無い頭は、募集馬名が「母名の生年下2桁」という命名規則になっているため
    // `name`から逆算する（例:「ナスケンアイリスの20」→「ナスケンアイリス」）。
    const damName = r.damName ?? r.dam ?? r.name?.match(/^(.+)の\d{1,4}$/)?.[1] ?? null;
    // 同じ母を指す複数の募集馬のうち、片方だけ名前が取れないことがあるため、
    // 既に非nullの名前が入っていれば上書きしない（最初に見つかった非null値を採用）。
    if (!damEntries.has(url)) damEntries.set(url, { damUrl: url, damName, recruitCount: 0 });
    else if (!damEntries.get(url).damName && damName) damEntries.get(url).damName = damName;
    damEntries.get(url).recruitCount += 1;
  }

  const dams = [...damEntries.values()].slice(0, Number.isFinite(args.limit) ? args.limit : undefined);
  const results = [];
  let ok = 0;
  let fieldMissingCount = 0;
  let parseFailCount = 0;

  for (let i = 0; i < dams.length; i++) {
    const d = dams[i];
    process.stdout.write(`\r[${i + 1}/${dams.length}] ${d.damName}`.padEnd(60));
    const { html } = await fetchPage(d.damUrl, { cache: args.cache });
    const field = extractBreederField(html);
    if (field === null) {
      parseFailCount++;
      results.push({ ...d, birthplaceRaw: null, isForeign: null, status: 'parse-fail' });
      continue;
    }
    if (field.fieldMissing) {
      fieldMissingCount++;
      results.push({ ...d, birthplaceRaw: null, isForeign: null, status: 'field-missing' });
      continue;
    }
    const place = extractPlace(field.raw);
    if (!place) {
      // 括弧が見つからない=想定外の書式。生文字列だけ残してnull扱い。
      parseFailCount++;
      results.push({ ...d, birthplaceRaw: field.raw, isForeign: null, status: 'no-parens' });
      continue;
    }
    ok++;
    results.push({ ...d, birthplaceRaw: place, isForeign: classifyBirthplace(place), status: 'ok' });
  }
  console.log();

  writeFileSync(OUT_PATH, JSON.stringify(results, null, 2) + '\n');
  console.log(`書き出し: ${OUT_PATH}`);
  console.log(`母 ${dams.length}頭のうち: 取得成功 ${ok} / 欄なし(-) ${fieldMissingCount} / パース失敗 ${parseFailCount}`);

  const foreign = results.filter((r) => r.isForeign === true).length;
  const domestic = results.filter((r) => r.isForeign === false).length;
  const unknown = results.filter((r) => r.isForeign === null).length;
  console.log(`母単位 isForeign: true=${foreign} / false=${domestic} / null=${unknown}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
