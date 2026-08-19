/**
 * 2026年募集馬CSV + netkeiba → src/data/horses2026.ts / 個人スプレッドシート用CSV 生成スクリプト。
 *
 * 使い方:
 *   node scripts/fetch-2026-data.mjs                       # 既定のCSVを読んで全件処理
 *   node scripts/fetch-2026-data.mjs --limit 2             # 先頭2頭だけ（動作確認用）
 *   node scripts/fetch-2026-data.mjs --only 1,5,7          # No. 指定
 *   node scripts/fetch-2026-data.mjs --csv <path> --out-ts <path> --out-csv <path>
 *
 * 2025年版（scripts/convert-csv.mjs）との違い:
 *   - 元CSVがクラブ公式の生データ（Shift-JIS / CP932）で、netkeibaURL・兄弟・母齢の列が**無い**。
 *     この3つは netkeiba から取得する（下記の取得手順）。
 *   - 一口価格が「一口金額（円）」なので 10000 で割って万円に直す（2025年版は既に万円だった）。
 *   - 性別が「牡 / メス」表記なので `牡 / 牝` に正規化する。
 *
 * netkeibaからの取得手順（1頭あたり）:
 *   1. 母馬名で馬名検索（`db.netkeiba.com/horse/list.html?word=<EUC-JPエンコード>`）。
 *      検索結果一覧から「<母馬名>の2025」＝当該募集馬の行を拾う → これが `netkeibaUrl`。
 *      （クラブの募集馬名は「〜の25」表記だが netkeiba は「〜の2025」表記なので組み立てて照合する）
 *   2. 募集馬の5代血統表ページ（`/horse/ped/<id>/`）から**母馬のID・生年**を取る。
 *      検索結果の母馬行から引くより確実（同名の繁殖牝馬がいても間違えない／外国産の母も引ける）。
 *      `damAge = 2025 - 母の生年`。
 *   3. 母馬の産駒一覧（`/horse/mare/<id>/`）から2025年より前の産駒＝兄姉候補を取り、
 *      各候補の個体ページで戦績を見て代表兄姉を1頭選ぶ（重賞勝ち > 勝利数 > 獲得賞金）。
 *
 * 出力:
 *   - `src/data/horses2026.ts`（`Horse[]`。リポジトリにコミットする客観データ）
 *   - `~/Downloads/carrot-club-2026-for-sheets.csv`（本人のスプレッドシート取込用。A〜AA列は
 *     2025年版シートと同じ並びで、個人の評価・進捗列は空欄。AB「母URL」は2026年版で増えた列
 *     （`Horse.damUrl` と同じ値）。
 *     **個人データ扱いなのでリポジトリにはコミットしない**）
 *
 * 手術・既往（surgery）は今年のCSVにも netkeiba にも無く、クラブ公式PDFの一覧にしか載らない。
 * `SURGERY_BY_NO`（下部）に募集番号→記載内容の対応表として持たせているので、再生成しても消えない。
 *
 * netkeibaへのアクセスは1リクエストごとにウェイトを入れ、取得済みHTMLは `.cache/netkeiba/`
 * にキャッシュして再実行時に叩き直さない（`--no-cache` で無効化）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'netkeiba');
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
/** netkeibaへの連続リクエスト間隔（ms）。相手のサーバに負荷をかけないための礼儀。 */
const MIN_INTERVAL_MS = 700;
const MAX_INTERVAL_MS = 1100;
/** 募集馬の生年。CSVの「生年月日(2025年)」列とnetkeibaの「<母>の2025」命名の両方に効く。 */
const FOAL_YEAR = 2025;

// ---------------------------------------------------------------- 引数

function parseArgs(argv) {
  const args = {
    csv: join(homedir(), 'Downloads', 'bosyuba-list-20260818.csv'),
    outTs: join(ROOT, 'src', 'data', 'horses2026.ts'),
    outCsv: join(homedir(), 'Downloads', 'carrot-club-2026-for-sheets.csv'),
    limit: Infinity,
    only: null,
    cache: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--csv') args.csv = argv[++i];
    else if (a === '--out-ts') args.outTs = argv[++i];
    else if (a === '--out-csv') args.outCsv = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--only') args.only = new Set(argv[++i].split(',').map((s) => s.trim()));
    else if (a === '--no-cache') args.cache = false;
    else throw new Error(`未知の引数: ${a}`);
  }
  return args;
}

