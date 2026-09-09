/**
 * 出資馬（`analysis/data/my-horses.json` の9頭）について、netkeibaの公開個体ページから
 *  - プロフィール（中央/地方獲得賞金・通算成績）
 *  - 1走ごとの結果（日付・開催・レース名・グレード・距離・着順・人気・騎手・斤量）
 * を取得して `analysis/data/my-horse-races.json` に書き出す。
 *
 * 使い方:
 *   node scripts/fetch-my-horse-races.mjs
 *   node scripts/fetch-my-horse-races.mjs --no-cache
 *
 * ## どこから取るか
 * デスクトップ版（`db.netkeiba.com/horse/<id>/`）は競走成績をJSで後読みする。その後読み先が
 * `db.netkeiba.com/horse/ajax_horse_results.html?input=UTF-8&output=json&id=<id>` で、
 * **1頭1リクエストで全戦績の詳細表**（33列・馬体重とレースごとの賞金を含む）が返る。
 * sp版の「簡易表示」は直近5走しか出ず、馬体重も賞金も無いのでこちらを使う。
 *  - プロフィール（父母・通算成績）… `db.sp.netkeiba.com/horse/<id>/`
 *  - 全戦績の詳細          … 上のajax
 *
 * ## 回収率はファンド在籍中の賞金だけで計算する
 * レースごとの賞金が取れるので、在籍中のぶんを1走ずつ足す（中央/地方の内訳による近似は不要）。
 * 地方移籍した馬（ヴィントシュティレ＝川崎/金沢、レイジングウェイブ＝門別/名古屋/金沢）は
 * ファンドが解散したあとも走り続けるが、その賞金は出資者に還元されない。全戦績で割ると
 * 回収率が過大になる（レイジングウェイブは6.0%と出るが、実際は中央4戦すべて着外で0%）。
 *
 * ただし**「地方＝移籍後」ではない**。ロックターミガンは栗東所属のまま大井・盛岡の交流重賞
 * （京浜盃・羽田盃・東京ダービー・不来方賞）を走っていて、地方6,100万は在籍中の賞金。
 * そこで「地方の**一般競走**を走ったか」で移籍を判定し、移籍した馬は中央賞金だけを
 * 出資者ぶんとして扱う（レース単位の賞金が取れないため、中央/地方の内訳で近似する）。
 *
 * ## 賞金はnetkeibaのDBの値を使う
 * オーナーズのマイホースはロックターミガンを1億766万と出すが、DBの個体ページは
 * 中央2,611万＋地方6,100万＝8,711万（2026-09-06時点）。地方重賞の直近ぶんの反映差と思われる。
 * サイト全体が `race-results.json`（同じDB由来）で統一されているので、こちらに揃える。
 *
 * ## なぜオーナーズページを使わないのか
 * `own.netkeiba.com` のマイホースは本人のログインが要る個人ページ。同じ内容は公開の個体ページ
 * から取れるので、公開サイトに載せるデータを個人ページ由来にしない。
 *
 * netkeibaへのアクセスは `scripts/fetch-race-results.mjs` と同じ礼儀（1リクエストごとに
 * 700〜1100msのウェイト、`.cache/netkeiba-sp/` にキャッシュして再実行時に叩き直さない）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'netkeiba-sp');
const OUT = join(ROOT, 'analysis', 'data', 'my-horse-races.json');
const HORSES = JSON.parse(readFileSync(join(ROOT, 'analysis', 'data', 'my-horses.json'), 'utf-8'));
const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const NO_CACHE = process.argv.includes('--no-cache');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

async function fetchPage(url) {
  const key = createHash('sha1').update(url).digest('hex');
  const cached = join(CACHE_DIR, `${key}.html`);
  if (!NO_CACHE && existsSync(cached)) return readFileSync(cached, 'utf-8');
  await sleep(700 + Math.floor(Math.random() * 400));
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const html = await res.text();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cached, html);
  return html;
}
const horseUrl = (id) => `https://db.sp.netkeiba.com/horse/${id}/`;
const ajaxUrl = (id) =>
  `https://db.netkeiba.com/horse/ajax_horse_results.html?input=UTF-8&output=json&id=${id}`;

const COL = {
  date: 0, venue: 1, weather: 2, raceNumber: 3, raceName: 4, headcount: 6, bracket: 7,
  horseNumber: 8, odds: 9, popularity: 10, finish: 11, jockey: 12, carriedWeight: 13,
  distance: 14, condition: 16, time: 18, margin: 19, passing: 25, pace: 26, last3f: 27,
  bodyWeight: 28, winner: 31, prize: 32,
};
const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** ajaxが返す詳細表（33列）を1走ずつに開く。列位置は `COL` に固定で持つ。 */
function parseRaces(tableHtml) {
  const table = tableHtml.match(/<table[\s\S]*?<\/table>/)?.[0];
  if (!table) return [];
  const races = [];
  for (const tr of table.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const tds = tr.match(/<td[^>]*>[\s\S]*?<\/td>/g);
    if (!tds || tds.length < 30) continue;
    const raceId = tr.match(/\/race\/(\d{12})\//)?.[1] ?? null;
    const c = tds.map(strip);
    // レース名は「不来方賞(JpnII)」のようにグレードが括弧で付く。
    // netkeibaの表記はローマ数字（GI / GII / GIII / JpnI…）。アラビア数字で書くと
    // 優駿牝馬(GI) や ラジオN杯京都2歳S(GIII) を取りこぼす（2026-09-10に判明）。
    // 括弧には地方の条件（C1・B2・1勝クラス等）も入るので、グレードだけを拾う。
    const nameRaw = c[COL.raceName];
    const grade = nameRaw.match(/\((G[I]{1,3}|Jpn[I]{1,3}|OP|L)\)\s*$/)?.[1] ?? null;
    // 馬体重は「552(+12)」。増減は別に持つ（体重推移のグラフで使う）。
    const bw = c[COL.bodyWeight].match(/^(\d{3})\(([-+]?\d+)\)$/);
    const finishRaw = c[COL.finish];
    races.push({
      raceId,
      date: c[COL.date] || null,
      venue: c[COL.venue].replace(/^\d+/, '').replace(/\d+$/, '') || null,
      weather: c[COL.weather] || null,
      raceNumber: num(c[COL.raceNumber]),
      raceName: grade ? nameRaw.replace(/\([^)]*\)\s*$/, '').trim() : nameRaw,
      grade,
      headcount: num(c[COL.headcount]),
      horseNumber: num(c[COL.horseNumber]),
      odds: num(c[COL.odds]),
      popularity: num(c[COL.popularity]),
      finish: /^\d+$/.test(finishRaw) ? Number(finishRaw) : finishRaw || null,
      jockey: c[COL.jockey] || null,
      carriedWeight: num(c[COL.carriedWeight]),
      course: c[COL.distance] || null,
      condition: c[COL.condition] || null,
      time: c[COL.time] || null,
      margin: c[COL.margin] || null,
      passing: c[COL.passing] || null,
      last3f: num(c[COL.last3f]),
      bodyWeight: bw ? Number(bw[1]) : null,
      bodyWeightDiff: bw ? Number(bw[2]) : null,
      winner: c[COL.winner] || null,
      prizeManYen: num(c[COL.prize]) ?? 0,
    });
  }
  return races;
}

