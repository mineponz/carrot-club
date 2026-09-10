/**
 * 出資馬の募集時の馬体写真をクラブから取り込む。
 *
 * 使い方:
 *   node scripts/fetch-recruit-photos.mjs
 *   node scripts/fetch-recruit-photos.mjs --force   # 既にあっても取り直す
 *
 * `analysis/data/my-horse-photos.json` の `photos`（クラブ側のファイル名）を見て
 * `carrotclub.net/upfile/<clubId>/<file>` から落とし、`sips` で幅720pxに縮めて
 * `public/my-horses/<slug>/recruit.jpg` に置く。寸法もJSONに書き戻す。
 *
 * ## なぜホットリンクをやめたか
 *  - 一覧に出していた `/upfile/<id>/mob/<file>` は **238×166px** しかなく、
 *    300px幅のカードに対して小さすぎてぼやける（2026-09-10に実測）。
 *  - 原寸は960×672だが1枚380KB前後あり、9枚並ぶ一覧では重い。
 *  - そもそも `bd-<code>.jpg` は募集年を過ぎると消える。クラブ側の都合で
 *    リンク切れになる作りにしておかない。
 * 手元に置いて必要なサイズに縮めるのが一番素直だった。転載はクラブの許可の範囲内
 * （本人確認済み・2026-09-09。サイトのヘッダーにも明記している）。
 *
 * ## 縦横比は9頭とも 1.42〜1.43（960×670〜674）
 * カード側は `aspect-ratio: 10 / 7` を指定しておけば、切り取らずに全身が収まる。
 * 顔が切れるのは cover で高さを固定していたのが原因だった。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PHOTOS_JSON = join(ROOT, 'analysis', 'data', 'my-horse-photos.json');
const FORCE = process.argv.includes('--force');
const WIDTH = 720;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const file = JSON.parse(readFileSync(PHOTOS_JSON, 'utf-8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let done = 0;
let bytes = 0;
for (const [slug, p] of Object.entries(file.photos)) {
  const outDir = join(ROOT, 'public', 'my-horses', slug);
  const outPath = join(outDir, 'recruit.jpg');
  if (!FORCE && existsSync(outPath)) {
    bytes += statSync(outPath).size;
    done++;
    continue;
  }
  const url = `https://carrotclub.net/upfile/${p.clubId}/${p.file}`;
  process.stdout.write(`${slug} ... `);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    console.log(`FAILED ${res.status}`);
    continue;
  }
  mkdirSync(outDir, { recursive: true });
  const tmp = join(outDir, '.recruit-src');
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  execFileSync('sips', ['-Z', String(WIDTH), '--setProperty', 'format', 'jpeg', tmp, '--out', outPath], {
    stdio: 'ignore',
  });
  unlinkSync(tmp);
  const info = execFileSync('sips', ['--getProperty', 'pixelWidth', '--getProperty', 'pixelHeight', outPath], {
    encoding: 'utf-8',
  });
  p.localFile = 'recruit.jpg';
  p.width = Number(info.match(/pixelWidth:\s*(\d+)/)?.[1]) || null;
  p.height = Number(info.match(/pixelHeight:\s*(\d+)/)?.[1]) || null;
  const size = statSync(outPath).size;
  bytes += size;
  done++;
  console.log(`${p.width}x${p.height} / ${Math.round(size / 1024)}KB`);
  await sleep(700 + Math.floor(Math.random() * 300));
}

writeFileSync(PHOTOS_JSON, JSON.stringify(file, null, 1) + '\n');
console.log(`\n${done}頭 / 計 ${(bytes / 1024 / 1024).toFixed(1)}MB`);