// ---------------------------------------------------------------- 文字コード

/**
 * EUC-JP のエンコード表。Nodeの `TextEncoder` はUTF-8専用でEUC-JPを吐けないので、
 * `TextDecoder('euc-jp')` で全2バイト列をデコードして逆引き表を作る。
 */
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

/** 文字列をEUC-JPでURLエンコードする（netkeibaの検索はEUC-JPを期待する）。 */
function encodeEucJpUrl(str) {
  let out = '';
  for (const ch of str) {
    const bytes = EUC_JP_TABLE.get(ch);
    if (!bytes) {
      // EUC-JPに無い文字（環境依存文字など）はUTF-8のまま送るしかない。検索が外れる可能性あり。
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
let requestCount = 0;
let cacheHitCount = 0;

async function throttle() {
  const wait = MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < wait) await sleep(wait - elapsed);
  lastRequestAt = Date.now();
}

/** URLをGETしてEUC-JPとしてデコードした本文を返す。キャッシュ・ウェイト・リトライ込み。 */
async function fetchEucJp(url, { cache = true } = {}) {
  const cachePath = join(CACHE_DIR, `${createHash('sha1').update(url).digest('hex')}.html`);
  if (cache && existsSync(cachePath)) {
    cacheHitCount++;
    return readFileSync(cachePath, 'utf8');
  }
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await throttle();
      requestCount++;
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
      console.warn(`  [warn] 取得失敗 (${attempt}/3) ${url}: ${e.message}`);
      await sleep(1500 * attempt);
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------- HTMLパース

const stripTags = (html) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * 血統系セルは `<a>名前</a><span>名前 [ ]</span>` のようにツールチップ用の重複が入るので、
 * 最初のリンクテキストだけを取る。
 */
const firstLinkText = (html) => stripTags(html.match(/<a[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? html);

const ROMAN_NUMERALS = { Ⅰ: 'I', Ⅱ: 'II', Ⅲ: 'III', Ⅳ: 'IV', Ⅴ: 'V', Ⅵ: 'VI', Ⅶ: 'VII', Ⅷ: 'VIII', Ⅸ: 'IX', Ⅹ: 'X' };

/**
 * 馬名の表記ゆれを吸収する。クラブのCSVは「カリプソⅡ」（機種依存のローマ数字1文字）だが
 * netkeiba は「カリプソII」（英大文字のI×2）で登録している、といった差を埋める。
 */
function normalizeName(name) {
  return name
    .replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]/g, (c) => ROMAN_NUMERALS[c])
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s'’・]/g, '')
    .toUpperCase();
}

/** 馬名検索の結果一覧をパースする。 */
function parseHorseListRows(html) {
  const table = html.match(/<table[^>]*horse_list_table[^>]*>[\s\S]*?<\/table>/)?.[0];
  if (!table) return [];
  const rows = [];
  for (const m of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const rowHtml = m[1];
    const id = rowHtml.match(/value="(\d{6,})"/)?.[1];
    if (!id) continue;
    const tds = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    rows.push({
      id,
      name: stripTags(tds[1] ?? ''),
      sex: stripTags(tds[2] ?? ''),
      birthYear: Number(stripTags(tds[3] ?? '')) || null,
      sire: firstLinkText(tds[6] ?? ''),
      dam: firstLinkText(tds[7] ?? ''),
      broodmareSire: firstLinkText(tds[8] ?? ''),
    });
  }
  return rows;
}

/** 個体ページのプロフィール表から `<th>ラベル</th><td>値</td>` を引く。 */
function profileField(html, label) {
  const re = new RegExp(`<th>${label}</th>\\s*<td>([\\s\\S]*?)</td>`);
  return html.match(re)?.[1] ?? null;
}

const GRADE_PATTERN = /\((?:G|Jpn|JpnG)\s?([123])\)|\((G[I]{1,3})\)/gi;

/** `(G1)` 等の表記から重賞ランク（G1=3 / G2=2 / G3=1 / 重賞勝ちなし=0）を判定する。 */
function gradeRankOf(text) {
  let rank = 0;
  for (const m of text.matchAll(GRADE_PATTERN)) {
    const roman = m[2] ? { GI: 1, GII: 2, GIII: 3 }[m[2].toUpperCase()] : null;
    const level = Number(m[1] ?? roman);
    if (!level) continue;
    rank = Math.max(rank, 4 - level); // G1→3, G2→2, G3→1
  }
  return rank;
}

/** 個体ページから戦績（出走数・勝利数・獲得賞金・重賞ランク）を取り出す。 */
async function fetchHorseProfile(id, opts) {
  const html = await fetchEucJp(`https://db.netkeiba.com/horse/${id}/`, opts);
  const name = stripTags(html.match(/<div class="horse_title">\s*<h1>([\s\S]*?)<\/h1>/)?.[1] ?? '');
  const birth = stripTags(profileField(html, '生年月日') ?? '');
  const birthMatch = birth.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  const record = stripTags(profileField(html, '通算成績') ?? '');
  const recordMatch = record.match(/(\d+)戦(\d+)勝/);
  // 主な勝鞍は2着目以降がHTMLコメントに入っているので、コメント記号を外してから見る。
  const mainWinHtml = (profileField(html, '主な勝鞍') ?? '').replace(/<!--|-->/g, '');
  const mainWin = stripTags(mainWinHtml).replace(/^、+|、+$/g, '').replace(/、+/g, '、');
  // 賞金は「17億5,655万円」のように億表記が付く。万円単位に揃えて返す。
  const prizeOf = (label) => {
    const m = stripTags(profileField(html, label) ?? '').match(/(?:([\d,]+)億)?([\d,.]+)万円/);
    if (!m) return 0;
    const oku = Number((m[1] ?? '0').replace(/,/g, '')) || 0;
    const man = Number((m[2] ?? '0').replace(/,/g, '')) || 0;
    return oku * 10000 + man;
  };
  const prizeCentral = prizeOf('獲得賞金 \\(中央\\)');
  const prizeLocal = prizeOf('獲得賞金 \\(地方\\)');
  return {
    id,
    name,
    birthYear: birthMatch ? Number(birthMatch[1]) : null,
    birthDate: birthMatch
      ? `${birthMatch[1]}-${birthMatch[2].padStart(2, '0')}-${birthMatch[3].padStart(2, '0')}`
      : null,
    starts: recordMatch ? Number(recordMatch[1]) : 0,
    wins: recordMatch ? Number(recordMatch[2]) : 0,
    prize: prizeCentral + prizeLocal,
    mainWin,
    gradeRank: gradeRankOf(mainWin),
  };
}

/**
 * 募集馬の5代血統表ページから母馬のID・馬名・生年を取り出す。
 * 血統表の左端2セル（rowspan=16）が父と母で、母は `class="b_fml"` の方。
 */
async function fetchDamFromPedigree(foalId, opts) {
  const html = await fetchEucJp(`https://db.netkeiba.com/horse/ped/${foalId}/`, opts);
  const m = html.match(
    /<td[^>]*rowspan="16"[^>]*class="b_fml"[^>]*>\s*<a href="https:\/\/db\.netkeiba\.com\/horse\/(\w+)\/">([\s\S]*?)<\/a>\s*<br \/>\s*(\d{4})?/,
  );
  if (!m) return null;
  return { id: m[1], name: stripTags(m[2]), birthYear: m[3] ? Number(m[3]) : null };
}

/** 母馬の産駒一覧（年度・馬名・性別・父名）を取り出す。 */
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
    produce.push({ year, id: link[1], name: stripTags(link[2]), sex: stripTags(tds[2]), sire: firstLinkText(tds[3]) });
  }
  return produce;
}

// ---------------------------------------------------------------- CSV

/** RFC 4180 準拠の最小CSVパーサ（convert-csv.mjs と同じもの）。 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toCsvField(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** クラブ公式CSV（Shift-JIS/CP932）の列位置。 */
const SRC = {
  no: 0,
  damPriority: 1,
  name: 2,
  sire: 3,
  dam: 4,
  broodmareSire: 5,
  sex: 6,
  color: 7,
  birthDate: 8,
  height: 9,
  chestGirth: 10,
  caretGirth: 11,
  weight: 12,
  farm: 13,
  area: 14,
  stable: 15,
  totalPrice: 16,
  pricePerShareYen: 17,
};

/**
 * 手術・既往（`surgery`）の対応表。
 *
 * 出典: クラブ公式PDF `carrotclub26_int.pdf` 12ページ「募集馬の手術歴等について」（2026年7月27日現在）。
 * 募集CSVにもnetkeibaにも載らない情報なので、ここに手で持つ（PDFが更新されたら追記・修正する）。
 * 悪癖欄はPDF上で全頭空欄だったため取り込んでいない。表に載っていない馬は空文字のまま。
 * キーはクラブの募集番号（CSVの No. 列）。`name` は取り違え検知用で、CSVと突き合わせて警告を出す。
 */
const SURGERY_BY_NO = {
  1: { name: 'ブランノワールの25', text: '右飛節OCD除去手術（2026/5/26）' },
  13: { name: 'ハープスターの25', text: '右副手根骨骨折により骨片除去手術（2025/12/1）' },
  17: { name: 'レッドティーの25', text: '両飛節OCD除去手術（2026/2/12）' },
  27: { name: 'ブロンディーヴァの25', text: '両飛節OCD除去手術（2025/10/31）' },
  // 馬名はクラブCSVの表記に合わせる（受け取った転記では「モンベルデュ」「レイパバレ」だったが、
  // CSVは「モンペルデュ」「レイパパレ」。番号は一致しているので手術内容はそのまま採用した）
  29: { name: 'モンペルデュの25', text: '左飛節感染性関節炎により関節洗浄（2026/5/8、2026/5/10、2026/5/13）' },
  36: { name: 'シーズンズギフトの25', text: '右飛節OCD除去手術（2026/7/3）' },
  39: { name: 'セレナズヴォイスの25', text: '右後第一趾骨骨折により骨片除去手術（2025/10/17）' },
  44: {
    name: 'プロスペラスヴォヤージの25',
    text: '左前球節に起因する跛行のため同関節の試験的関節鏡手術（所見なし）（2026/4/27）',
  },
  52: { name: 'スウィッチインタイムの25', text: '右飛節OCD除去手術（2026/1/22）' },
  57: { name: 'レイパパレの25', text: '右飛節OCD除去手術（2026/6/15）' },
  75: { name: 'クロワドフェールの25', text: '左前球節感染性関節炎により関節洗浄（2025/10/7、2025/10/11）' },
  82: { name: 'チカレンヌの25', text: '左飛節OCD除去手術（2026/2/27）' },
  88: { name: 'アーズローヴァーの25', text: '右飛節OCD除去手術（2026/6/23）' },
};

/** 募集番号で手術歴を引く。PDFからの転記ミス・年度違いを検知するため馬名も突き合わせる。 */
function surgeryFor(row, notes) {
  const entry = SURGERY_BY_NO[Number(row.id)];
  if (!entry) return '';
  if (entry.name !== row.name) {
    notes.push(`手術歴の表の馬名「${entry.name}」がCSVの「${row.name}」と一致しない（PDF転記の要確認）`);
  }
  return entry.text;
}

/** "4月30日" → "2025-04-30"（2025年産のため年は固定）。 */
function toIsoBirthDate(raw) {
  const m = raw.trim().match(/^(\d{1,2})月(\d{1,2})日$/);
  if (!m) throw new Error(`誕生日の形式が想定外: ${JSON.stringify(raw)}`);
  return `${FOAL_YEAR}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function toNumber(raw, label, id) {
  const value = Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(value)) throw new Error(`${label} が数値でない (No.${id}): ${JSON.stringify(raw)}`);
  return value;
}

/** クラブCSVの性別表記（牡 / メス）を Horse['sex'] に正規化する。 */
function toSex(raw) {
  const s = raw.trim();
  if (s === '牡' || s === 'オス') return '牡';
  if (s === '牝' || s === 'メス') return '牝';
  if (s === 'セ' || s === 'セン') return 'セ';
  throw new Error(`性別が想定外: ${JSON.stringify(raw)}`);
}

// ---------------------------------------------------------------- 兄姉の選定

/**
 * 兄姉候補から代表を1頭選ぶ。優先順は 重賞勝ち > 勝利数 > 獲得賞金。
 * 1走も勝っておらず賞金も無い候補しかいなければ null（= sibling は空文字）。
 */
function pickSibling(candidates) {
  const raced = candidates.filter((c) => c.wins > 0 || c.prize > 0);
  if (raced.length === 0) return null;
  return raced.sort((a, b) => b.gradeRank - a.gradeRank || b.wins - a.wins || b.prize - a.prize)[0];
}

// ---------------------------------------------------------------- 1頭分の取得

/**
 * 母馬名で検索し、当該募集馬（= `<母馬名>の2025`）の行と母馬自身の行を探す。
 *
 * 検索結果は1ページ20件までで、母馬名が他馬の部分一致になる場合（例:「ライティア」は
 * 「ブライティア○○」に全部当たる）は当該馬がページ外に落ちる。そういう時のために
 * 母馬の行も拾っておき、呼び出し側が産駒一覧から募集馬をたどれるようにする。
 */
async function searchDamAndFoal(row, notes, opts) {
  const dam = row.dam;
  const wantedFoal = normalizeName(`${dam}の${FOAL_YEAR}`);
  const words = [...new Set([dam, normalizeName(dam)])];
  let foal = null;
  let mareRow = null;
  for (const word of words) {
    const listHtml = await fetchEucJp(`https://db.netkeiba.com/horse/list.html?word=${encodeEucJpUrl(word)}`, opts);
    const hits = parseHorseListRows(listHtml);

    let cands = hits.filter((h) => normalizeName(h.name) === wantedFoal);
    if (cands.length === 0) {
      // 外国産の母は netkeiba 側が原語名で登録されていることがある
      //（例: CSVの「ビディデューク」→ netkeibaは「Biddy Dukeの2025」）。
      // カタカナ名で検索しても行自体はヒットするので、「〜の2025」かつ父が一致する行を拾う。
      cands = hits.filter((h) => h.name.endsWith(`の${FOAL_YEAR}`) && normalizeName(h.sire) === normalizeName(row.sire));
    }
    if (cands.length > 1) {
      // 同名の繁殖牝馬がいると当歳馬も同名になる。父・母父がCSVと一致する方を採る。
      cands = cands.filter(
        (h) =>
          normalizeName(h.sire) === normalizeName(row.sire) &&
          normalizeName(h.broodmareSire) === normalizeName(row.broodmareSire),
      );
    }
    if (cands.length === 1) foal = cands[0];
    else if (cands.length > 1) notes.push(`「${dam}の${FOAL_YEAR}」が複数ヒットして一意に絞れず（要手動確認）`);

    mareRow ??= hits.find(
      (h) => normalizeName(h.name) === normalizeName(dam) && h.sex === '牝' && (h.birthYear ?? 0) < FOAL_YEAR,
    );
    if (foal) break;
  }
  return { foal, mareRow };
}

