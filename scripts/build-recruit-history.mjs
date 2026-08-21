/**
 * 過去5年（2021〜2025年募集）の募集馬スプレッドシートから客観データを取り込み、
 * `analysis/data/recruits.json` に正規化して書き出すスクリプト。
 *
 * 目的: 後続タスクで各馬のnetkeiba個体ページから中央/地方獲得賞金・勝ち数を取得し、
 * 体高・価格などとクロス集計する分析記事の土台データを作る。
 * サイト表示用の `src/data/horsesYYYY.ts`（Horse型）とは別物。こちらは分析用に
 * 年をまたいだ配列を1ファイルにまとめる。
 *
 * 使い方:
 *   node scripts/build-recruit-history.mjs
 *   node scripts/build-recruit-history.mjs --year 2023   # 1年分だけ確認したい時
 *
 * 個人の評価・メモ・進捗列は一切取り込まない（既存の convert-csv.mjs / fetch-2026-data.mjs
 * と同じ方針）。
 *
 * 年ごとの列レイアウトはバラバラ（列名・単位・netkeibaリンクの持ち方が年によって違う）。
 * 2026-08-21に元スプレッドシートをCSV/xlsxで直接ダウンロードして実物を確認して COLUMN_MAPS を
 * 作った（WebFetch経由のAI要約は列がズレて見えることがあるため、生データを直接パースしている）。
 *
 * 2021年のみ例外: netkeibaリンクがCSVにテキストとして出てこない。産駒名セルへの
 * 「リンクを挿入」（表示テキスト≠URL）で付与されているため、CSV/TSVエクスポートでは
 * リンク先が失われる。xlsxエクスポート+openpyxl（Node側に新規依存を足さないため一度だけ
 * ローカルでpythonを使って抽出）で `scripts/data/2021-netkeiba-links.json`（No.→URL）を
 * 作成済み。このスクリプトはそれを読み込んで結合する。
 *
 * 誕生日: 各年とも募集馬名が「〜のYY」「〜のYYYY」で終わり、募集年-1年生まれ
 * （例: 2025年募集 → 2024年生まれ）。これを使って月日表記をISO日付に正規化する。
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- CSV parser（convert-csv.mjsと同一）

/** RFC 4180 準拠の最小CSVパーサ。引用フィールド内の改行・カンマ・二重引用符に対応する。 */
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

// ---------------------------------------------------------------- 年ごとの列マップ（0-indexed）

const SHEETS = [
  {
    year: 2025,
    url: 'https://docs.google.com/spreadsheets/d/1BZ0LBzHPnxxSOURyyXRRpHKAd2eicuqrN73kIg5iB_Y/export?format=csv&gid=1306495133',
    col: {
      no: 0, name: 2, sex: 3, netkeibaUrl: 4, sire: 5, broodmareSire: 6, damAge: 7,
      birthDate: 8, stable: 9, pricePerShare: 10, height: 11, chestGirth: 12,
      caretGirth: 13, weight: 14, sibling: 15, damPriority: 18, surgery: 19, damUrl: 28,
    },
  },
  {
    year: 2024,
    url: 'https://docs.google.com/spreadsheets/d/1ttCmeE2pPBIwC4S7XdHt3tcMhjP-6k4jiJGJrU0onDM/export?format=csv',
    col: {
      no: 0, name: 2, netkeibaUrl: 3, sire: 4, broodmareSire: 5, sex: 6, coatColor: 7,
      damAge: 8, birthDate: 9, stable: 10, totalPrice: 11, pricePerShare: 12, height: 13,
      chestGirth: 14, caretGirth: 15, weight: 16, sibling: 17, damPriority: 20, surgery: 21,
      damUrl: 28,
    },
  },
  {
    year: 2023,
    url: 'https://docs.google.com/spreadsheets/d/1mHf_S_U9epDAlpH30akR4dkLi-9JGFSj2_apiuFtElQ/export?format=csv',
    col: {
      no: 0, name: 2, netkeibaUrl: 3, sire: 4, broodmareSire: 5, sex: 6, birthDate: 7,
      breedingFarm: 8, pricePerShare: 9, height: 10, chestGirth: 11, caretGirth: 12,
      weight: 13, stable: 16, sibling: 17, damPriority: 19, surgery: 20,
    },
  },
  {
    year: 2022,
    url: 'https://docs.google.com/spreadsheets/d/1-y33HYPe9yB7l8h1b-IYg4UHQu8Nvq1ub13aJMYqujw/export?format=csv&gid=0',
    col: {
      no: 0, name: 1, sire: 2, dam: 3, broodmareSire: 4, netkeibaUrl: 5, sex: 6,
      coatColor: 7, birthDate: 8, stable: 9, totalPrice: 10, pricePerShare: 11, height: 12,
      chestGirth: 13, caretGirth: 14, weight: 15, breedingFarm: 16,
    },
  },
  {
    year: 2021,
    url: 'https://docs.google.com/spreadsheets/d/12peritjTRHz7Qb0oFlN5o7RO0ORFLCAv-21ybG9kzOM/export?format=csv&gid=916480261',
    col: {
      no: 11, name: 13, sire: 15, broodmareSire: 16, sex: 17, stable: 18, birthDate: 19,
      breedingFarm: 20, height: 22, chestGirth: 23, caretGirth: 24, weight: 25,
      pricePerShare: 12,
    },
    // netkeibaリンクはCSVに含まれない（産駒名セルへの「リンク挿入」注釈のため）。
    // 別途 scripts/data/2021-netkeiba-links.json（No.→URL）から結合する。
    linkTableFile: '2021-netkeiba-links.json',
  },
];

