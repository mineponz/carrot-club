/**
 * サイト表示用データ（`src/data/horses2025.ts` / `horses2026.ts`）に `damParity`（産次 =
 * 母がその仔を何番目に産んだか。1=初仔）を追記するスクリプト（本人指定 / 2026-08-25
 * 「産次も一覧表に出してほしい」）。
 *
 * `scripts/fetch-birth-order.mjs`（`analysis/data/recruits.json` 用）とは**別ファイル**。
 * あちらは触らない（記事側で使用中のため）。
 *
 * 2025年募集（93頭）: netkeibaは叩かない。`analysis/data/recruits.json` の
 * `recruitYear === 2025` の93頭が `horses2025.ts` の93件と `id`↔`no` で1対1対応し、
 * 馬名も完全一致することを確認済み（本人確認）なので、そこから `damParity` をコピーする。
 * コピー時に馬名の一致を再検証し、1件でも不一致・対応漏れがあれば中断してエラーを出す
 * （黙ってズレたデータをコピーしない）。
 *
 * 2026年募集（93頭）: `recruits.json` に含まれていないので netkeiba から取得する。
 * 産次の取り方は `fetch-birth-order.mjs` と同じ（母の産駒一覧ページ
 * `https://db.netkeiba.com/horse/mare/<damId>/` の生年昇順の順位）。`horses2026.ts` の
 * `damUrl`（母のnetkeibaページ）と `birthDate` を使う（どちらも93/93埋まっている前提）。
 *
 * 使い方:
 *   node scripts/fetch-site-birth-order.mjs
 *   node scripts/fetch-site-birth-order.mjs --2025-only
 *   node scripts/fetch-site-birth-order.mjs --2026-only
 *   node scripts/fetch-site-birth-order.mjs --no-cache
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
  const args = { cache: true, do2025: true, do2026: true };
  for (const a of argv) {
    if (a === '--no-cache') args.cache = false;
    else if (a === '--2025-only') args.do2026 = false;
    else if (a === '--2026-only') args.do2025 = false;
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

function normalizeToDesktopUrl(url) {
  return url.replace('db.sp.netkeiba.com', 'db.netkeiba.com');
}

function damIdFromUrl(damUrl) {
  const m = normalizeToDesktopUrl(damUrl).match(/\/horse\/(\w+)\/?$/);
  return m ? m[1] : null;
}

/** 母の産駒一覧ページから[{year, name}]を取る（表示順は新しい年が先頭）。`fetch-birth-order.mjs` と同じ。 */
function parseProduceList(html) {
  const rows = [
    ...html.matchAll(/<td nowrap>(\d{4})<\/td>\s*<td class="txt_l">\s*(?:<a[^>]*>)?([^<]*)/g),
  ];
  return rows.map((r) => ({ year: Number(r[1]), name: r[2].trim() }));
}

/**
 * 対象の Horse オブジェクトを damAge の直後に damParity が入るよう再構築する。
 * 元の key の並び順は保つ（JSON.stringify の出力見た目を元ファイルに近づけるため）。
 */
function withDamParityAfterDamAge(horse, damParity) {
  const out = {};
  for (const [key, value] of Object.entries(horse)) {
    out[key] = value;
    if (key === 'damAge') out.damParity = damParity;
  }
  if (!('damParity' in out)) out.damParity = damParity; // damAgeが無い場合のフォールバック（通常は無い）
  return out;
}

function writeHorsesTs(outPath, exportName, headerComment, horses) {
  const body = `${headerComment}
import type { Horse } from '../lib/horses.ts';

export const ${exportName}: Horse[] = ${JSON.stringify(horses, null, 2)};
`;
  writeFileSync(outPath, body);
}

// ---------------------------------------------------------------- 2025年募集

async function enrich2025() {
  console.log('=== 2025年募集（recruits.jsonからコピー） ===');
  const horsesPath = join(ROOT, 'src', 'data', 'horses2025.ts');
  const { horses2025 } = await import(`${horsesPath}?t=${Date.now()}`);
  const recruitsPath = join(ROOT, 'analysis', 'data', 'recruits.json');
  const recruits = JSON.parse(readFileSync(recruitsPath, 'utf8'));
  const recruits2025 = recruits.filter((r) => r.recruitYear === 2025);

  const byNo = new Map(recruits2025.map((r) => [r.no, r]));

  const mismatches = [];
  const enriched = horses2025.map((h) => {
    const match = byNo.get(h.id);
    if (!match) {
      mismatches.push(`No.${h.id} ${h.name}: recruits.json(2025年募集)に対応する no が見つからない`);
      return null;
    }
    if (match.name !== h.name) {
      mismatches.push(
        `No.${h.id}: 馬名不一致 horses2025.ts「${h.name}」 vs recruits.json「${match.name}」`,
      );
      return null;
    }
    if (match.damParity == null) {
      mismatches.push(`No.${h.id} ${h.name}: recruits.json側にdamParityが無い`);
      return null;
    }
    return withDamParityAfterDamAge(h, match.damParity);
  });

  if (mismatches.length > 0) {
    console.error(`\n[エラー] 2025年募集の突き合わせで${mismatches.length}件の不一致を検出、中断する:`);
    for (const m of mismatches) console.error(`  - ${m}`);
    throw new Error('2025年募集: id↔no・馬名の突き合わせに失敗');
  }

  console.log(`検証OK: ${enriched.length}/${horses2025.length}頭で id↔no・馬名が一致し damParity をコピー`);

  const headerComment = `/**
 * 2025年募集馬の客観データ（${enriched.length}頭）。
 *
 * このファイルは \`scripts/convert-csv.mjs\` が生成する。手で編集しない。
 * 元CSVは個人の評価・メモ列を含むためリポジトリにはコミットしていない。
 * 再生成: node scripts/convert-csv.mjs "<募集馬確定リストのCSV>"
 *
 * damParity（産次）は \`scripts/fetch-site-birth-order.mjs\` が
 * \`analysis/data/recruits.json\` から後から追記する値（damAge等と同じ後付け方式）。
 * convert-csv.mjs を再実行して damParity が消えた場合は fetch-site-birth-order.mjs も
 * 再実行すること。
 */`;
  writeHorsesTs(horsesPath, 'horses2025', headerComment, enriched);
  console.log(`書き出し: ${horsesPath}`);
  return { filled: enriched.length, total: horses2025.length };
}

