/**
 * 募集馬（`analysis/data/recruits.json` 818頭）の父ごとに netkeiba オーナーズDBの
 * 「種付け料推移」ページから世代（クロップ）情報を取り、募集馬ごとに「父の何世代目の産駒か」を
 * 導出するスクリプト（本人の仮説「父の初年度産駒は父名由来の馬名が増えるのでは」の検証用 /
 * 2026-09-16 [[20260916-horse-name-trends-article]]）。
 *
 * ## 「年度」列の意味（実データで検証済み）
 * `db_sire_fee.html` の「年度」列は**種付け（covering）年**であり、産駒の生年ではない。
 * 「登録頭数」セルのリンクは `progeny_list.html?...&s_year=<年度+1>&e_year=<年度+1>` になっており、
 * 登録される産駒は年度の翌年に生まれる。実データで2件確認した:
 *   - シスキン(id=000a01aa3d): 年度2021=供用1年目・登録7 → リンクは s_year=2022（＝1年目产駒は2022年生）。
 *     本人メモの「ロックターミガンは2023年産でシスキンの2年目」は、年度2022=供用2年目・登録46 → 産駒は
 *     2023年生、と対応する（cropIndexの計算どおり2年目になる）。
 *   - ヴァンゴッホ(id=000a01a7c9): 年度2022=供用1年目・登録58 → 産駒は2023年生。
 *     本人の例示「ゾネブルーム（2023年産）はヴァンゴッホの初年度産駒」と一致する。
 * → 募集馬の生年(birthYear)に対応する行は「年度 = birthYear - 1」の行。
 *
 * ## 父IDの取り方
 * `recruits.json` の父名（`sire`）そのものにはnetkeiba IDが無いため、同じ父を持つ募集馬の
 * 5代血統表ページ（`https://db.netkeiba.com/horse/ped/<募集馬id>/`）内、父セル
 * （`rowspan="16" class="b_ml"`）の`<a href="https://db.netkeiba.com/horse/<父id>/">`から取る。
 * このページは`fetch-dam-age.mjs`が母抽出のため既に`.cache/netkeiba/`へキャッシュ済みのものが
 * ほとんどなので、追加リクエストはほぼ発生しない。父ごとに代表1頭のページだけを見ればよい
 * （同じ父は1回だけ）。
 *
 * ## 「種付け料推移」ページが無い父
 * 海外供用のみで日本で種付けしていない父（Frankel等）は`db_sire_fee.html`に表自体が無く、
 * 「データがありません。」とだけ出る。この場合 cropIndex は null とし、理由を記録する。
 *
 * 使い方:
 *   node scripts/fetch-sire-crops.mjs
 *   node scripts/fetch-sire-crops.mjs --limit 5   # 父を先頭N件だけ処理（動作確認用）
 *   node scripts/fetch-sire-crops.mjs --no-cache
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PED_CACHE_DIR = join(ROOT, '.cache', 'netkeiba');
const FEE_CACHE_DIR = join(ROOT, '.cache', 'netkeiba-sire-fee');
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
// 母の産地取得（fetch-dam-birthplace.mjs）が並行稼働中のため、既存スクリプト（0.7〜1.1秒）より
// 間隔を長めに取る。
const MIN_INTERVAL_MS = 1300;
const MAX_INTERVAL_MS = 2000;
// 世代の「実質」何世代目かを数えるとき、登録頭数がこの頭数未満の世代は数えない
// （本人指定の例: シスキンの1年目=登録7頭は数えず、2年目を実質1世代目とする）。
const REGISTERED_THRESHOLD = 20;

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

async function fetchCached(url, encoding, cacheDir, { cache = true } = {}) {
  mkdirSync(cacheDir, { recursive: true });
  const cachePath = join(cacheDir, `${createHash('sha1').update(url).digest('hex')}.html`);
  if (cache && existsSync(cachePath)) return { html: readFileSync(cachePath, 'utf8'), fromCache: true };
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await throttle();
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const html = new TextDecoder(encoding).decode(buf);
      if (cache) writeFileSync(cachePath, html);
      return { html, fromCache: false };
    } catch (e) {
      lastError = e;
      console.warn(`  [warn] 取得失敗 (${attempt}/3) ${url}: ${e.message}`);
      await sleep(1500 * attempt);
    }
  }
  throw lastError;
}

const fetchEucJp = (url, opts) => fetchCached(url, 'euc-jp', PED_CACHE_DIR, opts);
const fetchUtf8 = (url, opts) => fetchCached(url, 'utf-8', FEE_CACHE_DIR, opts);

const stripTags = (html) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * 募集馬の5代血統表ページから父のnetkeiba ID・馬名・生年を取る。
 * `class="b_ml"` かつ `rowspan="16"` のセルが父（`fetch-2026-data.mjs`のfetchDamFromPedigreeと
 * 同じ手法、母は`b_fml`）。2026年のリニューアルで`<div class="parent"><div>`が挟まる版と
 * 挟まらない旧版が両方キャッシュに混在しているため、`[\s\S]*?`で間の要素を許容する。
 */