// ---------------------------------------------------------------- 変換ヘルパー

function toNumberOrNull(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === '') return null;
  const value = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

/** "5/2" "2月17日" "1月19日" 等バラバラな月日表記を "YYYY-MM-DD" に正規化する。 */
function toIsoBirthDate(raw, birthYear, context) {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return null;
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})$/);
  const kanji = trimmed.match(/^(\d{1,2})月(\d{1,2})日$/);
  const m = slash ?? kanji;
  if (!m) {
    console.warn(`  [警告] 誕生日の形式が想定外 (${context}): ${JSON.stringify(raw)}`);
    return null;
  }
  const [, month, day] = m;
  return `${birthYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function cell(row, index) {
  if (index == null) return '';
  return (row[index] ?? '').trim();
}

/** 年によって「メス」「牝」表記が混在するため統一する。 */
function normalizeSex(raw) {
  if (raw === 'メス') return '牝';
  if (raw === 'オス') return '牡';
  return raw;
}

// ---------------------------------------------------------------- メイン処理

async function fetchCsv(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${url}`);
  return await res.text();
}

function loadLinkTable(fileName) {
  const path = join(ROOT, 'scripts', 'data', fileName);
  const entries = JSON.parse(readFileSync(path, 'utf8'));
  const byNo = new Map(entries.map((e) => [String(e.no), e.netkeibaUrl]));
  return byNo;
}

async function buildYear(sheet) {
  const csvText = await fetchCsv(sheet.url);
  const rows = parseCsv(csvText);
  const col = sheet.col;
  const linkTable = sheet.linkTableFile ? loadLinkTable(sheet.linkTableFile) : null;
  const birthYear = sheet.year - 1;

  const horses = rows
    .slice(1)
    .filter((row) => cell(row, col.name) !== '' && cell(row, col.no) !== '')
    .map((row) => {
      const no = cell(row, col.no);
      const netkeibaUrl = linkTable ? (linkTable.get(no) ?? null) : (cell(row, col.netkeibaUrl) || null);
      return {
        recruitYear: sheet.year,
        no,
        name: cell(row, col.name),
        sex: normalizeSex(cell(row, col.sex)) || null,
        netkeibaUrl,
        sire: cell(row, col.sire) || null,
        broodmareSire: cell(row, col.broodmareSire) || null,
        dam: cell(row, col.dam) || null,
        damAge: toNumberOrNull(cell(row, col.damAge)),
        birthDate: toIsoBirthDate(cell(row, col.birthDate), birthYear, `${sheet.year}年No.${no}`),
        stable: cell(row, col.stable) || null,
        breedingFarm: cell(row, col.breedingFarm) || null,
        coatColor: cell(row, col.coatColor) || null,
        pricePerShare: toNumberOrNull(cell(row, col.pricePerShare)),
        totalPrice: toNumberOrNull(cell(row, col.totalPrice)),
        height: toNumberOrNull(cell(row, col.height)),
        chestGirth: toNumberOrNull(cell(row, col.chestGirth)),
        caretGirth: toNumberOrNull(cell(row, col.caretGirth)),
        weight: toNumberOrNull(cell(row, col.weight)),
        sibling: cell(row, col.sibling) || null,
        damPriority: col.damPriority != null ? cell(row, col.damPriority) !== '' : null,
        surgery: col.surgery != null ? (cell(row, col.surgery) || null) : null,
        damUrl: col.damUrl != null ? (cell(row, col.damUrl) || null) : null,
      };
    });

  return horses;
}

async function main() {
  const args = process.argv.slice(2);
  const onlyYearIdx = args.indexOf('--year');
  const onlyYear = onlyYearIdx >= 0 ? Number(args[onlyYearIdx + 1]) : null;

  const targets = onlyYear ? SHEETS.filter((s) => s.year === onlyYear) : SHEETS;
  const all = [];
  for (const sheet of targets) {
    console.log(`--- ${sheet.year}年募集を取得中... ---`);
    const horses = await buildYear(sheet);
    const missingUrl = horses.filter((h) => !h.netkeibaUrl).length;
    const missingHeight = horses.filter((h) => h.height == null).length;
    const missingPrice = horses.filter((h) => h.pricePerShare == null).length;
    console.log(
      `  ${horses.length}頭 / netkeibaUrl欠損:${missingUrl} / 体高欠損:${missingHeight} / 価格欠損:${missingPrice}`
    );
    all.push(...horses);
  }

  if (onlyYear) {
    console.log(JSON.stringify(all, null, 2));
    return;
  }

  const outDir = join(ROOT, 'analysis', 'data');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'recruits.json');
  writeFileSync(outPath, JSON.stringify(all, null, 2) + '\n');
  console.log(`\n合計 ${all.length}頭 を ${outPath} に書き出しました`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