async function resolveFromNetkeiba(row, opts) {
  const dam = row.dam;
  const notes = [];
  const result = {
    netkeibaUrl: '',
    /** 母馬自身のnetkeiba個体ページ。スプレッドシートの「母URL」列用（TS側の Horse には持たせない） */
    damUrl: '',
    damAge: 0,
    sibling: '',
    siblingDetail: null,
    siblingCandidates: 0,
    notes,
  };

  const { foal, mareRow } = await searchDamAndFoal(row, notes, opts);

  // --- 母馬の特定
  // 第一候補は募集馬の血統表（同名の繁殖牝馬がいても取り違えないし、外国産の母も引ける）。
  // 募集馬の行が検索で見つからなかった時だけ、検索結果の母馬行にフォールバックする。
  let mare = foal ? await fetchDamFromPedigree(foal.id, opts) : null;
  if (!mare && mareRow) {
    mare = { id: mareRow.id, name: mareRow.name, birthYear: mareRow.birthYear };
    notes.push(`募集馬の行を検索で特定できず、母「${dam}」の検索結果行からたどった（要目視確認）`);
  }
  if (!mare) {
    notes.push(`母「${dam}」も募集馬もnetkeibaで特定できず（要手動確認）`);
    return result;
  }
  result.damUrl = `https://db.netkeiba.com/horse/${mare.id}/`;
  // 血統表の外国産馬は「ジェイウォーク Jaywalk(米)」のように原語表記が付く。原語名だけで
  // 登録されている母（例: Winter Power）もあるため、和名同士で食い違う時だけ警告する。
  const mareNameIsJapanese = /[ァ-ヴー]/.test(mare.name);
  if (mareNameIsJapanese && !normalizeName(mare.name).startsWith(normalizeName(dam))) {
    notes.push(`血統表の母名「${mare.name}」がCSVの母「${dam}」と一致しない（要手動確認）`);
  }

  // --- 母齢: 母の生年から算出。血統表に生年が無ければ母の個体ページを引く。
  let mareBirthYear = mare.birthYear;
  if (!mareBirthYear) {
    try {
      mareBirthYear = (await fetchHorseProfile(mare.id, opts)).birthYear;
    } catch (e) {
      notes.push(`母「${dam}」の個体ページ取得に失敗: ${e.message}`);
    }
  }
  if (mareBirthYear) result.damAge = FOAL_YEAR - mareBirthYear;
  else notes.push(`母「${dam}」の生年を取得できず damAge=0（要手動確認）`);

  const produce = await fetchProduce(mare.id, opts);

  // --- 募集馬のURL: 検索で見つかっていればそれ、駄目なら母の産駒一覧の2025年産から拾う
  let foalId = foal?.id ?? null;
  if (!foalId) {
    const thisYear = produce.filter((p) => p.year === FOAL_YEAR);
    if (thisYear.length === 1) foalId = thisYear[0].id;
    else notes.push(`母の産駒一覧に${FOAL_YEAR}年産が${thisYear.length}頭あり募集馬を特定できず（要手動確認）`);
  }
  if (foalId) result.netkeibaUrl = `https://db.netkeiba.com/horse/${foalId}/`;

  // --- 兄姉: 産駒一覧から当該募集馬より前の年度の産駒を候補にする
  const candidates = produce.filter((p) => p.year < FOAL_YEAR && p.id !== foalId);
  result.siblingCandidates = candidates.length;
  const profiles = [];
  for (const c of candidates) {
    try {
      const p = await fetchHorseProfile(c.id, opts);
      profiles.push({ ...p, name: p.name || c.name, year: c.year });
    } catch (e) {
      notes.push(`兄姉候補 ${c.name} (${c.id}) の戦績取得に失敗: ${e.message}`);
    }
  }
  const best = pickSibling(profiles);
  if (best) {
    result.sibling = best.name;
    result.siblingDetail = `${best.wins}勝 / ${best.prize}万円 / ${best.mainWin || '重賞勝ちなし'}`;
  }
  return result;
}

