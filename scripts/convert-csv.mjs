/**
 * 募集馬CSV → src/data/horses2025.ts 変換スクリプト（ビルド時の一回限りのツール）。
 *
 * 使い方:
 *   node scripts/convert-csv.mjs "~/Downloads/キャロット2025 - 募集馬確定リスト.csv"
 *
 * 元CSVには個人の評価・メモ・申し込み状況の列が含まれるため**リポジトリにコミットしない**。
 * このスクリプトは客観列だけを抜き出して `src/data/horses2025.ts` を生成する。
 *
 * 取り込む列（スプレッドシートの列記号）:
 *   A  No        → id（クラブの募集番号）
 *   C  募集馬名   → name
 *   D  性別       → sex
 *   E  netkeibaURL→ netkeibaUrl
 *   F  父         → sire
 *   G  母父       → broodmareSire
 *   H  母齢       → damAge
 *   I  誕生日     → birthDate（M/D 表記。2024年産のため 2024-MM-DD に正規化）
 *   J  厩舎       → stable
 *   K  一口       → pricePerShare（万円）
 *   L  体高(cm)   → height
 *   M  胸囲(cm)   → chestGirth
 *   N  管囲(cm)   → caretGirth
 *   O  馬体重(kg) → weight
 *   P  兄弟       → sibling
 *   S  母優       → damPriority（◯ / 空 の真偽値）
 *   T  手術       → surgery（複数行になりうる自由記述）
 *   AA X          → xSearchUrl
 *
 * 取り込まない列（個人の主観・進捗であり、他ユーザーに配るデータではない）:
 *   B 評価 / Q 動画再生 / R お気に入り / U ブログ / V ラストバブル /
 *   W 最終申し込み / Y 8-23評価 / Z 自分メモ / AC以降の当落メモ
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** RFC 4180 準拠の最小CSVパーサ。引用フィールド内の改行・カンマ・二重引用符に対応する。 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  // BOM を除去してから改行コードを LF に統一する
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

const COL = {
  no: 0,
  name: 2,
  sex: 3,
  netkeibaUrl: 4,
  sire: 5,
  broodmareSire: 6,
  damAge: 7,
  birthDate: 8,
  stable: 9,
  pricePerShare: 10,
  height: 11,
  chestGirth: 12,
  caretGirth: 13,
  weight: 14,
  sibling: 15,
  damPriority: 18,
  surgery: 19,
  xSearchUrl: 26,
};

/** 2024年産駒のため、"5/2" のような M/D 表記を 2024-05-02 に正規化する。 */
function toIsoBirthDate(raw) {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) throw new Error(`誕生日の形式が想定外: ${JSON.stringify(raw)}`);
  const [, month, day] = m;
  return `2024-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function toNumber(raw, label, id) {
  const value = Number(raw.replace(/,/g, '').trim());
  if (!Number.isFinite(value)) throw new Error(`${label} が数値でない (No.${id}): ${JSON.stringify(raw)}`);
  return value;
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('使い方: node scripts/convert-csv.mjs <CSVのパス>');
  process.exit(1);
}

const rows = parseCsv(readFileSync(csvPath, 'utf8'));
const cell = (row, index) => (row[index] ?? '').trim();

const horses = rows
  .slice(1)
  .filter((row) => cell(row, COL.name) !== '' && cell(row, COL.no) !== '')
  .map((row) => {
    const id = cell(row, COL.no);
    return {
      id,
      name: cell(row, COL.name),
      sex: cell(row, COL.sex),
      netkeibaUrl: cell(row, COL.netkeibaUrl),
      // 母馬のnetkeibaページ。2025年募集ぶんは元スプレッドシートに列が無いため常に空文字
      // （2026年版は scripts/fetch-2026-data.mjs が netkeiba から取得して埋めている）。
      damUrl: '',
      sire: cell(row, COL.sire),
      broodmareSire: cell(row, COL.broodmareSire),
      damAge: toNumber(cell(row, COL.damAge), '母齢', id),
      birthDate: toIsoBirthDate(cell(row, COL.birthDate)),
      stable: cell(row, COL.stable),
      pricePerShare: toNumber(cell(row, COL.pricePerShare), '一口', id),
      height: toNumber(cell(row, COL.height), '体高', id),
      chestGirth: toNumber(cell(row, COL.chestGirth), '胸囲', id),
      caretGirth: toNumber(cell(row, COL.caretGirth), '管囲', id),
      weight: toNumber(cell(row, COL.weight), '馬体重', id),
      sibling: cell(row, COL.sibling),
      damPriority: cell(row, COL.damPriority) !== '',
      surgery: cell(row, COL.surgery),
      xSearchUrl: cell(row, COL.xSearchUrl),
    };
  });

const sexes = new Set(horses.map((h) => h.sex));
for (const sex of sexes) {
  if (!['牡', '牝', 'セ'].includes(sex)) throw new Error(`性別が想定外: ${JSON.stringify(sex)}`);
}

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'horses2025.ts');
const body = `/**
 * 2025年募集馬の客観データ（${horses.length}頭）。
 *
 * このファイルは \`scripts/convert-csv.mjs\` が生成する。手で編集しない。
 * 元CSVは個人の評価・メモ列を含むためリポジトリにはコミットしていない。
 * 再生成: node scripts/convert-csv.mjs "<募集馬確定リストのCSV>"
 */
import type { Horse } from '../lib/horses.ts';

export const horses2025: Horse[] = ${JSON.stringify(horses, null, 2)};
`;

writeFileSync(outPath, body);
console.log(`${horses.length} 頭を ${outPath} に書き出しました`);
console.log('性別:', [...sexes].join(' / '));
console.log('母優あり:', horses.filter((h) => h.damPriority).length, '頭');
console.log('手術・既往の記載あり:', horses.filter((h) => h.surgery !== '').length, '頭');
