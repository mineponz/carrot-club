/**
 * クラブ公式サイトの過去の測尺一覧ページ（2017〜2020年度、会員限定でない公開ページ）から、
 * `analysis/data/recruits.json`（[[20260821-import-5year-recruitment-data]]で作った
 * 2021〜2025年470頭のフォーマット）と同じ形に正規化して追加するスクリプト。
 *
 * この4年分は「体高(cm),胸囲(cm),管囲(cm),体重(kg)」と「予定育成牧場」しか載っておらず、
 * 一口価格・血統・性別・netkeibaリンクは無い（Recruit型のnullable項目として埋める）。
 *
 * netkeiba個体ページの特定方法（2021〜2025年のスプレッドシート取込やfetch-2026-data.mjsとは
 * 異なる）: この4年分の馬はすでに引退〜円熟期で大半が実名登録済みのため、募集馬名
 * 「母馬名の{生年}」のままnetkeiba検索してもヒットしないことが多い。代わりに
 *   1. 母馬名で馬名検索（list.html?word=）→ 性別が牝の行を母馬候補とする
 *   2. 各候補の産駒一覧ページ（/horse/mare/<id>/）→ 該当生年(recruitYear-1)の産駒を探す
 * を辿る（母馬名の候補が複数＝同名の繁殖牝馬がいる場合は、候補ごとに産駒一覧を見て
 * 該当生年の産駒がちょうど1頭見つかった候補を採用する。複数候補で見つかった場合はnetkeibaUrl
 * を null にしてnotesに記録し、目視確認に回す）。
 *
 * 使い方:
 *   node scripts/build-legacy-recruit-history.mjs                  # 4年分すべて
 *   node scripts/build-legacy-recruit-history.mjs --years 2017     # 1年だけ
 *   node scripts/build-legacy-recruit-history.mjs --limit 5        # 各年5頭だけ（動作確認用）
 *   node scripts/build-legacy-recruit-history.mjs --skip-netkeiba  # ページのパースだけ確認
 *   node scripts/build-legacy-recruit-history.mjs --no-cache
 *
 * 出力: `analysis/data/recruits-legacy.json`（recruits.jsonへの統合は別ステップで行う）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'netkeiba');
const CLUB_CACHE_DIR = join(ROOT, '.cache', 'carrotclub');
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MIN_INTERVAL_MS = 700;
const MAX_INTERVAL_MS = 1100;

/** クラブ公式ページ。年→URL（2019のみ本人からの訂正で `-members` 無しの公開版と判明）。 */
const CLUB_PAGES = {
  2017: 'https://carrotclub.net/sp/horse/2017_bosyuba_sokusyaku.asp',
  2018: 'https://carrotclub.net/sp/horse/2018-bosyu-size.asp',
  2019: 'https://carrotclub.net/sp/horse/201908-measure.asp',
  2020: 'https://carrotclub.net/sp/horse/202008_ikusei.asp',
};

// ---------------------------------------------------------------- 引数

function parseArgs(argv) {
  const args = {
    years: Object.keys(CLUB_PAGES).map(Number),
    limit: Infinity,
    cache: true,
    skipNetkeiba: false,
    out: join(ROOT, 'analysis', 'data', 'recruits-legacy.json'),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--years') args.years = argv[++i].split(',').map(Number);
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--no-cache') args.cache = false;
    else if (a === '--skip-netkeiba') args.skipNetkeiba = true;
    else if (a === '--out') args.out = argv[++i];
    else throw new Error(`未知の引数: ${a}`);
  }
  return args;
}

// ---------------------------------------------------------------- EUC-JP（netkeiba用）

function buildEucJpTable() {
  const decoder = new TextDecoder('euc-jp');
  const table = new Map();
  for (let i = 0; i < 0x80; i++) table.set(String.fromCharCode(i), [i]);
  for (let lead = 0xa1; lead <= 0xfe; lead++) {
    for (let trail = 0xa1; trail <= 0xfe; trail++) {
      const s = decoder.decode(new Uint8Array([lead, trail]));
      if (s.length === 1 && s !== '�' && !table.has(s)) table.set(s, [lead, trail]);
    }
  }
  for (let b = 0xa1; b <= 0xdf; b++) {
    const s = decoder.decode(new Uint8Array([0x8e, b]));
    if (s.length === 1 && s !== '�' && !table.has(s)) table.set(s, [0x8e, b]);
  }
  return table;
}
const EUC_JP_TABLE = buildEucJpTable();
const UNRESERVED = /[A-Za-z0-9\-_.~]/;
function encodeEucJpUrl(str) {
  let out = '';
  for (const ch of str) {
    const bytes = EUC_JP_TABLE.get(ch);
    if (!bytes) {
      out += encodeURIComponent(ch);
      continue;
    }
    for (const b of bytes) {
      const c = String.fromCharCode(b);
      out += b < 0x80 && UNRESERVED.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

// ---------------------------------------------------------------- HTTP

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
  if (cache && existsSync(cachePath)) return readFileSync(cachePath, 'utf8');
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
      return html;
    } catch (e) {
      lastError = e;
      console.warn(`  [warn] netkeiba取得失敗 (${attempt}/3) ${url}: ${e.message}`);
      await sleep(1500 * attempt);
    }
  }
  throw lastError;
}