// ---------------------------------------------------------------- 本体

const args = parseArgs(process.argv.slice(2));

const rawCsv = new TextDecoder('shift_jis').decode(readFileSync(args.csv));
const cell = (row, index) => (row[index] ?? '').trim();
const sourceRows = parseCsv(rawCsv)
  .slice(1)
  .filter((row) => cell(row, SRC.no) !== '' && cell(row, SRC.name) !== '')
  .map((row) => ({
    id: cell(row, SRC.no),
    name: cell(row, SRC.name),
    sire: cell(row, SRC.sire),
    dam: cell(row, SRC.dam),
    broodmareSire: cell(row, SRC.broodmareSire),
    sex: toSex(cell(row, SRC.sex)),
    birthDate: toIsoBirthDate(cell(row, SRC.birthDate)),
    stable: cell(row, SRC.stable),
    height: toNumber(cell(row, SRC.height), '体高', cell(row, SRC.no)),
    chestGirth: toNumber(cell(row, SRC.chestGirth), '胸囲', cell(row, SRC.no)),
    caretGirth: toNumber(cell(row, SRC.caretGirth), '管囲', cell(row, SRC.no)),
    weight: toNumber(cell(row, SRC.weight), '馬体重', cell(row, SRC.no)),
    // 「一口金額（円）」→ 万円。2025年版CSVは既に万円だったのでここが今年の相違点。
    pricePerShare: toNumber(cell(row, SRC.pricePerShareYen), '一口金額', cell(row, SRC.no)) / 10000,
    damPriority: cell(row, SRC.damPriority) !== '',
  }));