function parseSireFromPedigree(html) {
  const m = html.match(
    /<td[^>]*rowspan="16"[^>]*class="b_ml"[^>]*>[\s\S]*?<a href="https:\/\/db\.netkeiba\.com\/horse\/(\w+)\/">([\s\S]*?)<\/a>\s*<br \/>\s*(\d{4})?/,
  );
  if (!m) return null;
  return { id: m[1], name: stripTags(m[2]), birthYear: m[3] ? Number(m[3]) : null };
}

function toNumberOrNull(text) {
  const t = text.trim();
  if (t === '' || t === '-') return null;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** 「400万円」→400（万円単位）。「-」はnull。 */
function parseFeeManYen(text) {
  const t = text.trim();
  if (t === '' || t === '-') return null;
  const m = t.match(/^([\d,]+)万円$/);
  if (m) return Number(m[1].replace(/,/g, ''));
  return null; // 「応相談」等、数値化できない表記はnullのまま元テキストをrawFeeに残す
}

/**
 * `db_sire_fee.html` の「種付け料推移」表をパースする。表が無い（データがありません）父は
 * `{ rows: [], note: 'no-fee-table' }` を返す。
 */
function parseSireFeeTable(html) {
  if (/<p class="NoData Txt">データがありません。<\/p>/.test(html)) {
    return { rows: [], note: 'no-fee-table' };
  }
  const tableMatch = html.match(/<table class="NkOwnersTable01">[\s\S]*?<\/table>/);
  if (!tableMatch) return { rows: [], note: 'no-fee-table' };
  const tbodyMatch = tableMatch[0].match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) return { rows: [], note: 'no-fee-table' };
  const rowBlocks = tbodyMatch[1]
    .split(/<\/tr>/)
    .map((s) => s.trim())
    .filter(Boolean);
  const rows = [];
  for (const block of rowBlocks) {
    const yearM = block.match(/<th class="Head">(\d{4})/);
    if (!yearM) continue;
    const cells = [...block.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
    // 列順: 供用年数, 種付料, 種付け頭数, 登録頭数, 出走頭数, 勝馬頭数, 代表産駒
    if (cells.length < 7) continue;
    const serviceYearM = cells[0].match(/^(\d+)年目$/);
    rows.push({
      year: Number(yearM[1]), // 種付け（covering）年。産駒の生年ではない
      serviceYear: serviceYearM ? Number(serviceYearM[1]) : null,
      rawFee: cells[1],
      fee: parseFeeManYen(cells[1]),
      covered: toNumberOrNull(cells[2]),
      registered: toNumberOrNull(cells[3]),
      starters: toNumberOrNull(cells[4]),
      winners: toNumberOrNull(cells[5]),
      representative: cells[6] === '-' ? null : cells[6],
    });
  }
  return { rows, note: rows.length ? null : 'empty-table' };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const recruitsPath = join(ROOT, 'analysis', 'data', 'recruits.json');
  const recruits = JSON.parse(readFileSync(recruitsPath, 'utf8'));

  // 1. distinctな父ごとにIDを特定する（代表1頭の血統表ページから）。
  const sireNames = [...new Set(recruits.filter((r) => r.sire).map((r) => r.sire))].sort();
  const targetSireNames = sireNames.slice(0, Number.isFinite(args.limit) ? args.limit : undefined);

  const sireIdByName = new Map();
  const sireIdResolutionFailures = [];
  for (let i = 0; i < targetSireNames.length; i++) {
    const sireName = targetSireNames[i];
    process.stdout.write(`\r[父ID特定 ${i + 1}/${targetSireNames.length}] ${sireName}`.padEnd(60));
    const candidates = recruits.filter((r) => r.sire === sireName && r.netkeibaUrl);
    let resolved = null;
    for (const cand of candidates) {
      const pedUrl = cand.netkeibaUrl
        .replace('db.sp.netkeiba.com', 'db.netkeiba.com')
        .replace('/horse/', '/horse/ped/');
      try {
        const { html } = await fetchEucJp(pedUrl, { cache: args.cache });
        const sire = parseSireFromPedigree(html);
        if (sire) {
          resolved = sire;
          break;
        }
      } catch (e) {
        // 次の候補へ
      }
    }
    if (resolved) {
      sireIdByName.set(sireName, resolved.id);
    } else {
      sireIdResolutionFailures.push(sireName);
    }
  }
  console.log();

  // 2. 父ごとに種付け料推移ページを取得。
  const uniqueSireIds = [...new Set(sireIdByName.values())];
  const feeDataBySireId = new Map();
  for (let i = 0; i < uniqueSireIds.length; i++) {
    const sireId = uniqueSireIds[i];
    process.stdout.write(`\r[種付け料推移 ${i + 1}/${uniqueSireIds.length}] id=${sireId}`.padEnd(60));
    const url = `https://own.netkeiba.com/db/db_sire_fee.html?id=${sireId}`;
    const { html } = await fetchUtf8(url, { cache: args.cache });
    const { rows, note } = parseSireFeeTable(html);
    feeDataBySireId.set(sireId, { rows, note });
  }
  console.log();

  // 3. sire-crops.json を組み立て。
  const sireCrops = targetSireNames.map((sireName) => {
    const sireId = sireIdByName.get(sireName) ?? null;
    const feeData = sireId ? feeDataBySireId.get(sireId) : null;
    return {
      sire: sireName,
      sireId,
      rows: feeData ? feeData.rows : [],
      note: sireId ? feeData.note : 'sire-id-unresolved',
    };
  });
  const sireCropsPath = join(ROOT, 'analysis', 'data', 'sire-crops.json');
  writeFileSync(sireCropsPath, JSON.stringify(sireCrops, null, 2) + '\n');

  // 4. 募集馬ごとの派生値。
  const sireCropByName = new Map(sireCrops.map((s) => [s.sire, s]));
  const nullReasonCounts = {};
  const bump = (reason) => {
    nullReasonCounts[reason] = (nullReasonCounts[reason] || 0) + 1;
  };

  const perHorse = recruits.map((r) => {
    const base = { recruitYear: r.recruitYear, no: r.no, name: r.name, sire: r.sire ?? null };
    if (!r.sire || !r.birthDate) {
      bump('no-netkeiba-id');
      return {
        ...base,
        birthYear: null,
        cropIndex: null,
        registeredInCrop: null,
        effectiveCropIndex: null,
        nullReason: 'no-netkeiba-id',
      };
    }
    const birthYear = Number(r.birthDate.slice(0, 4));
    const sireCrop = sireCropByName.get(r.sire);
    if (!sireCrop || !sireCrop.sireId) {
      bump('sire-id-unresolved');
      return {
        ...base,
        birthYear,
        cropIndex: null,
        registeredInCrop: null,
        effectiveCropIndex: null,
        nullReason: 'sire-id-unresolved',
      };
    }
    if (sireCrop.note === 'no-fee-table' || sireCrop.note === 'empty-table') {
      bump('no-fee-table');
      return {
        ...base,
        birthYear,
        cropIndex: null,
        registeredInCrop: null,
        effectiveCropIndex: null,
        nullReason: 'no-fee-table',
      };
    }
    const breedingYear = birthYear - 1;
    const row = sireCrop.rows.find((rr) => rr.year === breedingYear);
    if (!row || row.serviceYear === null) {
      bump('year-not-in-table');
      return {
        ...base,
        birthYear,
        cropIndex: null,
        registeredInCrop: null,
        effectiveCropIndex: null,
        nullReason: 'year-not-in-table',
      };
    }
    const cropIndex = row.serviceYear;
    const registeredInCrop = row.registered;

    // 実質何世代目か（登録頭数が閾値未満の世代を除いて数える）。
    const qualifyingRows = sireCrop.rows
      .filter((rr) => rr.registered !== null && rr.registered >= REGISTERED_THRESHOLD)
      .sort((a, b) => a.year - b.year);
    let effectiveCropIndex = null;
    let nullReason = null;
    if (registeredInCrop === null) {
      nullReason = 'registered-pending';
      bump('effective-registered-pending');
    } else if (registeredInCrop < REGISTERED_THRESHOLD) {
      nullReason = 'below-threshold';
      bump('effective-below-threshold');
    } else {
      const idx = qualifyingRows.findIndex((rr) => rr.year === breedingYear);
      effectiveCropIndex = idx >= 0 ? idx + 1 : null;
      if (effectiveCropIndex === null) {
        nullReason = 'below-threshold';
        bump('effective-below-threshold');
      }
    }

    return {
      ...base,
      birthYear,
      cropIndex,
      registeredInCrop,
      effectiveCropIndex,
      // cropIndex自体は取れているので、nullReasonはeffectiveCropIndexがnullの場合のみ載せる
      nullReason: effectiveCropIndex === null ? nullReason : null,
    };
  });

  const perHorsePath = join(ROOT, 'analysis', 'data', 'sire-crop-index.json');
  writeFileSync(perHorsePath, JSON.stringify(perHorse, null, 2) + '\n');

  // 5. レポート出力。
  console.log(`distinct父: ${sireNames.length}件（今回処理: ${targetSireNames.length}件）`);
  console.log(
    `父ID特定: 成功 ${sireIdByName.size} / 失敗 ${sireIdResolutionFailures.length}` +
      (sireIdResolutionFailures.length ? `（${sireIdResolutionFailures.join('、')}）` : ''),
  );
  const withTable = sireCrops.filter((s) => s.sireId && s.note === null).length;
  const noFeeTable = sireCrops.filter((s) => s.note === 'no-fee-table' || s.note === 'empty-table').length;
  console.log(`種付け料推移: 表あり ${withTable} / 表なし(no-fee-table) ${noFeeTable}`);
  console.log(`sire-crops.json: ${sireCropsPath}`);
  console.log(`sire-crop-index.json: ${perHorsePath}（${perHorse.length}頭）`);
  console.log('cropIndex/effectiveCropIndex が null の理由別内訳:', nullReasonCounts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
