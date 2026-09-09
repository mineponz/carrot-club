/**
 * 自分で撮った出資馬の写真を `~/Pictures/keiba/<馬名>/` から取り込む。
 *
 * 使い方:
 *   node scripts/import-my-photos.mjs            # 取り込み
 *   node scripts/import-my-photos.mjs --dry-run  # 何が起きるか見るだけ
 *
 * やること:
 *  1. `<馬名>/<日付>_<レース名><連番>.jpg` を読む
 *  2. ファイル名の日付から**成績データのレースを引き当てる**（±3日まで許容）
 *  3. `sips` で長辺1200pxに縮小して `public/my-horses/<slug>/` へ
 *  4. `analysis/data/my-horse-photos.json` の `own` を書き換える
 *
 * ## キャプションはファイル名ではなく成績データから作る
 * ファイル名の日付は間違っていることがある（実際にリバーバレイトの新馬戦が1日前、
 * ロックターミガンの芙蓉Sが1日後になっていた。本人確認済み・2026-09-09）。
 * レースに紐づけたうえで、日付・レース名・着順は `my-horse-races.json` の値を使う。
 * どのレースにも紐づかない写真は**黙って捨てず警告を出す**。
 *
 * ## macOSのファイル名はNFD
 * Finderが作るディレクトリ名は濁点が分離した NFD で入っている。データ側（NFC）と
 * そのまま比較すると全件外れるので、読み取ったら必ず NFC に正規化すること。
 *
 * ## 画像処理に依存を足さない
 * このリポジトリは playwright すら依存に入れない方針なので、縮小は macOS 標準の `sips` を使う。
 */
import { readdirSync, statSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { homedir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(homedir(), 'Pictures', 'keiba');
const PHOTOS_JSON = join(ROOT, 'analysis', 'data', 'my-horse-photos.json');
const DRY = process.argv.includes('--dry-run');
const MAX_PX = 1200;
/** ファイル名の日付がこの日数までズレていても同じレースとみなす。 */
const DATE_TOLERANCE_DAYS = 3;

const nfc = (s) => s.normalize('NFC');
const horses = JSON.parse(readFileSync(join(ROOT, 'analysis', 'data', 'my-horses.json'), 'utf-8'));
const races = JSON.parse(readFileSync(join(ROOT, 'analysis', 'data', 'my-horse-races.json'), 'utf-8')).results;
const photosFile = JSON.parse(readFileSync(PHOTOS_JSON, 'utf-8'));

const slugOf = new Map(horses.map((h) => [h.name, h.slug]));
const racesOf = new Map(races.map((r) => [r.name, r.races]));

/** `2024-3-9_未勝利` `25:1:4_新馬2` `2025_9_28_芙蓉ステークス1` を読む。 */
function parseName(file) {
  const base = nfc(file).normalize('NFKC').replace(extname(file), '');
  const m = base.match(/^(\d{2,4})[-_:](\d{1,2})[-_:](\d{1,2})[-_:]?(.*)$/);
  if (!m) return null;
  let [, y, mo, d, rest] = m;
  const year = Number(y) < 100 ? 2000 + Number(y) : Number(y);
  const seq = rest.match(/(\d+)$/)?.[1] ?? null;
  return {
    date: new Date(Date.UTC(year, Number(mo) - 1, Number(d))),
    label: rest.replace(/\d+$/, '').replace(/^[-_]/, ''),
    seq: seq ? Number(seq) : 1,
  };
}

const daysBetween = (a, b) => Math.round((a - b) / 86400000);

const own = {};
const warnings = [];
let copied = 0;
let bytes = 0;

for (const dir of readdirSync(SRC)) {
  const abs = join(SRC, dir);
  if (!statSync(abs).isDirectory()) continue;
  const name = nfc(dir);
  const slug = slugOf.get(name);
  if (!slug) {
    warnings.push(`馬「${name}」が my-horses.json に無い（フォルダ名の誤り？）`);
    continue;
  }
  const rs = racesOf.get(name) ?? [];
  const outDir = join(ROOT, 'public', 'my-horses', slug);
  if (!DRY) {
    if (existsSync(outDir)) rmSync(outDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });
  }

  const items = [];
  for (const file of readdirSync(abs).sort()) {
    if (file.startsWith('.')) continue;
    const parsed = parseName(file);
    if (!parsed) {
      warnings.push(`${name}/${nfc(file)}: 日付を読めない`);
      continue;
    }
    // 日付が最も近いレースを探す。許容日数を超えたら結び付けない。
    let best = null;
    for (const r of rs) {
      if (!r.date || !r.inFund) continue;
      const rd = new Date(`${r.date.replace(/\//g, '-')}T00:00:00Z`);
      const gap = Math.abs(daysBetween(rd, parsed.date));
      if (!best || gap < best.gap) best = { race: r, gap, iso: r.date.replace(/\//g, '-') };
    }
    if (!best || best.gap > DATE_TOLERANCE_DAYS) {
      warnings.push(
        `${name}/${nfc(file)}: 該当レースなし（ファイル名の日付 ${parsed.date.toISOString().slice(0, 10)}）`,
      );
      continue;
    }
    if (best.gap > 0) {
      warnings.push(
        `${name}/${nfc(file)}: ファイル名の日付が ${best.gap}日ズレ。レース側(${best.iso})を採用`,
      );
    }
    const outName = `${best.iso}-${String(parsed.seq).padStart(2, '0')}.jpg`;
    const outPath = join(outDir, outName);
    if (!DRY) {
      execFileSync('sips', ['-Z', String(MAX_PX), '--setProperty', 'format', 'jpeg', join(abs, file), '--out', outPath], {
        stdio: 'ignore',
      });
      bytes += statSync(outPath).size;
    }
    copied++;
    items.push({
      file: outName,
      date: best.iso,
      raceName: best.race.raceName,
      grade: best.race.grade,
      venue: best.race.venue,
      finish: best.race.finish,
    });
  }
  if (items.length) {
    items.sort((a, b) => (a.date === b.date ? a.file.localeCompare(b.file) : a.date < b.date ? 1 : -1));
    own[slug] = items;
  }
}

if (!DRY) {
  photosFile.own = own;
  photosFile.ownFetchedAt = new Date().toISOString();
  writeFileSync(PHOTOS_JSON, JSON.stringify(photosFile, null, 1) + '\n');
}

console.log(`${DRY ? '[dry-run] ' : ''}${copied}枚 / ${Object.keys(own).length}頭` + (bytes ? ` / ${(bytes / 1024 / 1024).toFixed(1)}MB` : ''));
for (const [slug, list] of Object.entries(own)) {
  console.log(`  ${slug}: ${list.length}枚  ${list.map((i) => `${i.date} ${i.raceName}(${i.finish}着)`).join(' / ')}`);
}
if (warnings.length) {
  console.log('\n⚠ 確認が要るもの:');
  for (const w of warnings) console.log(`  - ${w}`);
}
