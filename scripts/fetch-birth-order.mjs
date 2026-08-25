/**
 * `recruits.json`（818頭）全頭に`damParity`（産次 = 母がその仔を何番目に産んだか）を
 * 追加するスクリプト（本人指定 / 2026-08-25「何番目の仔かも見てほしい」の一次検証のため）。
 *
 * 産次は母の産駒一覧ページ（`https://db.netkeiba.com/horse/mare/<damId>/`）から取る。
 * このページには母の全産駒が生年付きで列挙されている（空胎年は行自体が無い）ため、
 * 生年の昇順に並べたときの順位＝産次になる（`fetch-dam-age.mjs`の血統表アプローチと違い、
 * 個体ページではなく産駒一覧ページを使う）。
 *
 * 対象馬の生年は既存の`birthDate`フィールド（`fetch-birth-date.mjs`で取得済み・815/818頭）
 * を使う。同じ母が同じ年に2頭を産むことは実質無いため、生年の一致で対象行を特定できる。
 * `damUrl`が無い頭（818頭中3頭のみ）は`fetch-dam-age.mjs`と同じ手法
 * （本馬の血統表ページ`/horse/ped/<id>/`）で先に母を特定してから産駒一覧を引く。
 *
 * 使い方:
 *   node scripts/fetch-birth-order.mjs
 *   node scripts/fetch-birth-order.mjs --limit 10
 *   node scripts/fetch-birth-order.mjs --no-cache
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

function damIdFromUrl(damUrl) {
  const m = normalizeToDesktopUrl(damUrl).match(/\/horse\/(\w+)\/?$/);
  return m ? m[1] : null;
}

/** 血統表ページの`b_fml`セル（母）からIDを取る（damUrlが無い頭のフォールバック）。 */
function parseDamIdFromPedigree(html) {
  const m = html.match(
    /<td[^>]*rowspan="16"[^>]*class="b_fml"[^>]*>\s*<a href="https:\/\/db\.netkeiba\.com\/horse\/(\w+)\/">/,
  );
  return m ? m[1] : null;
}

/** 母の産駒一覧ページから[{year, name}]を取る（表示順は新しい年が先頭）。 */
function parseProduceList(html) {
  const rows = [
    ...html.matchAll(/<td nowrap>(\d{4})<\/td>\s*<td class="txt_l">\s*(?:<a[^>]*>)?([^<]*)/g),
  ];
  return rows.map((r) => ({ year: Number(r[1]), name: r[2].trim() || stripTags(r[2]) }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const recruitsPath = join(ROOT, 'analysis', 'data', 'recruits.json');
  const recruits = JSON.parse(readFileSync(recruitsPath, 'utf8'));
  const targets = recruits.slice(0, Number.isFinite(args.limit) ? args.limit : undefined);

  let parityFilled = 0;
  let noBirthDate = 0;
  let noDamId = 0;
  let noProduceMatch = 0;
  let fetchError = 0;
  const notes = [];

  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    process.stdout.write(`\r[${i + 1}/${targets.length}] ${r.recruitYear}年No.${r.no} ${r.name}`.padEnd(70));

    // 取得できなかった馬もキーは必ず持たせる（`damAge`と同じ約束）。キーごと欠けていると
    // 読み出し側の`x !== null`が undefined を素通しして、集計から外れずに紛れ込む。
    r.damParity ??= null;
    r.damProduceCount ??= null;
    r.damGapBeforeYears ??= null;

    const birthYear = r.birthDate ? Number(r.birthDate.slice(0, 4)) : null;
    if (!birthYear) {
      noBirthDate++;
      notes.push(`${r.recruitYear}年No.${r.no} ${r.name}: birthDate無しのためスキップ`);
      continue;
    }

    let damId = r.damUrl ? damIdFromUrl(r.damUrl) : null;
    if (!damId) {
      if (!r.netkeibaUrl) {
        noDamId++;
        notes.push(`${r.recruitYear}年No.${r.no} ${r.name}: damUrl・netkeibaUrl共に無く母を特定できず`);
        continue;
      }
      try {
        const pedUrl = normalizeToDesktopUrl(r.netkeibaUrl).replace('/horse/', '/horse/ped/');
        const { html } = await fetchEucJp(pedUrl, { cache: args.cache });
        damId = parseDamIdFromPedigree(html);
      } catch (e) {
        fetchError++;
        notes.push(`${r.recruitYear}年No.${r.no} ${r.name}: 血統表取得失敗 (${e.message})`);
        continue;
      }
      if (!damId) {
        noDamId++;
        notes.push(`${r.recruitYear}年No.${r.no} ${r.name}: 血統表から母を特定できず`);
        continue;
      }
    }

    let html;
    try {
      const produceUrl = `https://db.netkeiba.com/horse/mare/${damId}/`;
      ({ html } = await fetchEucJp(produceUrl, { cache: args.cache }));
    } catch (e) {
      fetchError++;
      notes.push(`${r.recruitYear}年No.${r.no} ${r.name}: 産駒一覧取得失敗 (${e.message})`);
      continue;
    }

    const produce = parseProduceList(html);
    const years = [...new Set(produce.map((p) => p.year))].sort((a, b) => a - b);
    const rank = years.indexOf(birthYear);
    if (rank === -1) {
      noProduceMatch++;
      notes.push(
        `${r.recruitYear}年No.${r.no} ${r.name}: 産駒一覧(${years.join(',')})に生年${birthYear}が見つからず`,
      );
      continue;
    }
    r.damParity = rank + 1;
    r.damProduceCount = years.length;
    // 直前の仔との出産間隔（年）。初仔はnull、1なら連産、2以上なら間に空胎年がある。
    // 「空胎明けの仔は走る」という俗説を検証するために持つ。
    r.damGapBeforeYears = rank === 0 ? null : birthYear - years[rank - 1];
    parityFilled++;
  }
  console.log();

  writeFileSync(recruitsPath, JSON.stringify(recruits, null, 2) + '\n');
  console.log(`書き出し: ${recruitsPath}`);
  console.log(`対象 ${targets.length}頭 のうち: damParity ${parityFilled}件 を埋めました`);
  console.log(
    `未取得: birthDate無し ${noBirthDate}件 / 母ID不明 ${noDamId}件 / 産駒一覧に不一致 ${noProduceMatch}件 / 取得エラー ${fetchError}件`,
  );
  if (notes.length) {
    console.log('\n--- 個別ログ ---');
    for (const n of notes) console.log(n);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
