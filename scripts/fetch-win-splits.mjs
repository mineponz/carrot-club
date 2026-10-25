/**
 * `analysis/data/recruits.json` の各馬（既定: 募集年2017〜2024・netkeibaUrlあり）について、
 * netkeiba個体ページ（`/horse/<id>/`）とレース成績ページ（`/horse/result/<id>/`）の両方を
 * 取得し直し、`analysis/data/race-results.json` を更新する。
 *
 * `fetch-race-results.mjs`との違い: 個体ページの「通算成績」は中央・地方の合算値しか
 * 持たないため、勝ち上がり（JRA＝中央で1勝以上）の判定には使えない。レース成績ページの
 * 全レース行（開催場名入り）を1件ずつ中央/地方に分類して勝数を数え直す。
 *
 * 判定方法: 開催場セルの文字列（例 "2札幌4" "盛岡"）にJRA10場
 * （札幌/函館/福島/新潟/東京/中山/中京/京都/阪神/小倉）のいずれかの文字列を含むら中央、
 * 含まなければ地方（NAR）。JRAは開催回数・日目を前後に付けた表記になるため部分一致で判定する。
 * 地方の場名はこの10場の文字列を含まないことを実データで確認済み
 * （2026-10-22、コントラチェック=中央のみ5勝/ジーガスリッド・ダブルクラッチ=地方のみ/
 *   クリソベリル=中央3勝・地方5勝、の4頭でnetkeiba実ページと突合・一致）。
 *
 * 使い方:
 *   node scripts/fetch-win-splits.mjs                  # 既定: 募集年2017〜2024
 *   node scripts/fetch-win-splits.mjs --limit 5         # 動作確認用
 *   node scripts/fetch-win-splits.mjs --max-year 2024   # 上限年を変える
 *   node scripts/fetch-win-splits.mjs --no-cache        # キャッシュを使わず叩き直す
 *
 * netkeibaへのアクセスは`fetch-race-results.mjs`と同じ礼儀（700〜1100msウェイト、
 * `.cache/netkeiba/`にキャッシュ）。個体ページは**既定でキャッシュを無視**して毎回取り直す
 * （中央/地方の合算値・主な勝鞍は日々更新されるため）。成績ページは新規URLなのでキャッシュ通常運用。
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

const JRA_TRACKS = ['札幌', '函館', '福島', '新潟', '東京', '中山', '中京', '京都', '阪神', '小倉'];
const isChuoTrack = (track) => JRA_TRACKS.some((t) => track.includes(t));

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
  if (cache && existsSync(cachePath)) {
    return { html: readFileSync(cachePath, 'utf8'), fromCache: true };
  }
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

// ---------------------------------------------------------------- パース（個体ページ・fetch-race-results.mjsと同じロジック）

function normalizeToDesktopUrl(url) {
  return url.replace('db.sp.netkeiba.com', 'db.netkeiba.com');
}

function toYen10k(raw) {
  const trimmed = raw.trim();
  if (trimmed === '-' || trimmed === '') return null;
  const m = trimmed.match(/^(?:(\d+)億)?([\d,]*)万円$/);
  if (!m) return null;
  const oku = m[1] ? Number(m[1]) : 0;
  const man = m[2] ? Number(m[2].replace(/,/g, '')) : 0;
  return oku * 10000 + man;
}

function extractMainWins(cellHtml) {
  const wins = [];
  const re = /<a href="(?:https?:\/\/[^"\/]+)?\/race\/[^"]*"\s+title="([^"]+)"/g;
  let m;
  while ((m = re.exec(cellHtml))) {
    wins.push(m[1]);
  }
  return wins;
}

const GRADE_RE = /\((G1|G2|G3|Jpn1|Jpn2|Jpn3)\)/;
const KNOWN_UNGRADED_NAR_STAKES = new Set(['京浜盃']);

function parseHorsePage(html, url) {
  const chuoM = html.match(/獲得賞金\s*\(中央\)<\/th>\s*<td>\s*([^<]+?)\s*<\/td>/);
  const chihoM = html.match(/獲得賞金\s*\(地方\)<\/th>\s*<td>\s*([^<]+?)\s*<\/td>/);
  const recordM = html.match(
    /通算成績<\/th>\s*<td>(\d+)戦(\d+)勝\s*\[<a[^>]*>(\d+)-(\d+)-(\d+)-(\d+)<\/a>\]/
  );
  const nameM = html.match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/);
  const mainWinM = html.match(/主な勝鞍<\/th>\s*<td>([\s\S]*?)<\/td>/);
  const mainWins = mainWinM ? extractMainWins(mainWinM[1]) : [];
  const gradeWins = mainWins.filter((w) => GRADE_RE.test(w) || KNOWN_UNGRADED_NAR_STAKES.has(w));

  if (!chuoM && !chihoM && !recordM) {
    return { ok: false, url };
  }

  return {
    ok: true,
    url,
    name: nameM ? nameM[1] : null,
    chuoPrizeManYen: chuoM ? toYen10k(chuoM[1]) : null,
    chihoPrizeManYen: chihoM ? toYen10k(chihoM[1]) : null,
    starts: recordM ? Number(recordM[1]) : null,
    wins: recordM ? Number(recordM[2]) : null,
    seconds: recordM ? Number(recordM[4]) : null,
    thirds: recordM ? Number(recordM[5]) : null,
    others: recordM ? Number(recordM[6]) : null,
    mainWins,
    gradeWins,
  };
}

// ---------------------------------------------------------------- パース（レース成績ページ）

/** `/horse/result/<id>/` の戦績テーブルを新しい順の行配列として返す（古い順に直すのは呼び出し側）。*/
function parseResultTable(html) {
  const tbodyM = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbodyM) return { ok: false, rows: [] };
  const trs = tbodyM[1].split('<tr>').slice(1).map((s) => '<tr>' + s);
  const rows = [];
  for (const tr of trs) {
    const tds = [];
    const re = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let m;
    while ((m = re.exec(tr))) tds.push(m[1]);
    // 列数33が通常形（頭数/枠番/馬番/オッズ/人気/着順...の固定レイアウト）。
    // 大きく外れる行は中止・取消等でレース名セルすら無いことがあるためスキップしてログする。
    if (tds.length < 12) continue;
    const dateM = tds[0].match(/(\d{4})\/(\d{2})\/(\d{2})/);
    const track = tds[1].replace(/<[^>]+>/g, '').trim();
    const raceNameM = tds[4].match(/title="([^"]+)"/);
    const rankText = tds[11].replace(/<[^>]+>/g, '').trim();
    rows.push({
      date: dateM ? `${dateM[1]}-${dateM[2]}-${dateM[3]}` : null,
      track,
      raceName: raceNameM ? raceNameM[1] : tds[4].replace(/<[^>]+>/g, '').trim(),
      rank: /^\d+$/.test(rankText) ? Number(rankText) : null,
    });
  }
  return { ok: true, rows };
}

