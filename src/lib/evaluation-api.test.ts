import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANON_ID_HEADER,
  RATINGS,
  buildSubmissionBody,
  emptyRatingCounts,
  isRating,
  isValidAnonId,
  isValidHorseId,
  isValidYear,
  parseSubmissionBody,
  parseSummaryResponse,
  summarizeRows,
  summaryUrlForYear,
  totalOf,
  type SummaryRow,
} from './evaluation-api.ts';

const VALID_ANON_ID = '2f8a1c3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';

// ---- 送るものを絞る（この層の一番の仕事） ----------------------------------

test('buildSubmissionBody: horseId / year / rating の3キーしか作らない', () => {
  const body = buildSubmissionBody('12', 2026, 'A');
  assert.deepEqual(Object.keys(body).sort(), ['horseId', 'rating', 'year']);
});

test('parseSubmissionBody: メモ・お気に入り・消が混ざっていても取り込まない', () => {
  const result = parseSubmissionBody({
    horseId: '12',
    year: 2026,
    rating: 'A',
    // 送られてきても保存する経路が無いことを保証する
    memo: '脚元に不安あり。息子の誕生日に見に行った',
    favorite: true,
    skip: true,
    anonId: 'なりすまし用',
  });
  assert.equal(result.ok, true);
  assert(result.ok);
  assert.deepEqual(result.value, { horseId: '12', year: 2026, rating: 'A' });
  assert.deepEqual(Object.keys(result.value).sort(), ['horseId', 'rating', 'year']);
});

test('parseSubmissionBody: rating が null / 未指定 / 空文字 なら null（評価の取り消し）', () => {
  for (const rating of [null, undefined, '']) {
    const result = parseSubmissionBody({ horseId: '1', year: 2026, rating });
    assert(result.ok, `rating=${String(rating)} が通らない`);
    assert.equal(result.value.rating, null);
  }
});

test('parseSubmissionBody: 不正な入力は理由付きで弾く', () => {
  const cases: [unknown, string][] = [
    [null, 'body must be a JSON object'],
    ['{}', 'body must be a JSON object'],
    [[], 'body must be a JSON object'],
    [{ year: 2026, rating: 'A' }, 'invalid horseId'],
    [{ horseId: '1'.repeat(64), year: 2026, rating: 'A' }, 'invalid horseId'],
    [{ horseId: '../etc/passwd', year: 2026, rating: 'A' }, 'invalid horseId'],
    [{ horseId: '1', year: '2026', rating: 'A' }, 'invalid year'],
    [{ horseId: '1', year: 1999, rating: 'A' }, 'invalid year'],
    [{ horseId: '1', year: 2026, rating: 'S' }, 'invalid rating'],
    [{ horseId: '1', year: 2026, rating: 3 }, 'invalid rating'],
  ];
  for (const [input, expected] of cases) {
    const result = parseSubmissionBody(input);
    assert.equal(result.ok, false, `通ってはいけない入力が通った: ${JSON.stringify(input)}`);
    assert(!result.ok);
    assert.equal(result.error, expected);
  }
});

// ---- 検証まわり ------------------------------------------------------------

test('isValidAnonId: crypto.randomUUID() の形式だけを受け付ける', () => {
  assert.equal(isValidAnonId(VALID_ANON_ID), true);
  assert.equal(isValidAnonId('member-12345'), false);
  assert.equal(isValidAnonId(VALID_ANON_ID.toUpperCase()), false);
  assert.equal(isValidAnonId(''), false);
  assert.equal(isValidAnonId(undefined), false);
});

test('isValidHorseId: 募集番号の形だけ通す', () => {
  assert.equal(isValidHorseId('1'), true);
  assert.equal(isValidHorseId('94'), true);
  assert.equal(isValidHorseId(''), false);
  assert.equal(isValidHorseId('1 OR 1=1'), false);
  assert.equal(isValidHorseId(12), false);
});

test('isValidYear: 募集年として妥当な整数だけ通す', () => {
  assert.equal(isValidYear(2026), true);
  assert.equal(isValidYear(2026.5), false);
  assert.equal(isValidYear(NaN), false);
  assert.equal(isValidYear('2026'), false);
});

test('isRating: A〜E以外は評価として扱わない', () => {
  for (const r of RATINGS) assert.equal(isRating(r), true);
  assert.equal(isRating('F'), false);
  assert.equal(isRating('a'), false);
  assert.equal(isRating(null), false);
});

// ---- 集計 ------------------------------------------------------------------

test('summarizeRows: 馬IDごとにA〜Eの件数へ畳む', () => {
  const rows: SummaryRow[] = [
    { horse_id: '1', rating: 'A', count: 3 },
    { horse_id: '1', rating: 'C', count: 1 },
    { horse_id: '7', rating: 'E', count: 2 },
  ];
  assert.deepEqual(summarizeRows(rows), {
    '1': { A: 3, B: 0, C: 1, D: 0, E: 0 },
    '7': { A: 0, B: 0, C: 0, D: 0, E: 2 },
  });
});

test('summarizeRows: 1票も無い馬はキーを作らない（全頭ぶんのゼロを返さない）', () => {
  assert.deepEqual(summarizeRows([]), {});
});

test('summarizeRows: A〜E以外のratingが紛れ込んでも無視する', () => {
  const rows: SummaryRow[] = [
    { horse_id: '1', rating: 'A', count: 1 },
    { horse_id: '1', rating: 'S', count: 99 },
  ];
  assert.deepEqual(summarizeRows(rows), { '1': { A: 1, B: 0, C: 0, D: 0, E: 0 } });
});

test('totalOf: A〜Eの合計票数', () => {
  assert.equal(totalOf({ A: 1, B: 2, C: 0, D: 0, E: 3 }), 6);
  assert.equal(totalOf(emptyRatingCounts()), 0);
});

// ---- レスポンスの読み取り（壊れていても落ちない） --------------------------

test('parseSummaryResponse: 正常なレスポンスを読む', () => {
  const parsed = parseSummaryResponse({ year: 2026, summary: { '3': { A: 2, B: 1 } } });
  assert.deepEqual(parsed, { '3': { A: 2, B: 1, C: 0, D: 0, E: 0 } });
});

test('parseSummaryResponse: 壊れていても例外を投げず空を返す', () => {
  for (const input of [null, undefined, 'ok', 42, {}, { summary: null }, { summary: [] }]) {
    assert.deepEqual(parseSummaryResponse(input), {});
  }
});

test('parseSummaryResponse: 数値でない件数・0件・マイナスは捨てる', () => {
  const parsed = parseSummaryResponse({
    summary: { '1': { A: '5', B: 0, C: -3 }, '2': { A: 1 } },
  });
  // '1' はどの評価も有効な件数を持たないのでキーごと落ちる
  assert.deepEqual(parsed, { '2': { A: 1, B: 0, C: 0, D: 0, E: 0 } });
});

// ---- URL / ヘッダ ----------------------------------------------------------

test('summaryUrlForYear: 年度をクエリに付ける', () => {
  assert.equal(summaryUrlForYear(2026), '/api/evaluations/summary?year=2026');
});

test('ANON_ID_HEADER: 匿名IDはbodyではなくヘッダで送る', () => {
  assert.equal(ANON_ID_HEADER, 'X-Anon-Id');
});
