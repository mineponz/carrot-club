/**
 * `analysis/data/recruits.json`（2017〜2025募集の全818頭）に登場するユニークな母について、
 * netkeibaの産駒一覧ページと各産駒の個体ページから「きょうだい全頭のロスター」を作り、
 * `analysis/data/dam-siblings.json` に書き出すスクリプト。
 *
 * 用途: 分析記事「母がサンデーレーシング出身の募集馬は走っているのか」
 *       （src/pages/articles/club-siblings.astro）の素材。
 *       将来の別の切り口でも再スクレイプ不要になるよう、募集クラブは全クラブぶんの
 *       ラベルを持たせ、母自身の出身クラブ（damClub）も併せて持たせる。
 *       2026年募集ぶん（horses2026.ts）の母も対象に含む。
 *
 * netkeibaアクセス作法は scripts/fetch-birth-order.mjs / fetch-race-results.mjs と同じ:
 *   - 1リクエストごとに 700〜1100ms のウェイト
 *   - 取得HTMLを .cache/netkeiba/ にキャッシュ（再実行時は叩き直さない）
 *   - euc-jp を UTF-16 相当にデコード
 *   - db.sp.netkeiba.com → db.netkeiba.com に正規化してから取得
 *
 * 既知の罠（踏まないこと）:
 *   - 賞金は 1億円以上で「N億M,MMM万円」表記に変わる → toYen10k で対応
 *   - 産駒一覧は同一馬の英名/和名が同じ年に2行出ることがある → 年で重複排除
 *   - 取得失敗産駒にもキーを必ず全部持たせる（読み出し側の x !== null が undefined を素通しする）
 *
 * 使い方:
 *   node scripts/build-dam-siblings.mjs
 *   node scripts/build-dam-siblings.mjs --limit 10     # 先頭10母だけ（動作確認）
 *   node scripts/build-dam-siblings.mjs --no-cache
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

let fetchCount = 0;
async function fetchEucJp(url, { cache = true } = {}) {
  const cachePath = join(CACHE_DIR, `${createHash('sha1').update(url).digest('hex')}.html`);
  if (cache && existsSync(cachePath))
    return { html: readFileSync(cachePath, 'utf8'), fromCache: true };
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
      fetchCount++;
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

/** 血統表ページの b_fml セル（母）からID（damUrl が無い母のフォールバック）。 */
function parseDamIdFromPedigree(html) {
  const m = html.match(
    /<td[^>]*rowspan="16"[^>]*class="b_fml"[^>]*>\s*<a href="https:\/\/db\.netkeiba\.com\/horse\/(\w+)\/">/,
  );
  return m ? m[1] : null;
}

/** 産駒一覧ページ → [{year, horseId, name}]（表示は新しい年が先頭）。年で重複排除は呼び出し側。 */
function parseProduceList(html) {
  const rows = [
    ...html.matchAll(
      /<td nowrap>(\d{4})<\/td>\s*<td class="txt_l">\s*(?:<a href="[^"]*\/horse\/(\w+)\/"[^>]*>([^<]*)<\/a>)?/g,
    ),
  ];
  return rows.map((r) => ({
    year: Number(r[1]),
    horseId: r[2] || null,
    name: (r[3] || '').trim(),
  }));
}

function toYen10k(raw) {
  // "1,930万円" → 1930 / "0万円" → 0 / "6億5,897万円" → 65897 / "-" → null
  const trimmed = (raw || '').trim();
  if (trimmed === '-' || trimmed === '') return null;
  const m = trimmed.match(/^(?:(\d+)億)?([\d,]*)万円$/);
  if (!m) return null;
  const oku = m[1] ? Number(m[1]) : 0;
  const man = m[2] ? Number(m[2].replace(/,/g, '')) : 0;
  return oku * 10000 + man;
}

const GRADE_RE = /\((G1|G2|G3|Jpn1|Jpn2|Jpn3)\)/;

/**
 * club 分類（ownerRaw を NFKC 正規化＋空白除去して判定・優先順）。
 * shares（募集口数）は「クラブ馬だが名義変更で名称不明」の救済に使う。
 */
