/**
 * `analysis/data/carrot-horse-names.tsv`（キャロ公式「馬名一覧」`bamei-list.asp?y=<生年>`から
 * 取得した1994〜2024年産2085頭。列: birthYear,no,clubId,recruitName,name,nameAlpha,language,meaning）を
 * Viteでimportできる `analysis/data/carrot-horse-names.json` に変換する。
 *
 * 取得手順・出所の詳細は vault: `1-projects/carrot-club/notes/20260916-carrot-bamei-list-fetch.md`。
 *
 * 使い方: node scripts/convert-horse-names.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'analysis', 'data', 'carrot-horse-names.tsv');
const OUT = join(ROOT, 'analysis', 'data', 'carrot-horse-names.json');

const EXPECTED_HEADER = [
  'birthYear',
  'no',
  'clubId',
  'recruitName',
  'name',
  'nameAlpha',
  'language',
  'meaning',
];

const raw = readFileSync(SRC, 'utf8');
const lines = raw.split('\n').filter((l) => l.trim() !== '');
if (lines.length === 0) {
  throw new Error(`${SRC} が空`);
}

const header = lines[0].split('\t');
if (header.join(',') !== EXPECTED_HEADER.join(',')) {
  throw new Error(
    `列構成が想定と違う。想定: ${EXPECTED_HEADER.join(',')} / 実際: ${header.join(',')}`
  );
}

const horses = lines.slice(1).map((line, i) => {
  const cols = line.split('\t');
  if (cols.length !== EXPECTED_HEADER.length) {
    throw new Error(`${i + 2}行目の列数が想定(${EXPECTED_HEADER.length})と違う（${cols.length}列）: ${line}`);
  }
  const [birthYear, no, clubId, recruitName, name, nameAlpha, language, meaning] = cols;
  const birthYearNum = Number(birthYear);
  if (!Number.isInteger(birthYearNum)) {
    throw new Error(`${i + 2}行目のbirthYearが数値でない: ${birthYear}`);
  }
  return { birthYear: birthYearNum, no, clubId, recruitName, name, nameAlpha, language, meaning };
});

const out = {
  fetchedAt: '2026-09-16',
  source: 'https://carrotclub.net/horse/bamei-list.asp?y=<生年>（会員ログイン要）',
  horses,
};

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${horses.length} horses (birthYear ${horses[0].birthYear}〜${horses[horses.length - 1].birthYear}) to ${OUT}`);