/** クラブ公式ページ（Shift_JIS）。netkeibaと違い会員限定でなければ礼儀程度のウェイトのみ。 */
async function fetchShiftJis(url, { cache = true } = {}) {
  const cachePath = join(CLUB_CACHE_DIR, `${createHash('sha1').update(url).digest('hex')}.html`);
  if (cache && existsSync(cachePath)) return readFileSync(cachePath, 'utf8');
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = new TextDecoder('shift_jis').decode(await res.arrayBuffer());
  if (cache) {
    mkdirSync(CLUB_CACHE_DIR, { recursive: true });
    writeFileSync(cachePath, html);
  }
  return html;
}

// ---------------------------------------------------------------- パース

const stripTags = (html) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const ROMAN_NUMERALS = { Ⅰ: 'I', Ⅱ: 'II', Ⅲ: 'III', Ⅳ: 'IV', Ⅴ: 'V', Ⅵ: 'VI', Ⅶ: 'VII', Ⅷ: 'VIII', Ⅸ: 'IX', Ⅹ: 'X' };
function normalizeName(name) {
  return (name ?? '')
    .replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]/g, (c) => ROMAN_NUMERALS[c])
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s'’・]/g, '')
    .toUpperCase();
}

/**
 * クラブの測尺一覧テーブル（`<table class="tblType1">`）をパースする。
 * 1行 = No. / 「母馬名のYY(YY)<br>体高, 胸囲, 管囲, 体重」/ 予定育成牧場。
 * 年によって「の2016」（4桁）と「の18」（2桁）が混在するため両対応する。
 */
