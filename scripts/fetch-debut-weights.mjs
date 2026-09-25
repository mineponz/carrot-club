/**
 * `analysis/data/recruits.json`（2017〜2022年募集・netkeibaUrlがある馬）について、
 * netkeibaの「1走ごとの詳細戦績」ajaxエンドポイントから初出走（デビュー戦）の
 * 日付・競馬場・中央/地方の別・レース名・馬体重を取得し、`analysis/data/debut-weights.json`
 * に書き出す。
 *
 * 使い方:
 *   node scripts/fetch-debut-weights.mjs
 *   node scripts/fetch-debut-weights.mjs --limit 5      # 動作確認用
 *   node scripts/fetch-debut-weights.mjs --no-cache
 *
 * ## どこから取るか（scripts/fetch-my-horse-races.mjsと同じ出所）
 * デスクトップ版の個体ページ（`db.netkeiba.com/horse/<id>/`）は競走成績をJSで後読みしており、
 * その後読み先 `db.netkeiba.com/horse/ajax_horse_results.html?input=UTF-8&output=json&id=<id>`
 * が1頭1リクエストで全戦績の詳細表（33列・馬体重を含む）をJSONで返す。日付降順で並ぶので
 * 配列の最後の行が最古＝デビュー戦になる（2026-09-25に実データで確認）。
 * `.cache/netkeiba-sp/` にURLのSHA1ハッシュでキャッシュする（fetch-my-horse-races.mjsと共用）。
 *
 * ## 事前にrace-results.jsonで出走の有無を絞り込む
 * このスクリプトが対象にする2017〜2022年募集は成績が固まった世代（現役で新たにデビューする
 * ことはない）なので、`race-results.json`のstartsが0の馬（未出走）はnetkeibaへ問い合わせずに
 * スキップする。無駄なリクエストを避けるため。
 *
 * ## 中央/地方の判定
 * デビュー戦の開催地名がJRA10場（中山・東京・阪神・京都・中京・新潟・福島・小倉・札幌・函館）に
 * 含まれるかで判定する（fetch-my-horse-races.mjsのJRA判定と同じ配列）。
 *
 * ## 馬体重が取れないケース
 * 馬体重セル（33列中の29番目＝0基準28）が `NNN(+M)` 形式でなければ（例: "計不"・空欄）、weightKgはnullにして
 * 生のセル文字列を weightRaw に残す（理由を追えるように）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'netkeiba-sp');
const OUT = join(ROOT, 'analysis', 'data', 'debut-weights.json');
const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const MIN_INTERVAL_MS = 700;
const MAX_INTERVAL_MS = 1100;
const YEAR_FROM = 2017;
const YEAR_TO = 2022;

const JRA = ['中山', '東京', '阪神', '京都', '中京', '新潟', '福島', '小倉', '札幌', '函館'];

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
  if (cache && existsSync(cachePath)) {
    return { text: readFileSync(cachePath, 'utf-8'), fromCache: true };
  }
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await throttle();
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (cache) {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(cachePath, text);
      }
      return { text, fromCache: false };
    } catch (e) {
      lastError = e;
      console.warn(`  [warn] 取得失敗 (${attempt}/3) ${url}: ${e.message}`);
      await sleep(1500 * attempt);
    }
  }
  throw lastError;
}

const ajaxUrl = (id) =>
  `https://db.netkeiba.com/horse/ajax_horse_results.html?input=UTF-8&output=json&id=${id}`;

const strip = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const COL = { date: 0, venue: 1, raceName: 4, finish: 11, bodyWeight: 28 };

/** ajaxが返す詳細表（33列）を1走ずつ開いて、日付昇順（古い順）に並べ替えて返す。 */
function parseRacesOldestFirst(tableHtml) {
  const table = tableHtml.match(/<table[\s\S]*?<\/table>/)?.[0];
  if (!table) return [];
  const rows = [];
  for (const tr of table.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const tds = tr.match(/<td[^>]*>[\s\S]*?<\/td>/g);
    if (!tds || tds.length < 30) continue;
    const c = tds.map(strip);
    const bwRaw = c[COL.bodyWeight];
    const bw = bwRaw.match(/^(\d{3})\(([-+]?\d+)\)$/);
    const venueRaw = c[COL.venue];
    const venue = venueRaw.replace(/^\d+/, '').replace(/\d+$/, '') || null;
    // 出走取消（着順「取」）・競走除外（「除」）の行は走っていないので飛ばす。競走中止（「中」）は出走なので残す。
    // 着順が空欄の行（出走予定など）も飛ばす。これを拾うと、未出走の登録や取消をデビュー戦と取り違える
    // （ザダルは2歳新馬を取り消したあと3歳1月にデビューしている）。
    const finish = c[COL.finish];
    if (!finish || finish === '取' || finish === '除') continue;
    rows.push({
      date: c[COL.date] || null,
      venue,
      venueRaw,
      raceName: c[COL.raceName] || null,
      weightKg: bw ? Number(bw[1]) : null,
      weightDiff: bw ? Number(bw[2]) : null,
      weightRaw: bwRaw || null,
    });
  }
  // ajaxは新しい順に並んでいる。日付文字列（YYYY/MM/DD）はそのままソート可能。
  return rows.filter((r) => r.date).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
  const cache = !args.includes('--no-cache');

  const recruits = JSON.parse(readFileSync(join(ROOT, 'analysis', 'data', 'recruits.json'), 'utf-8'));
  const raceResults = JSON.parse(readFileSync(join(ROOT, 'analysis', 'data', 'race-results.json'), 'utf-8'));
  const byUrl = new Map(raceResults.results.map((r) => [r.netkeibaUrl, r]));

  const targetsAll = recruits.filter((h) => h.recruitYear >= YEAR_FROM && h.recruitYear <= YEAR_TO);
  const targets = targetsAll.slice(0, Number.isFinite(limit) ? limit : targetsAll.length);

  const results = [];
  let noUrlCount = 0;
  let unracedSkipped = 0;
  let noRaceResultEntry = 0;
  let fetchFailCount = 0;
  let cacheHits = 0;
  let noDebutRowCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const horse = targets[i];
    process.stdout.write(
      `\r[${i + 1}/${targets.length}] ${horse.recruitYear}年No.${horse.no} ${horse.name}`.padEnd(80),
    );
    if (!horse.netkeibaUrl) {
      noUrlCount++;
      continue;
    }
    const rr = byUrl.get(horse.netkeibaUrl);
    if (!rr) {
      noRaceResultEntry++;
      continue;
    }
    if ((rr.starts ?? 0) === 0) {
      unracedSkipped++;
      results.push({
        netkeibaUrl: horse.netkeibaUrl,
        recruitYear: horse.recruitYear,
        no: horse.no,
        starts: 0,
        debut: null,
        note: '未出走（race-results.jsonでstarts=0）',
      });
      continue;
    }
    const idMatch = horse.netkeibaUrl.match(/horse\/(\w+)\//);
    if (!idMatch) {
      noRaceResultEntry++;
      continue;
    }
    const id = idMatch[1];
    let text;
    try {
      const r = await fetchPage(ajaxUrl(id), { cache });
      text = r.text;
      if (r.fromCache) cacheHits++;
    } catch (e) {
      fetchFailCount++;
      console.warn(`\n  [warn] ajax取得失敗: ${horse.name} ${id}: ${e.message}`);
      results.push({
        netkeibaUrl: horse.netkeibaUrl,
        recruitYear: horse.recruitYear,
        no: horse.no,
        starts: rr.starts,
        debut: null,
        note: `ajax取得失敗: ${e.message}`,
      });
      continue;
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      fetchFailCount++;
      results.push({
        netkeibaUrl: horse.netkeibaUrl,
        recruitYear: horse.recruitYear,
        no: horse.no,
        starts: rr.starts,
        debut: null,
        note: 'ajaxレスポンスのJSONパース失敗',
      });
      continue;
    }
    if (json.status !== 'OK' || !json.data) {
      fetchFailCount++;
      results.push({
        netkeibaUrl: horse.netkeibaUrl,
        recruitYear: horse.recruitYear,
        no: horse.no,
        starts: rr.starts,
        debut: null,
        note: `ajax status=${json.status}`,
      });
      continue;
    }
    const races = parseRacesOldestFirst(json.data);
    if (races.length === 0) {
      noDebutRowCount++;
      results.push({
        netkeibaUrl: horse.netkeibaUrl,
        recruitYear: horse.recruitYear,
        no: horse.no,
        starts: rr.starts,
        debut: null,
        note: 'starts>0だが戦績表の行を抽出できなかった',
      });
      continue;
    }
    const first = races[0];
    const isChuo = first.venue ? JRA.includes(first.venue) : null;
    results.push({
      netkeibaUrl: horse.netkeibaUrl,
      recruitYear: horse.recruitYear,
      no: horse.no,
      starts: rr.starts,
      debut: {
        date: first.date,
        venue: first.venue,
        venueRaw: first.venueRaw,
        region: isChuo === null ? '不明' : isChuo ? '中央' : '地方',
        raceName: first.raceName,
        weightKg: first.weightKg,
        weightDiff: first.weightDiff,
        weightRaw: first.weightRaw,
      },
      note: first.weightKg === null ? `馬体重取得不可（表記: "${first.weightRaw}"）` : null,
    });
  }
  console.log();

  const outDir = join(ROOT, 'analysis', 'data');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        source:
          'db.netkeiba.com/horse/ajax_horse_results.html（1走ごとの詳細戦績、id指定・JSON）。' +
          'race-results.jsonでstarts=0の馬はnetkeibaへ問い合わせずに未出走として記録',
        note:
          'デビュー戦＝戦績表を日付昇順に並べた最初の行。馬体重が取れない場合はweightKg:null・' +
          'weightRawに生の表記を残す。中央/地方はJRA10場のリストで判定（venueがリストに無ければ地方）',
        yearFrom: YEAR_FROM,
        yearTo: YEAR_TO,
        results,
      },
      null,
      2,
    ) + '\n',
  );

  const withDebutWeight = results.filter((r) => r.debut && r.debut.weightKg !== null).length;
  const debutNoWeight = results.filter((r) => r.debut && r.debut.weightKg === null).length;
  const unraced = results.filter((r) => r.starts === 0).length;
  const failed = results.filter((r) => r.starts > 0 && !r.debut).length;
  console.log(`\n合計 ${results.length}/${targets.length}頭 を ${OUT} に書き出しました`);
  console.log(`  netkeibaUrl無し: ${noUrlCount} / race-results.jsonに無し: ${noRaceResultEntry}`);
  console.log(`  未出走(starts=0・未取得): ${unraced}`);
  console.log(`  デビュー戦の馬体重あり: ${withDebutWeight} / デビューしたが馬体重取れず: ${debutNoWeight} / 取得失敗: ${failed}`);
  console.log(`  キャッシュヒット: ${cacheHits}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