const targets = sourceRows.filter((r) => (args.only ? args.only.has(r.id) : true)).slice(0, args.limit);
console.log(`元CSV: ${args.csv}`);
console.log(`対象: ${targets.length} 頭 / CSV全 ${sourceRows.length} 頭\n`);

const horses = [];
const issues = [];
for (const [index, row] of targets.entries()) {
  const label = `[${index + 1}/${targets.length}] No.${row.id} ${row.name}（母:${row.dam}）`;
  let resolved = {
    netkeibaUrl: '',
    damUrl: '',
    damAge: 0,
    sibling: '',
    siblingDetail: null,
    siblingCandidates: 0,
    notes: [],
  };
  try {
    resolved = await resolveFromNetkeiba(row, { cache: args.cache });
  } catch (e) {
    resolved.notes.push(`netkeiba取得中に例外: ${e.message}`);
  }
  const surgery = surgeryFor(row, resolved.notes);
  for (const note of resolved.notes) issues.push({ id: row.id, name: row.name, note });
  console.log(
    `${label}\n` +
      `    netkeiba: ${resolved.netkeibaUrl || '(未取得)'}\n` +
      `    母齢: ${resolved.damAge || '(未取得)'} / 兄姉候補 ${resolved.siblingCandidates} 頭 → ` +
      `${resolved.sibling || '(該当なし)'}${resolved.siblingDetail ? ` [${resolved.siblingDetail}]` : ''}` +
      (resolved.notes.length ? `\n    ⚠ ${resolved.notes.join(' / ')}` : ''),
  );

  horses.push({
    id: row.id,
    name: row.name,
    sex: row.sex,
    netkeibaUrl: resolved.netkeibaUrl,
    // 母馬自身のnetkeibaページ。サイトの「母」リンク列とスプレッドシートのAB列で同じ値を使う。
    damUrl: resolved.damUrl,
    sire: row.sire,
    broodmareSire: row.broodmareSire,
    damAge: resolved.damAge,
    birthDate: row.birthDate,
    stable: row.stable,
    pricePerShare: row.pricePerShare,
    height: row.height,
    chestGirth: row.chestGirth,
    caretGirth: row.caretGirth,
    weight: row.weight,
    sibling: resolved.sibling,
    damPriority: row.damPriority,
    // 手術・既往はクラブ公式PDFにしか無いので SURGERY_BY_NO（上部）から引く。表に無ければ空文字。
    surgery,
    xSearchUrl: `https://x.com/search?q=${row.dam}&src=typed_query`,
  });
}