/** プロフィール表から賞金と通算成績を取る。列見出しは `<th>`、値は次の `<td>`。 */
function parseProfile(html) {
  const pick = (label) => {
    const re = new RegExp(`<th[^>]*>${label}</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`);
    const m = html.match(re);
    return m ? strip(m[1]) : null;
  };
  const manYen = (s) => {
    if (!s) return 0;
    const oku = Number(s.match(/([\d.]+)億/)?.[1] ?? 0) * 10000;
    const man = Number(s.match(/([\d,]+)万/)?.[1]?.replace(/,/g, '') ?? 0);
    return oku + man;
  };
  // 追加募集の馬は recruits.json に載っていないので父も分からない。個体ページから取る。
  const dam = pick('母');
  return {
    sire: pick('父'),
    damName: dam?.replace(/\s*母父:.*$/, '').trim() || null,
    broodmareSire: dam?.match(/母父:\s*(.+)$/)?.[1]?.trim() ?? null,
    chuoPrizeManYen: manYen(pick('中央獲得賞金')),
    chihoPrizeManYen: manYen(pick('地方獲得賞金')),
    record: pick('通算成績'),
    mainWins: pick('主な勝ち鞍'),
  };
}

const results = [];
for (const h of HORSES) {
  process.stdout.write(`${h.name} (${h.horseId}) ... `);
  try {
    const prof = parseProfile(await fetchPage(horseUrl(h.horseId)));
    const ajax = JSON.parse(await fetchPage(ajaxUrl(h.horseId)));
    const races = ajax.status === 'OK' ? parseRaces(ajax.data) : [];
    const totalPrize = prof.chuoPrizeManYen + prof.chihoPrizeManYen;
    const JRA = ['中山', '東京', '阪神', '京都', '中京', '新潟', '福島', '小倉', '札幌', '函館'];
    const nar = races.filter((x) => x.venue && !JRA.includes(x.venue));
    // 地方の一般競走（グレード無し）を走っていたら移籍後の走りが混ざっている。
    const transferred = nar.some((x) => !x.grade);
    // レースごとの賞金があるので在籍中のぶんを1走ずつ足す（内訳による近似は不要になった）。
    // 移籍馬は「地方の一般競走を初めて走った日」以降がファンド解散後。表で線を引くのに使う。
    const firstPlainNar = nar.filter((x) => !x.grade).map((x) => x.date).sort()[0] ?? null;
    for (const x of races) x.inFund = !(transferred && firstPlainNar && x.date >= firstPlainNar);
    const ownerPrize = races.filter((x) => x.inFund).reduce((a, x) => a + x.prizeManYen, 0);
    results.push({
      ...h,
      ...prof,
      totalPrizeManYen: totalPrize,
      transferredToNar: transferred,
      /** 地方の一般競走を初めて走った日。これ以降の走りはファンド解散後（移籍馬のみ）。 */
      narDebutDate: transferred ? nar.filter((x) => !x.grade).map((x) => x.date).sort()[0] ?? null : null,
      /** ファンド在籍中に稼いだぶん（移籍馬は中央賞金のみ）。回収率の分子。 */
      ownerPrizeManYen: ownerPrize,
      // 回収率＝在籍中の賞金 ÷ 募集総額。netkeibaのマイホースと同じ式だが、向こうは
      // 出走手当込みの賞金を使うので数字は一致しない（式は同じ・出典が違う）。
      recoveryRatePct: h.offeringTotalManYen
        ? Math.round((1000 * ownerPrize) / h.offeringTotalManYen) / 10
        : null,
      races,
    });
    console.log(`${races.length}走 / 賞金${totalPrize}万`);
  } catch (e) {
    console.log(`FAILED: ${e.message}`);
    results.push({ ...h, error: String(e.message) });
  }
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      fetchedAt: new Date().toISOString(),
      source: 'db.sp.netkeiba.com/horse/<id>/（公開個体ページ・簡易表示）',
      note: 'タイム・着差・通過・上り・馬体重は個体ページのHTMLに含まれないため未取得。',
      results,
    },
    null,
    1,
  ) + '\n',
);
console.log(`\n→ ${OUT}`);