// ---------------------------------------------------------------- 2026年募集

async function enrich2026(args) {
  console.log('\n=== 2026年募集（netkeibaから取得） ===');
  const horsesPath = join(ROOT, 'src', 'data', 'horses2026.ts');
  const { horses2026 } = await import(`${horsesPath}?t=${Date.now()}`);

  let filled = 0;
  const failures = [];
  const enriched = [];

  for (let i = 0; i < horses2026.length; i++) {
    const h = horses2026[i];
    process.stdout.write(`\r[${i + 1}/${horses2026.length}] No.${h.id} ${h.name}`.padEnd(60));

    if (!h.damUrl) {
      failures.push(`No.${h.id} ${h.name}: damUrlが空`);
      enriched.push(h);
      continue;
    }
    if (!h.birthDate) {
      failures.push(`No.${h.id} ${h.name}: birthDateが空`);
      enriched.push(h);
      continue;
    }
    const damId = damIdFromUrl(h.damUrl);
    if (!damId) {
      failures.push(`No.${h.id} ${h.name}: damUrl「${h.damUrl}」からIDを抽出できず`);
      enriched.push(h);
      continue;
    }
    const birthYear = Number(h.birthDate.slice(0, 4));

    let html;
    try {
      const produceUrl = `https://db.netkeiba.com/horse/mare/${damId}/`;
      ({ html } = await fetchEucJp(produceUrl, { cache: args.cache }));
    } catch (e) {
      failures.push(`No.${h.id} ${h.name}: 産駒一覧取得失敗 (${e.message})`);
      enriched.push(h);
      continue;
    }

    const produce = parseProduceList(html);
    const years = [...new Set(produce.map((p) => p.year))].sort((a, b) => a - b);
    const rank = years.indexOf(birthYear);
    if (rank === -1) {
      failures.push(`No.${h.id} ${h.name}: 産駒一覧(${years.join(',')})に生年${birthYear}が見つからず`);
      enriched.push(h);
      continue;
    }
    enriched.push(withDamParityAfterDamAge(h, rank + 1));
    filled++;
  }
  console.log();

  if (failures.length > 0) {
    console.log(`\n[警告] damParity未取得: ${failures.length}/${horses2026.length}頭`);
    for (const f of failures) console.log(`  - ${f}`);
  }

  const headerComment = `/**
 * 2026年募集馬の客観データ（${enriched.length}頭）。
 *
 * このファイルは本来 \`scripts/fetch-2026-data.mjs\` が生成するが、No.56
 * 「マルシュロレーヌの25」は募集取り消しになったため2026-08-22に手で削除した
 * （本人からのチャット報告）。再生成すると元CSVにまだ載っていた場合は復活するので、
 * 次回スクリプトを再実行する際はクラブ公式リストの最新版（取り消し反映済みのもの）を使うこと。
 * 元CSV（クラブ公式・Shift-JIS）はリポジトリにコミットしていない。
 * netkeibaUrl / damUrl / damAge / sibling は netkeiba から自動取得した値。
 * surgery は今年の情報源が無いため全件空文字。
 * 再生成: node scripts/fetch-2026-data.mjs --csv "<募集馬リストのCSV>"
 *
 * damParity（産次）は \`scripts/fetch-site-birth-order.mjs\` が母の産駒一覧ページから
 * 後から追記する値（damAge等と同じ後付け方式）。fetch-2026-data.mjs を再実行して
 * damParity が消えた場合は fetch-site-birth-order.mjs も再実行すること。
 */`;
  writeHorsesTs(horsesPath, 'horses2026', headerComment, enriched);
  console.log(`書き出し: ${horsesPath}`);
  return { filled, total: horses2026.length, failures };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = {};
  if (args.do2025) summary.y2025 = await enrich2025();
  if (args.do2026) summary.y2026 = await enrich2026(args);

  console.log('\n================ サマリ ================');
  if (summary.y2025) console.log(`2025年募集: damParity ${summary.y2025.filled}/${summary.y2025.total}頭`);
  if (summary.y2026) {
    console.log(`2026年募集: damParity ${summary.y2026.filled}/${summary.y2026.total}頭`);
    if (summary.y2026.failures.length) {
      console.log(`  未取得: ${summary.y2026.failures.length}件（詳細は上のログ参照）`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