// --- 出力1: src/data/horses2026.ts
const tsBody = `/**
 * 2026年募集馬の客観データ（${horses.length}頭）。
 *
 * このファイルは \`scripts/fetch-2026-data.mjs\` が生成する。手で編集しない。
 * 元CSV（クラブ公式・Shift-JIS）はリポジトリにコミットしていない。
 * netkeibaUrl / damUrl / damAge / sibling は netkeiba から自動取得した値。
 * surgery は今年の情報源が無いため全件空文字。
 * 再生成: node scripts/fetch-2026-data.mjs --csv "<募集馬リストのCSV>"
 */
import type { Horse } from '../lib/horses.ts';

export const horses2026: Horse[] = ${JSON.stringify(horses, null, 2)};
`;
writeFileSync(args.outTs, tsBody);

// --- 出力2: 本人のスプレッドシート用CSV
// A〜AA列は2025年版シートと同じ並び（個人の評価・進捗列は空欄のまま本人が埋める）。
// AB「母URL」は2026年版シートで増えた列で、母馬自身のnetkeiba個体ページを入れる。
// damAge / sibling を取るために母馬ページのIDは既に引いているので追加取得は発生しない。
const SHEET_HEADER = [
  'No', '評価', '募集馬名', '性別', 'netkeibaURL', '父', '母父', '母齢', '誕生日', '厩舎', '一口',
  '体高(cm)', '胸囲(cm)', '管囲(cm)', '馬体重(kg)', '兄弟', '動画再生', 'お気に入り', '母優', '手術',
  'ブログ', 'ラストバブル', '最終申し込み', '', '8-23評価', '自分メモ', 'X', '母URL',
];
const sheetRows = horses.map((h) => {
  const cells = new Array(SHEET_HEADER.length).fill('');
  const [, month, day] = h.birthDate.split('-');
  cells[0] = h.id;                              // A No
  cells[2] = h.name;                            // C 募集馬名
  cells[3] = h.sex;                             // D 性別
  cells[4] = h.netkeibaUrl;                     // E netkeibaURL
  cells[5] = h.sire;                            // F 父
  cells[6] = h.broodmareSire;                   // G 母父
  cells[7] = h.damAge || '';                    // H 母齢
  cells[8] = `${Number(month)}/${Number(day)}`; // I 誕生日（スプシは M/D 表記）
  cells[9] = h.stable;                          // J 厩舎
  cells[10] = h.pricePerShare;                  // K 一口（万円）
  cells[11] = h.height;                         // L 体高
  cells[12] = h.chestGirth;                     // M 胸囲
  cells[13] = h.caretGirth;                     // N 管囲
  cells[14] = h.weight;                         // O 馬体重
  cells[15] = h.sibling;                        // P 兄弟
  cells[18] = h.damPriority ? '◯' : '';         // S 母優
  cells[19] = h.surgery;                        // T 手術（今年は情報源が無く常に空）
  cells[26] = h.xSearchUrl;                     // AA X検索URL
  cells[27] = h.damUrl;                         // AB 母URL（サイトの「母」リンク列と同じ値）
  return cells;
});
const csvBody = [SHEET_HEADER, ...sheetRows].map((r) => r.map(toCsvField).join(',')).join('\n') + '\n';
writeFileSync(args.outCsv, csvBody, 'utf8');