function classifyClub(ownerRaw, shares) {
  if (ownerRaw == null || ownerRaw === '') return 'unknown';
  const s = ownerRaw.normalize('NFKC').replace(/\s/g, '');
  if (/サンデーレーシング/.test(s)) return 'sunday';
  if (/シルクレーシング/.test(s)) return 'silk';
  if (/キャロットファーム|キャロットクラブ/.test(s)) return 'carrot';
  if (/社台レースホース/.test(s)) return 'shadai-rh';
  if (/G1レーシング/.test(s)) return 'g1';
  if (/ロードホースクラブ|ロードサラブレッド/.test(s)) return 'lord';
  if (/ノルマンディー/.test(s)) return 'normandy';
  if (/東京サラブレッドクラブ/.test(s)) return 'tokyo-tc';
  if (/ラフィアン|ウイン(?!グ)/.test(s)) return 'club-other';
  if (/(レーシング|サラブレッドクラブ|ホースクラブ|クラブ)$/.test(s)) return 'club-other';
  if (shares === 40 || shares === 400 || shares === 500) return 'club-unknown';
  return 'private';
}

/**
 * 繁殖入りした古いサンデー/シルク牝馬の取りこぼし救済フラグ。
 * club が sunday/silk 以外で、口数がシルク相当(500) or サンデー相当(40 かつ社台RH/G1でない)。
 * 記事側で実名確認する前提。
 */
function isSundaySilkCandidate(club, shares) {
  if (club === 'sunday' || club === 'silk') return false;
  if (shares === 500) return true;
  if (shares === 40 && club !== 'shadai-rh' && club !== 'g1') return true;
  return false;
}

function parseHorsePage(html) {
  const ownerM = html.match(/<th[^>]*>\s*馬主\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/);
  const ownerRaw = ownerM ? stripTags(ownerM[1]) || null : null;
  const ownerId = ownerM ? (ownerM[1].match(/\/owner\/(?:result\/)?(\w+)/) || [])[1] || null : null;

  const breederM = html.match(/<th[^>]*>\s*生産者\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/);
  const breederRaw = breederM ? stripTags(breederM[1]) || null : null;

  const recruitM = html.match(/<th[^>]*>\s*募集情報\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/);
  const recruitRaw = recruitM ? stripTags(recruitM[1]) || null : null;
  let shares = null;
  let pricePerShareManYen = null;
  if (recruitRaw) {
    const rm = recruitRaw.match(/1口:([\d.]+)万円\/([\d,]+)口/);
    if (rm) {
      pricePerShareManYen = Number(rm[1]);
      shares = Number(rm[2].replace(/,/g, ''));
    }
  }

  const chuoM = html.match(/獲得賞金\s*\(中央\)<\/th>\s*<td>\s*([^<]+?)\s*<\/td>/);
  const chihoM = html.match(/獲得賞金\s*\(地方\)<\/th>\s*<td>\s*([^<]+?)\s*<\/td>/);
  const recordM = html.match(
    /通算成績<\/th>\s*<td>(\d+)戦(\d+)勝\s*\[<a[^>]*>(\d+)-(\d+)-(\d+)-(\d+)<\/a>\]/,
  );
  const mainWinM = html.match(/主な勝鞍<\/th>\s*<td>([\s\S]*?)<\/td>/);
  const mainWins = [];
  if (mainWinM) {
    const re = /<a href="\/race\/[^"]*"\s+title="([^"]+)"/g;
    let m;
    while ((m = re.exec(mainWinM[1]))) mainWins.push(m[1]);
  }
  const gradeWins = mainWins.filter((w) => GRADE_RE.test(w));

  const chuoPrizeManYen = chuoM ? toYen10k(chuoM[1]) : null;
  const chihoPrizeManYen = chihoM ? toYen10k(chihoM[1]) : null;
  const totalPrizeManYen =
    chuoPrizeManYen == null && chihoPrizeManYen == null
      ? null
      : (chuoPrizeManYen ?? 0) + (chihoPrizeManYen ?? 0);

  const club = classifyClub(ownerRaw, shares);

  return {
    ownerRaw,
    ownerId,
    breederRaw,
    club,
    sundaySilkCandidate: isSundaySilkCandidate(club, shares),
    shares,
    pricePerShareManYen,
    starts: recordM ? Number(recordM[1]) : null,
    wins: recordM ? Number(recordM[2]) : null,
    chuoPrizeManYen,
    chihoPrizeManYen,
    totalPrizeManYen,
    mainWins,
    gradeWins,
    recordFound: !!recordM,
  };
}

function blankFoal(year, horseId, name, url) {
  return {
    year,
    horseId: horseId ?? null,
    url: url ?? null,
    name: name || null,
    ownerRaw: null,
    ownerId: null,
    club: 'unknown',
    sundaySilkCandidate: false,
    shares: null,
    pricePerShareManYen: null,
    breederRaw: null,
    starts: null,
    wins: null,
    chuoPrizeManYen: null,
    chihoPrizeManYen: null,
    totalPrizeManYen: null,
    mainWins: [],
    gradeWins: [],
    recordFound: false,
    clubByOwner: 'unknown',
    isCarrotRecruit: false,
    recruitYear: null,
    note: null,
  };
}

/** 産駒一覧ページの <title>「<母名>の産駒成績｜…」から母名を取る。 */
function damNameFromMareTitle(html) {
  const m = html.match(/<title>\s*(.+?)の産駒(?:成績|一覧)/);
  return m ? m[1].trim() : null;
}

/** 募集名「<母名>の<生年2桁 or 4桁>」から母名を復元（damName 列が無い 2021〜2023 募集用）。 */
function damNameFromRecruitName(name) {
  if (!name) return null;
  const m = name.match(/^(?:外[)）]\s*)?(.+?)の(?:\d{2}|\d{4})$/);
  return m ? m[1].trim() : null;
}