function monthsBetween(birthDateStr, dateStr) {
  const b = new Date(birthDateStr);
  const d = new Date(dateStr);
  let months = (d.getFullYear() - b.getFullYear()) * 12 + (d.getMonth() - b.getMonth());
  if (d.getDate() < b.getDate()) months -= 1;
  return months;
}

function computeWinSplit(rows, birthDate) {
  // rowsは新しい順→古い順（デビューから）に直す。
  const chrono = [...rows].reverse();
  let chuoWins = 0;
  let chihoWins = 0;
  let firstChuoWin = null;
  chrono.forEach((r, idx) => {
    if (r.rank !== 1) return;
    if (isChuoTrack(r.track)) {
      chuoWins++;
      if (!firstChuoWin) {
        const winYear = r.date ? Number(r.date.slice(0, 4)) : null;
        const birthYear = birthDate ? Number(birthDate.slice(0, 4)) : null;
        firstChuoWin = {
          date: r.date,
          track: r.track,
          raceName: r.raceName,
          startNumber: idx + 1,
          ageYears: winYear != null && birthYear != null ? winYear - birthYear : null,
          ageMonths: birthDate && r.date ? monthsBetween(birthDate, r.date) : null,
        };
      }
    } else {
      chihoWins++;
    }
  });
  return { chuoWins, chihoWins, firstChuoWin, totalRows: rows.length };
}

