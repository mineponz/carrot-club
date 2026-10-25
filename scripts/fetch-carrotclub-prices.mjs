/**
 * carrotclub.net公式ページから2017〜2024年募集馬の一口価格を取得し、`analysis/data/recruits.json`
 * の既存`pricePerShare`（netkeiba由来）と突合するスクリプト。本人指示（2026-10-23）により
 * 一口価格は公式ページの「1口出資額」を正として使う。
 *
 * 個体ページ `https://carrotclub.net/horse/horse.asp?id=NNNN` はログイン不要（検証済み・
 * 2026-10-23）。IDの規則は**募集年によって2種類ある**（各10件以上の生年月日一致で検証済み）。
 *   - 2017〜2022年募集: `{募集年の下2桁}{募集番号を2桁0埋め}`（例: 2017年No.9→"1709"）
 *   - 2023〜2024年募集: `{生年(西暦)の下2桁}{募集番号を3桁0埋め}`（例: 生年2022年No.90→"22090"）
 *     ※2023年募集以降は募集年ベースのID（例"2301"）が全く存在しない（404相当）ことを確認済み。
 * いずれの規則も取得した各ページの生年月日をrecruits.jsonの`birthDate`と突合して検証する
 * （馬名はrecruits.json側が命名前の仮称「母名の生まれた年」のままのことが多く当てにならない）。
 *
 * 一方、`https://carrotclub.net/horse/intai.asp`（引退馬一覧検索）は本スクリプトの開発時に
 * GET・POSTとも繰り返し試したが、毎回「セッションタイムアウトエラーです。会員ページで、
 * 一定の時間にページの再読込が行われなかった場合に発生します」という会員専用ページのエラーが
 * 返り、ログイン無しでは一度も正常なHTMLを取得できなかった（2026-10-23、cookie受け渡し・
 * Referer・直前のSID再送信など複数パターンを試行）。公開メニュー(horse_menu.asp)自体にも
 * intai.aspへのリンクは存在しない。そのため本スクリプトはintai.aspを使わず、IDを直接構築する
 * 方式のみを採用している。ID規則で生年月日が一致しなかった馬はこのスクリプトでは解決できない
 * （intai.aspでの検索が必要だが、ログイン無しでは実行できなかった）。
 *
 * 使い方:
 *   node scripts/fetch-carrotclub-prices.mjs
 *   node scripts/fetch-carrotclub-prices.mjs --limit 5
 *   node scripts/fetch-carrotclub-prices.mjs --min-year 2021 --max-year 2024
 *   node scripts/fetch-carrotclub-prices.mjs --no-cache
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'carrotclub');
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MIN_INTERVAL_MS = 700;
const MAX_INTERVAL_MS = 1100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequestAt = 0;
async function throttle() {
  const wait = MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < wait) await sleep(wait - elapsed);
  lastRequestAt = Date.now();
}

async function fetchShiftJis(url, { cache = true } = {}) {
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
      const html = new TextDecoder('shift_jis').decode(await res.arrayBuffer());
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

function parseHorsePage(html) {
  if (html.includes('セッションタイムアウト')) return { ok: false, reason: 'session_error' };
  const nameM = html.match(/<h1>\s*([^<]+?)\s*<\/h1>/);
  const priceM = html.match(
    /総口数<\/span>([\d,]+)口[\s\S]{0,40}?募集総額<\/span>([\d,]+)万円[\s\S]{0,40}?1口出資額<\/span>([\d,]+)円/
  );
  // 生年月日は<p class="uma-txt1">内に「'16/4/5生」の形で入っている（西暦下2桁/月/日）。
  const birthM = html.match(/'(\d{2})\/(\d{1,2})\/(\d{1,2})生/);
  if (!nameM) return { ok: false, reason: 'no_h1' };
  return {
    ok: true,
    name: nameM[1],
    shareCount: priceM ? Number(priceM[1].replace(/,/g, '')) : null,
    totalPriceManYen: priceM ? Number(priceM[2].replace(/,/g, '')) : null,
    pricePerShareYen: priceM ? Number(priceM[3].replace(/,/g, '')) : null,
    birthDate: birthM
      ? `20${birthM[1]}-${String(birthM[2]).padStart(2, '0')}-${String(birthM[3]).padStart(2, '0')}`
      : null,
  };
}

/** 募集年に応じてcarrotclub個体ページのIDを組み立てる（2種類のID規則、本文コメント参照）。 */
function buildId(h) {
  if (h.recruitYear <= 2022) {
    return `${String(h.recruitYear).slice(2)}${String(h.no).padStart(2, '0')}`;
  }
  if (!h.birthDate) return null;
  const birthYear2 = h.birthDate.slice(2, 4);
  return `${birthYear2}${String(h.no).padStart(3, '0')}`;
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
  const cache = !args.includes('--no-cache');
  const maxYearIdx = args.indexOf('--max-year');
  const maxYear = maxYearIdx >= 0 ? Number(args[maxYearIdx + 1]) : 2024;
  const minYearIdx = args.indexOf('--min-year');
  const minYear = minYearIdx >= 0 ? Number(args[minYearIdx + 1]) : 2017;

  const recruitsPath = join(ROOT, 'analysis', 'data', 'recruits.json');
  const recruits = JSON.parse(readFileSync(recruitsPath, 'utf8'));
  const targets = recruits
    .filter((r) => r.recruitYear >= minYear && r.recruitYear <= maxYear)
    .slice(0, Number.isFinite(limit) ? limit : undefined);

  console.log(`対象 ${targets.length}頭（${minYear}〜${maxYear}年募集）`);

  const results = [];
  let sessionErrorCount = 0;
  let notFoundCount = 0;
  let birthMismatchCount = 0;
  let noIdCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const h = targets[i];
    const id = buildId(h);
    if (!id) {
      noIdCount++;
      results.push({ recruitYear: h.recruitYear, no: h.no, recruitName: h.name, ok: false, reason: 'no_birthdate_to_build_id' });
      continue;
    }
    const url = `https://carrotclub.net/horse/horse.asp?id=${id}`;
    process.stdout.write(`\r[${i + 1}/${targets.length}] ${h.recruitYear}年No.${h.no} ${h.name} (id=${id})`.padEnd(70));

    const { html } = await fetchShiftJis(url, { cache });
    const parsed = parseHorsePage(html);

    if (!parsed.ok) {
      if (parsed.reason === 'session_error') sessionErrorCount++;
      else notFoundCount++;
      results.push({ recruitYear: h.recruitYear, no: h.no, recruitName: h.name, id, url, ok: false, reason: parsed.reason });
      continue;
    }

    const birthDateMatches = parsed.birthDate && h.birthDate ? parsed.birthDate === h.birthDate : null;
    if (birthDateMatches === false) birthMismatchCount++;

    results.push({
      recruitYear: h.recruitYear,
      no: h.no,
      recruitName: h.name,
      carrotclubName: parsed.name,
      id,
      url,
      ok: true,
      birthDateMatches,
      shareCount: parsed.shareCount,
      totalPriceManYen: parsed.totalPriceManYen,
      pricePerShareYen: parsed.pricePerShareYen,
      pricePerShareManYen: parsed.pricePerShareYen != null ? parsed.pricePerShareYen / 10000 : null,
      carrotclubBirthDate: parsed.birthDate,
      recruitsBirthDate: h.birthDate,
      netkeibaPricePerShare: h.pricePerShare,
    });
  }
  console.log();

  const outPath = join(ROOT, 'analysis', 'data', 'carrotclub-prices.json');
  const prevData = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : { results: [] };
  const prevByKey = new Map(prevData.results.map((r) => [`${r.recruitYear}-${r.no}`, r]));
  const targetKeys = new Set(targets.map((t) => `${t.recruitYear}-${t.no}`));
  const untouched = prevData.results.filter((r) => !targetKeys.has(`${r.recruitYear}-${r.no}`));
  const merged = [...results, ...untouched];
  writeFileSync(outPath, JSON.stringify({ fetchedAt: new Date().toISOString(), results: merged }, null, 2) + '\n');

  console.log(`\n合計 ${results.length}/${targets.length}頭 を ${outPath} に書き出しました（対象外${untouched.length}頭は旧データ保持）`);
  console.log(`  セッションエラー（会員専用ページ扱い）: ${sessionErrorCount}件`);
  console.log(`  ページ見つからず（IDが外れている可能性）: ${notFoundCount}件`);
  console.log(`  生年月日無しでID構築不可: ${noIdCount}件`);
  console.log(`  生年月日不一致（ID規則のずれの可能性・要手動確認）: ${birthMismatchCount}件`);

  const ok = results.filter((r) => r.ok);
  const mismatched = ok.filter((r) => r.birthDateMatches === false);
  if (mismatched.length > 0) {
    console.log('\n生年月日不一致の詳細:');
    for (const m of mismatched) {
      console.log(
        `  - ${m.recruitYear}年No.${m.no}: recruits="${m.recruitName}"(${m.recruitsBirthDate}) / carrotclub="${m.carrotclubName}"(${m.carrotclubBirthDate}) (id=${m.id})`
      );
    }
  }
  const notFoundList = results.filter((r) => !r.ok);
  if (notFoundList.length > 0) {
    console.log('\nページ取得不可・ID構築不可の詳細:');
    for (const m of notFoundList) {
      console.log(`  - ${m.recruitYear}年No.${m.no} ${m.recruitName}: ${m.reason}${m.id ? ' (id=' + m.id + ')' : ''}`);
    }
  }

  // netkeiba由来価格との突合（生年月日が一致した頭のみ対象）
  const verified = ok.filter((r) => r.birthDateMatches);
  const bothHavePrice = verified.filter((r) => r.netkeibaPricePerShare != null && r.pricePerShareManYen != null);
  const priceDiffers = bothHavePrice.filter((r) => r.netkeibaPricePerShare !== r.pricePerShareManYen);
  console.log(`\nnetkeiba由来価格との突合（生年月日一致${verified.length}頭中、両方に値がある${bothHavePrice.length}頭）: 食い違い${priceDiffers.length}頭`);
  if (priceDiffers.length > 0) {
    for (const d of priceDiffers) {
      console.log(`  - ${d.recruitYear}年No.${d.no} ${d.recruitName}: netkeiba=${d.netkeibaPricePerShare}万円 / carrotclub公式=${d.pricePerShareManYen}万円`);
    }
  }

  const newlyFilled = verified.filter((r) => r.netkeibaPricePerShare == null && r.pricePerShareManYen != null);
  console.log(`\nnetkeiba側が欠測で公式ページから新たに埋まった頭数: ${newlyFilled.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