/**
 * 母自身がどのクラブの現役馬だったかを、母の個体ページから判定する。
 *
 * ★これが記事の核心。「サンデー/シルクが先に募集して、残りがキャロットに回ってくる」という
 * 説を検証するには、**母自身がどのクラブの馬だったか**で切らないといけない。
 * 「母がサンデーにもキャロットにも産駒を出している」という条件は対称で方向を区別できず、
 * 母がキャロットの繁殖（産駒がキャロットに来るのが自然で、他クラブに出た1頭のほうが例外）
 * まで拾ってしまう（本人指摘・2026-08-30。マイティースルー・ハルーワソング等がその型）。
 *
 * 馬主欄は「現在の」馬主なので、引退して繁殖入りした母は個人名義に変わっていることがある。
 * ただし募集情報欄（口数）は引退後も残るため、「個人名義なのにクラブ口数(40/400/500)が
 * 残っている母」を探せば取りこぼしを検算できる（2026-08-30時点で0件＝取りこぼしは無い）。
 */
function parseDamOwnPage(html) {
  const ownerM = html.match(/<th[^>]*>\s*馬主\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/);
  const ownerRaw = ownerM ? stripTags(ownerM[1]) || null : null;
  const recM = html.match(/<th[^>]*>\s*募集情報\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/);
  const recruitRaw = recM ? stripTags(recM[1]) || null : null;
  let shares = null;
  if (recruitRaw) {
    const m = recruitRaw.match(/1口:([\d.]+)万円\/([\d,]+)口/);
    if (m) shares = Number(m[2].replace(/,/g, ''));
  }
  const rec = html.match(/通算成績<\/th>\s*<td>(\d+)戦(\d+)勝/);
  return {
    damOwnerRaw: ownerRaw,
    damShares: shares,
    damClub: classifyClub(ownerRaw, shares),
    damStarts: rec ? Number(rec[1]) : null,
    damWins: rec ? Number(rec[2]) : null,
  };
}