// ---------------------------------------------------------------- メイン処理

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
  const maxYearIdx = args.indexOf('--max-year');
  const maxYear = maxYearIdx >= 0 ? Number(args[maxYearIdx + 1]) : 2024;
  const cache = !args.includes('--no-cache');

  const recruitsPath = join(ROOT, 'analysis', 'data', 'recruits.json');
  const recruits = JSON.parse(readFileSync(recruitsPath, 'utf8'));
  const outPath = join(ROOT, 'analysis', 'data', 'race-results.json');
  const prevData = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : { results: [] };
  const prevByUrl = new Map(prevData.results.map((r) => [r.netkeibaUrl, r]));

  const targets = recruits
    .filter((r) => r.recruitYear <= maxYear && r.netkeibaUrl)
    .slice(0, Number.isFinite(limit) ? limit : undefined);

  console.log(`対象 ${targets.length}頭（募集年<=${maxYear}）`);

  const newResults = [];
  let failCount = 0;
  let mismatchCount = 0;
  const mismatches = [];
  let winsChangedCount = 0;
  const winsChangedByYear = {};

  for (let i = 0; i < targets.length; i++) {
    const horse = targets[i];
    const profileUrl = normalizeToDesktopUrl(horse.netkeibaUrl);
    const idM = profileUrl.match(/\/horse\/([^/]+)\/?$/);
    const horseId = idM ? idM[1] : null;
    process.stdout.write(
      `\r[${i + 1}/${targets.length}] ${horse.recruitYear}年No.${horse.no} ${horse.name}`.padEnd(80)
    );

    const { html: profileHtml } = await fetchEucJp(profileUrl, { cache: false });
    const parsed = parseHorsePage(profileHtml, profileUrl);
    if (!parsed.ok) {
      failCount++;
      console.warn(`\n  [warn] 個体ページのパース失敗: ${horse.name} ${profileUrl}`);
      continue;
    }

    let splitInfo = { chuoWins: null, chihoWins: null, firstChuoWin: null, totalRows: null };
    if (horseId) {
      const resultUrl = `https://db.netkeiba.com/horse/result/${horseId}/`;
      const { html: resultHtml } = await fetchEucJp(resultUrl, { cache });
      const { ok, rows } = parseResultTable(resultHtml);
      if (ok) {
        splitInfo = computeWinSplit(rows, horse.birthDate);
        if (splitInfo.totalRows !== parsed.starts) {
          mismatchCount++;
          mismatches.push({
            name: horse.name,
            recruitYear: horse.recruitYear,
            profileStarts: parsed.starts,
            resultTableRows: splitInfo.totalRows,
          });
        }
      } else {
        console.warn(`\n  [warn] 成績ページのパース失敗: ${horse.name} ${resultUrl}`);
      }
    }

    const prev = prevByUrl.get(horse.netkeibaUrl);
    if (prev && prev.wins !== parsed.wins) {
      winsChangedCount++;
      winsChangedByYear[horse.recruitYear] = (winsChangedByYear[horse.recruitYear] || 0) + 1;
    }

    newResults.push({
      netkeibaUrl: horse.netkeibaUrl,
      recruitYear: horse.recruitYear,
      no: horse.no,
      ...parsed,
      chuoWins: splitInfo.chuoWins,
      chihoWins: splitInfo.chihoWins,
      firstChuoWin: splitInfo.firstChuoWin,
    });
  }
  console.log();

  // 対象外（募集年>maxYear、または netkeibaUrl無し）は旧データをそのまま残す。
  const targetUrls = new Set(targets.map((t) => t.netkeibaUrl));
  const untouched = prevData.results.filter((r) => !targetUrls.has(r.netkeibaUrl));

  const merged = [...newResults, ...untouched];
  writeFileSync(
    outPath,
    JSON.stringify({ fetchedAt: new Date().toISOString(), results: merged }, null, 2) + '\n'
  );

  console.log(`\n合計 ${newResults.length}/${targets.length}頭 を更新し、${outPath} に書き出しました`);
  console.log(`  パース失敗: ${failCount}件`);
  console.log(`  成績ページの戦数と個体ページ'通算成績'戦数の不一致: ${mismatchCount}件`);
  if (mismatches.length > 0) console.log('  不一致詳細:', JSON.stringify(mismatches, null, 2));
  console.log(`  勝ち数が前回取得から変わった頭数: ${winsChangedCount}件`, winsChangedByYear);
  console.log(`  旧データのまま残した頭数（対象外）: ${untouched.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