function parseClubPage(html, recruitYear) {
  const table = html.match(/<table class="tblType1">[\s\S]*?<\/table>/)?.[0];
  if (!table) throw new Error(`recruitYear=${recruitYear}: tblType1テーブルが見つからない`);
  const rows = [];
  for (const m of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const rowHtml = m[1];
    const tds = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (tds.length < 3) continue; // ヘッダー行等
    const no = stripTags(tds[0]);
    if (!/^\d+$/.test(no)) continue;
    const nameCell = tds[1];
    const nameMatch = nameCell.match(/^\s*([^<]+?)の(\d{2,4})\s*<br/);
    if (!nameMatch) {
      console.warn(`  [warn] recruitYear=${recruitYear} No.${no}: 馬名セルの形式が想定外: ${stripTags(nameCell).slice(0, 40)}`);
      continue;
    }
    const damName = nameMatch[1].trim();
    // split('<br')[1] の先頭には閉じ残しの'>'が付くことがあるため、素直に数値だけを正規表現で拾う
    // （','区切りでのNumber()変換だと先頭要素が">153.0"のようになりNaNになるバグを踏んだ）。
    const nums = [...(nameCell.split('<br')[1] ?? '').matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    const [height, chestGirth, caretGirth, weight] = nums;
    const trainingFarmRaw = stripTags(tds[2]);
    const trainingFarm = trainingFarmRaw && trainingFarmRaw !== '-' ? trainingFarmRaw : null;
    rows.push({
      recruitYear,
      no,
      damName,
      name: `${damName}の${recruitYear}`, // 表示用の暫定名（recruits.jsonの命名規則に合わせる）
      sex: null,
      netkeibaUrl: null,
      damUrl: null,
      sire: null,
      broodmareSire: null,
      pricePerShare: null,
      height: Number.isFinite(height) ? height : null,
      chestGirth: Number.isFinite(chestGirth) ? chestGirth : null,
      caretGirth: Number.isFinite(caretGirth) ? caretGirth : null,
      weight: Number.isFinite(weight) ? weight : null,
      trainingFarm,
      legacySource: true,
      resolveNotes: [],
    });
  }
  return rows;
}

/**
 * 馬名検索一覧テーブルをパースする（fetch-2026-data.mjsと同じ構造だが、ID抽出の正規表現を
 * 修正済み）。1999年以前生まれの旧世代馬は`000a011c88`のような16進混じりIDを持ち、
 * `\d{6,}`だと数字のみのIDしか拾えず母馬（レーヴディマン自身など）の行が丸ごと消えるバグを
 * 踏んだ（2026-08-22）。
 */
function parseHorseListRows(html) {
  const table = html.match(/<table[^>]*horse_list_table[^>]*>[\s\S]*?<\/table>/)?.[0];
  if (!table) return [];
  const rows = [];
  for (const m of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const rowHtml = m[1];
    const id = rowHtml.match(/value="([0-9a-z]{6,})"/)?.[1];
    if (!id) continue;
    const tds = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    rows.push({
      id,
      name: stripTags(tds[1] ?? ''),
      sex: stripTags(tds[2] ?? ''),
      birthYear: Number(stripTags(tds[3] ?? '')) || null,
    });
  }
  return rows;
}

/** 母馬の産駒一覧（年度・馬名・ID）を取り出す。 */
async function fetchProduce(mareId, opts) {
  const html = await fetchEucJp(`https://db.netkeiba.com/horse/mare/${mareId}/`, opts);
  const table = html.match(/<table[^>]*race_table_01[^>]*>[\s\S]*?<\/table>/)?.[0];
  if (!table) return [];
  const produce = [];
  for (const m of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const rowHtml = m[1];
    const tds = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (tds.length < 4) continue;
    const year = Number(stripTags(tds[0]));
    const link = tds[1].match(/href="https:\/\/db\.netkeiba\.com\/horse\/(\d+)\/"[^>]*>([\s\S]*?)<\/a>/);
    if (!year || !link) continue;
    produce.push({ year, id: link[1], name: stripTags(link[2]) });
  }
  return produce;
}

/**
 * netkeibaの馬名検索は該当が1頭だけだと一覧を出さずその馬の個体ページへ302リダイレクトする
 * （`fetch`はデフォルトでリダイレクトを追うため、キャッシュされるのは個体ページのHTML）。
 * 一覧ページかどうかは`horse_list_table`の有無で判定し、個体ページだった場合はcanonicalリンクの
 * IDと性別欄から候補行を1件だけ合成する（2026-08-22、「リッチダンサー」等の完全一致1件ヒットで
 * 検索結果0件と誤判定するバグを踏んで気づいた）。
 */
function parseSearchOrSingleHit(html) {
  const hits = parseHorseListRows(html);
  if (hits.length > 0) return hits;
  const canonical = html.match(/rel="canonical" href="https:\/\/db\.netkeiba\.com\/horse\/([0-9a-z]+)\/"/)?.[1];
  if (!canonical) return [];
  const name = stripTags(html.match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/)?.[1] ?? '');
  // 個体ページに「性別」欄は無く、`<p class="txt_01">　牝　黒鹿毛 </p>`のように毛色と並記される。
  // 抹消済み（引退）馬は先頭に「抹消」が付く（例:「抹消　牝　栗毛 」）ので先頭語では拾えない。
  const txt01 = stripTags(html.match(/<p class="txt_01">([\s\S]*?)<\/p>/)?.[1] ?? '');
  const sex = txt01.match(/牡|牝|せん/)?.[0] ?? '';
  const birthYear = Number(
    stripTags(html.match(/<th>生年月日<\/th>\s*<td>([\s\S]*?)<\/td>/)?.[1] ?? '').match(/(\d{4})年/)?.[1] ?? '',
  ) || null;
  return [{ id: canonical, name, sex, birthYear }];
}

/**
 * 母馬名から募集馬のnetkeiba個体URLを特定する。
 * 母馬名の候補（同名の繁殖牝馬）が複数いる場合、各候補の産駒一覧で該当生年(foalYear)の
 * 産駒がちょうど1頭見つかった候補だけを採用する。0件または複数候補でヒットした場合はnullで、
 * notesに理由を残す。
 */