/** horses2026.ts（サイト表示用データ）から募集馬の配列を読む。 */
function loadHorses2026() {
  const src = readFileSync(join(ROOT, 'src', 'data', 'horses2026.ts'), 'utf8');
  const start = src.indexOf('= [') + 2;
  return JSON.parse(src.slice(start, src.lastIndexOf(']') + 1));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const recruits = JSON.parse(
    readFileSync(join(ROOT, 'analysis', 'data', 'recruits.json'), 'utf8'),
  );

  // netkeiba個体URL → 募集情報。キャロット募集馬は club を確定させる（現在の馬主が個人名義に
  // 変わっていても募集元はキャロットなので、馬主欄由来の分類より recruits.json を優先する）。
  const recruitByHorseId = new Map();
  for (const r of recruits) {
    const m = (r.netkeibaUrl || '').match(/\/horse\/(\w+)/);
    if (m) recruitByHorseId.set(m[1], { recruitYear: r.recruitYear, no: r.no });
  }
  // 最新年度（2026年募集）は recruits.json にまだ入らないので horses2026.ts から足す。
  // 記事のリード（「今年の募集にも母がサンデー/シルク出身の馬が何頭いる」）で使う。
  const horses2026 = loadHorses2026();
  for (const h of horses2026) {
    const m = (h.netkeibaUrl || '').match(/\/horse\/(\w+)/);
    if (m) recruitByHorseId.set(m[1], { recruitYear: 2026, no: h.id });
  }

  // --- ユニークな母を作る（damUrl 優先。無ければ後で血統表から）
  /** @type {Map<string, {damId:string|null, damName:string|null, damUrl:string|null, carrotRecruits:any[], _seedHorse:string|null}>} */
  const dams = new Map();
  for (const r of recruits) {
    const recruitEntry = { recruitYear: r.recruitYear, no: r.no, name: r.name };
    let damId = r.damUrl ? damIdFromUrl(r.damUrl) : null;
    if (damId) {
      const key = damId;
      if (!dams.has(key)) {
        dams.set(key, {
          damId,
          damName: r.damName && r.damName !== 'undefined' ? r.damName : null,
          damUrl: normalizeToDesktopUrl(r.damUrl),
          carrotRecruits: [],
          _seedHorse: null,
        });
      }
      const d = dams.get(key);
      if (!d.damName && r.damName && r.damName !== 'undefined') d.damName = r.damName;
      d.carrotRecruits.push(recruitEntry);
    } else {
      // damUrl 無し。damName でまとめておき、あとで血統表から damId を引く
      const key = `name:${r.damName || r.no}`;
      if (!dams.has(key)) {
        dams.set(key, {
          damId: null,
          damName: r.damName && r.damName !== 'undefined' ? r.damName : null,
          damUrl: null,
          carrotRecruits: [],
          _seedHorse: r.netkeibaUrl ? normalizeToDesktopUrl(r.netkeibaUrl) : null,
        });
      }
      const d = dams.get(key);
      if (!d._seedHorse && r.netkeibaUrl) d._seedHorse = normalizeToDesktopUrl(r.netkeibaUrl);
      d.carrotRecruits.push(recruitEntry);
    }
  }

  // 2026年募集ぶんの母も同じ Map に足す（既出の母には carrotRecruits を足すだけ）。
  for (const h of horses2026) {
    if (!h.damUrl) continue;
    const damId = damIdFromUrl(h.damUrl);
    if (!damId) continue;
    if (!dams.has(damId)) {
      dams.set(damId, {
        damId,
        damName: damNameFromRecruitName(h.name),
        damUrl: normalizeToDesktopUrl(h.damUrl),
        carrotRecruits: [],
        _seedHorse: null,
      });
    }
    dams.get(damId).carrotRecruits.push({ recruitYear: 2026, no: h.id, name: h.name });
  }

  const damList = [...dams.values()].slice(0, Number.isFinite(args.limit) ? args.limit : undefined);
  console.log(
    `ユニークな母: ${dams.size}（うち damUrl 直取り ${[...dams.values()].filter((d) => d.damId).length}）`,
  );

  const out = [];
  let skippedNoDamId = 0;
  let foalTotal = 0;
  let foalFetched = 0;
  let foalParseFail = 0;
  let dupYearCollapsed = 0;
  let okuChecked = null;
  const startedAt = Date.now();

  for (let i = 0; i < damList.length; i++) {
    const d = damList[i];
    let damId = d.damId;

    // damUrl 無し → 種馬（募集馬本人）の血統表から母IDを引く
    if (!damId) {
      if (!d._seedHorse) {
        skippedNoDamId++;
        out.push({
          damId: null,
          damName: d.damName,
          damUrl: null,
          carrotRecruits: d.carrotRecruits,
          foals: [],
          note: 'damUrl・血統表とも無く母を特定できず',
        });
        continue;
      }
      try {
        const pedUrl = d._seedHorse.replace('/horse/', '/horse/ped/');
        const { html } = await fetchEucJp(pedUrl, { cache: args.cache });
        damId = parseDamIdFromPedigree(html);
      } catch (e) {
        skippedNoDamId++;
        out.push({
          damId: null,
          damName: d.damName,
          damUrl: null,
          carrotRecruits: d.carrotRecruits,
          foals: [],
          note: `血統表取得失敗 (${e.message})`,
        });
        continue;
      }
      if (!damId) {
        skippedNoDamId++;
        out.push({
          damId: null,
          damName: d.damName,
          damUrl: null,
          carrotRecruits: d.carrotRecruits,
          foals: [],
          note: '血統表から母を特定できず',
        });
        continue;
      }
    }

    const damUrl = d.damUrl || `https://db.netkeiba.com/horse/${damId}/`;
    const mareUrl = `https://db.netkeiba.com/horse/mare/${damId}/`;
    process.stdout.write(
      `\r[${i + 1}/${damList.length}] ${d.damName || damId} fetch=${fetchCount}`.padEnd(70),
    );

    let mareHtml;
    try {
      ({ html: mareHtml } = await fetchEucJp(mareUrl, { cache: args.cache }));
    } catch (e) {
      out.push({
        damId,
        damName: d.damName,
        damUrl,
        carrotRecruits: d.carrotRecruits,
        foals: [],
        note: `産駒一覧取得失敗 (${e.message})`,
      });
      continue;
    }

    // damName 補完: recruits.json に無ければ産駒一覧の title → 募集名から復元
    let damName = d.damName;
    if (!damName) damName = damNameFromMareTitle(mareHtml);
    if (!damName) {
      for (const cr of d.carrotRecruits) {
        const n = damNameFromRecruitName(cr.name);
        if (n) {
          damName = n;
          break;
        }
      }
    }

    const produceRaw = parseProduceList(mareHtml);
    // 年で重複排除（英名/和名の二重掲載対策）。horseId 付きの行を優先。
    const byYear = new Map();
    for (const p of produceRaw) {
      if (!p.year) continue;
      if (!byYear.has(p.year)) byYear.set(p.year, p);
      else {
        dupYearCollapsed++;
        const cur = byYear.get(p.year);
        if (!cur.horseId && p.horseId) byYear.set(p.year, p);
      }
    }
    const produce = [...byYear.values()].sort((a, b) => a.year - b.year);

    const foals = [];
    for (const child of produce) {
      foalTotal++;
      if (!child.horseId) {
        const f = blankFoal(child.year, null, child.name, null);
        f.note = '産駒一覧にリンク無し（当歳・未登録等）';
        foals.push(f);
        continue;
      }
      const childUrl = `https://db.netkeiba.com/horse/${child.horseId}/`;
      let chtml;
      try {
        const res = await fetchEucJp(childUrl, { cache: args.cache });
        chtml = res.html;
        if (!res.fromCache) foalFetched++;
      } catch (e) {
        const f = blankFoal(child.year, child.horseId, child.name, childUrl);
        f.note = `個体ページ取得失敗 (${e.message})`;
        foals.push(f);
        foalParseFail++;
        continue;
      }
      const p = parseHorsePage(chtml);
      // 「億」表記の検算ログ（最初の1件）
      if (okuChecked == null && p.chuoPrizeManYen != null && p.chuoPrizeManYen >= 10000) {
        const raw = (chtml.match(/獲得賞金\s*\(中央\)<\/th>\s*<td>\s*([^<]+?)\s*<\/td>/) || [])[1];
        okuChecked = {
          name: child.name,
          horseId: child.horseId,
          raw,
          parsedManYen: p.chuoPrizeManYen,
        };
      }
      // キャロット募集馬は recruits.json を正とする（現在の馬主が個人名義でも募集元はキャロット）
      const rec = recruitByHorseId.get(child.horseId);
      const isCarrotRecruit = !!rec;
      foals.push({
        year: child.year,
        horseId: child.horseId,
        url: childUrl,
        name: child.name || null,
        ...p,
        club: isCarrotRecruit ? 'carrot' : p.club,
        clubByOwner: p.club,
        isCarrotRecruit,
        recruitYear: rec ? rec.recruitYear : null,
        sundaySilkCandidate: isCarrotRecruit ? false : p.sundaySilkCandidate,
        note: null,
      });
    }

    // 母自身がどのクラブの現役馬だったか（記事の核心。上の parseDamOwnPage のコメント参照）
    let damOwn = {
      damOwnerRaw: null,
      damShares: null,
      damClub: 'fetch-failed',
      damStarts: null,
      damWins: null,
    };
    try {
      const { html: damHtml } = await fetchEucJp(damUrl, { cache: args.cache });
      damOwn = parseDamOwnPage(damHtml);
    } catch {
      /* 取得できなければ fetch-failed のまま残す（キーは必ず持たせる） */
    }

    out.push({
      damId,
      damName: damName || null,
      damUrl,
      ...damOwn,
      carrotRecruits: d.carrotRecruits,
      foals,
    });
  }
  console.log();

  // 母を特定できなかった等で早期 push した行にもキーを必ず持たせる
  // （読み出し側の `x !== null` が undefined を素通しするのを防ぐ。既知の罠）
  for (const o of out) {
    o.damOwnerRaw ??= null;
    o.damShares ??= null;
    o.damClub ??= 'unknown';
    o.damStarts ??= null;
    o.damWins ??= null;
  }

  const payload = {
    fetchedAt: new Date().toISOString(),
    damCount: out.length,
    foalCount: out.reduce((s, d) => s + d.foals.length, 0),
    results: out,
  };
  const outPath = join(ROOT, 'analysis', 'data', 'dam-siblings.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');

  // ---- サマリ（数表のみ）
  const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
  const clubDist = {};
  let ssCand = 0;
  for (const d of out)
    for (const f of d.foals) {
      clubDist[f.club] = (clubDist[f.club] || 0) + 1;
      if (f.sundaySilkCandidate) ssCand++;
    }

  console.log(`\n=== 書き出し: ${outPath}`);
  console.log(
    `母 ${out.length} / 産駒 ${payload.foalCount} / 新規fetch ${fetchCount}件 / 所要 ${elapsedMin}分`,
  );
  console.log(`母ID特定できずスキップ: ${skippedNoDamId}件`);
  console.log(`産駒個体ページ 新規fetch: ${foalFetched}件 / 取得失敗: ${foalParseFail}件`);
  console.log(`年で重複排除した産駒一覧の行: ${dupYearCollapsed}件`);
  console.log(`\n--- club 分類の分布（全産駒 ${payload.foalCount}）`);
  for (const [k, v] of Object.entries(clubDist).sort((a, b) => b[1] - a[1]))
    console.log(`  ${k.padEnd(14)} ${v}`);
  console.log(`\nsundaySilkCandidate フラグ: ${ssCand}頭`);
  if (okuChecked) {
    console.log(`\n--- 「億」表記の検算1件`);
    console.log(
      `  ${okuChecked.name} (${okuChecked.horseId}) 中央賞金 生値="${okuChecked.raw}" → parsed ${okuChecked.parsedManYen}万円`,
    );
  }

  // ---- 母自身の出身クラブ（記事の核心）
  const damClubDist = {};
  for (const d of out) damClubDist[d.damClub] = (damClubDist[d.damClub] || 0) + 1;
  console.log(`\n--- 母自身の出身クラブ（母 ${out.length}）`);
  for (const [k, v] of Object.entries(damClubDist).sort((a, b) => b[1] - a[1]))
    console.log(`  ${k.padEnd(14)} ${v}`);

  // 取りこぼし検算: 個人名義なのにクラブ口数(40/400/500)が残っている母がいないか
  const leak = out.filter(
    (d) =>
      (d.damClub === 'private' || d.damClub === 'unknown') && [40, 400, 500].includes(d.damShares),
  );
  console.log(
    `\n取りこぼし検算（個人/不明名義なのにクラブ口数が残る母）: ${leak.length}件` +
      (leak.length ? ' ← 分類ロジックの見直しが必要' : ' ← 取りこぼし無し'),
  );

  // 記事素材: 母がサンデー/シルク出身のキャロット募集馬
  const ssDams = out.filter((d) => d.damClub === 'sunday' || d.damClub === 'silk');
  console.log(`\n=== 記事素材: 母がサンデー/シルク出身の母 ${ssDams.length}頭`);
  const fmt = (f) =>
    `${f.name}(${f.year} ${f.starts ?? '-'}戦${f.wins ?? '-'}勝 ${f.totalPrizeManYen ?? '-'}万${f.gradeWins.length ? ' ★' : ''})`;
  let bothCount = 0;
  for (const d of ssDams) {
    const stay = d.foals.filter((f) => f.club === 'sunday' || f.club === 'silk');
    const came = d.foals.filter((f) => f.club === 'carrot');
    if (stay.length && came.length) bothCount++;
    console.log(
      `- ${d.damName} [${d.damClub} ${d.damStarts}戦${d.damWins}勝] 同クラブ: ${stay.map(fmt).join(' ') || '—'} / キャロット: ${came.map(fmt).join(' ') || '—'}`,
    );
  }
  console.log(`うち両クラブに仔がいる母: ${bothCount}`);

  // 最新年度（2026年募集）で母がサンデー/シルク出身の馬 ―― 記事のリードで使う
  console.log(`\n=== 2026年募集で母がサンデー/シルク出身の馬`);
  for (const d of ssDams)
    for (const r of d.carrotRecruits)
      if (r.recruitYear === 2026)
        console.log(
          `  No.${r.no} ${r.name}  母:${d.damName}(${d.damClub} ${d.damStarts}戦${d.damWins}勝)`,
        );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