// --- サマリ
const filled = (key) => horses.filter((h) => h[key] !== '' && h[key] !== 0).length;
console.log('\n================ サマリ ================');
console.log(`書き出し: ${args.outTs}（${horses.length} 頭）`);
console.log(`書き出し: ${args.outCsv}（スプレッドシート用・UTF-8・個人列は空欄）`);
console.log(`netkeibaリクエスト: ${requestCount} 件 / キャッシュヒット: ${cacheHitCount} 件`);
console.log(`netkeibaUrl 取得済み: ${filled('netkeibaUrl')} / ${horses.length}`);
console.log(`damAge 取得済み: ${filled('damAge')} / ${horses.length}`);
console.log(`sibling あり: ${filled('sibling')} / ${horses.length}`);
console.log(`damUrl（母のnetkeibaページ）取得済み: ${filled('damUrl')} / ${horses.length}`);
console.log(`母優先: ${horses.filter((h) => h.damPriority).length} 頭`);
console.log(
  `手術・既往あり: ${filled('surgery')} 頭（対応表 SURGERY_BY_NO の登録は ${Object.keys(SURGERY_BY_NO).length} 頭）`,
);
// 対応表に載っているのにCSVに居ない番号＝PDFの年度違い・番号ずれの可能性。全件処理した時だけ見る。
if (args.only === null && !Number.isFinite(args.limit)) {
  const missing = Object.keys(SURGERY_BY_NO).filter((no) => !horses.some((h) => h.id === String(no)));
  if (missing.length) console.log(`⚠ 手術歴の対応表にあるがCSVに無い No.: ${missing.join(', ')}`);
}
console.log(`性別: ${[...new Set(horses.map((h) => h.sex))].join(' / ')}`);
if (issues.length) {
  console.log(`\n要手動確認 ${issues.length} 件:`);
  for (const i of issues) console.log(`  No.${i.id} ${i.name}: ${i.note}`);
} else {
  console.log('\n要手動確認: なし');
}