async function resolveNetkeibaUrl(row, opts) {
  const foalYear = row.recruitYear - 1;
  // クラブ表記の「外)」（外国産馬プレフィックス）はnetkeiba側の登録名に付かないため、
  // 検索・照合の両方で剥がした名前を使う（例:「外)ザガールインザットソング」→
  // 「ザガールインザットソング」でないとヒットしない）。
  const damSearchName = row.damName.replace(/^外\)/, '');
  // クラブ表記のローマ数字（例:「オリジナルスピンⅡ」のⅡ=U+2161）はEUC-JPに無く、そのままだと
  // netkeibaの検索が空振りする。正規化表記（Ⅱ→"II"等）でも検索を試す
  // （fetch-2026-data.mjsのsearchDamAndFoalと同じフォールバック）。
  const words = [...new Set([damSearchName, normalizeName(damSearchName)])];
  let hits = [];
  for (const word of words) {
    const listHtml = await fetchEucJp(`https://db.netkeiba.com/horse/list.html?word=${encodeEucJpUrl(word)}`, opts);
    hits = parseSearchOrSingleHit(listHtml);
    if (hits.some((h) => normalizeName(h.name) === normalizeName(damSearchName) && h.sex === '牝')) break;
  }
  const mareCands = hits.filter((h) => normalizeName(h.name) === normalizeName(damSearchName) && h.sex === '牝');
  if (mareCands.length === 0) {
    row.resolveNotes.push(`母馬「${row.damName}」がnetkeiba馬名検索でヒットせず`);
    return;
  }
  const foundOn = [];
  for (const mare of mareCands) {
    const produce = await fetchProduce(mare.id, opts);
    const foals = produce.filter((p) => p.year === foalYear);
    if (foals.length === 1) foundOn.push({ mare, foal: foals[0] });
  }
  if (foundOn.length === 1) {
    // 既存recruits.jsonの表記（db.sp.netkeiba.com）に揃える。fetch-race-results.mjsが
    // 取得時にdb.netkeiba.comへ正規化するので実害は無いが、データの見た目を統一しておく。
    row.netkeibaUrl = `https://db.sp.netkeiba.com/horse/${foundOn[0].foal.id}/`;
    row.name = foundOn[0].foal.name; // 実名が取れたら暫定名を実名に差し替える
    // 母のnetkeiba個体ページURL。「キャロットにいる兄姉」機能（sibling-recruits.ts、
    // 未マージのclaude/carrot-sibling-details-display-w7nd6eブランチ）がdamUrl一致で
    // 兄姉を探すため、この4年分でも埋めておく（本人からの指示: 2026-08-22）。
    row.damUrl = `https://db.sp.netkeiba.com/horse/${foundOn[0].mare.id}/`;
  } else if (foundOn.length === 0) {
    row.resolveNotes.push(
      `母馬候補${mareCands.length}件中、${foalYear}年産の産駒がちょうど1頭の候補が無し（要手動確認）`,
    );
  } else {
    row.resolveNotes.push(`同名母馬候補が複数、それぞれに${foalYear}年産の産駒があり一意に絞れず（要手動確認）`);
  }
}

// ---------------------------------------------------------------- メイン

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const allRows = [];
  for (const year of args.years) {
    const url = CLUB_PAGES[year];
    if (!url) throw new Error(`未知の年度: ${year}`);
    console.log(`[club] ${year}年 ${url}`);
    const html = await fetchShiftJis(url, { cache: args.cache });
    const rows = parseClubPage(html, year).slice(0, Number.isFinite(args.limit) ? args.limit : undefined);
    console.log(`  → ${rows.length}頭`);
    allRows.push(...rows);
  }

  if (!args.skipNetkeiba) {
    let resolved = 0;
    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      process.stdout.write(`\r[netkeiba ${i + 1}/${allRows.length}] ${row.recruitYear}年No.${row.no} ${row.damName}`.padEnd(70));
      try {
        await resolveNetkeibaUrl(row, { cache: args.cache });
        if (row.netkeibaUrl) resolved++;
      } catch (e) {
        row.resolveNotes.push(`エラー: ${e.message}`);
      }
    }
    console.log();
    console.log(`netkeiba紐付け: ${resolved}/${allRows.length}頭`);
  }

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(allRows, null, 2) + '\n');
  console.log(`書き出し: ${args.out}（${allRows.length}件）`);

  const byYear = {};
  for (const r of allRows) byYear[r.recruitYear] = (byYear[r.recruitYear] ?? 0) + 1;
  console.log('年別件数:', byYear);
  const unresolved = allRows.filter((r) => !r.netkeibaUrl);
  if (unresolved.length) {
    console.log(`未紐付け ${unresolved.length}件:`);
    for (const r of unresolved.slice(0, 20)) {
      console.log(`  ${r.recruitYear}年No.${r.no} ${r.damName}: ${r.resolveNotes.join(' / ')}`);
    }
    if (unresolved.length > 20) console.log(`  ...他${unresolved.length - 20}件`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
