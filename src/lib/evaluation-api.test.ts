import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANON_ID_HEADER,
  MAX_MEMO_LENGTH,
  MINE_API_PATH,
  RATINGS,
  buildSubmissionBody,
  emptyRatingCounts,
  isRating,
  isValidAnonId,
  isValidHorseId,
  isValidYear,
  mergeEvaluationMaps,
  mineUrlForYear,
  parseMineResponse,
  parseSubmissionBody,
  parseSummaryResponse,
  personalFieldsOf,
  rowsToEvaluationMap,
  summarizeRows,
  summaryUrlForYear,
  totalOf,
  type MineRow,
  type SummaryRow,
} from './evaluation-api.ts';
import type { Evaluation } from './evaluations.ts';

const VALID_ANON_ID = '2f8a1c3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';

const MEMO = '脚元に不安あり。息子の誕生日に見に行った';

// ---- 送るものを絞る（この層の一番の仕事） ----------------------------------

test('buildSubmissionBody: 本人専用の項目を渡さなければ rating しか作らない', () => {
  const body = buildSubmissionBody('12', 2026, 'A');
  assert.deepEqual(Object.keys(body).sort(), ['horseId', 'rating', 'year']);
});

test('buildSubmissionBody: 渡した3項目だけを明示的に写す（オブジェクトを丸写ししない）', () => {
  const evaluation = {
    rating: 'A',
    favorite: true,
    skip: false,
    memo: MEMO,
    // 将来 Evaluation に項目が増えても、ここを直さない限り送信対象にならないことを担保する
    secret: '送ってはいけない値',
  } as unknown as Evaluation;
  const body = buildSubmissionBody('12', 2026, 'A', personalFieldsOf(evaluation));
  assert.deepEqual(Object.keys(body).sort(), ['favorite', 'horseId', 'memo', 'rating', 'skip', 'year']);
  assert.equal(body.memo, MEMO);
  assert.equal(body.favorite, true);
  assert.equal(body.skip, false);
});

test('parseSubmissionBody: 未指定の memo / favorite / skip はキーごと作らない（＝変更しない）', () => {
  const result = parseSubmissionBody({ horseId: '12', year: 2026, rating: 'A' });
  assert(result.ok);
  assert.deepEqual(Object.keys(result.value).sort(), ['horseId', 'rating', 'year']);
});

test('parseSubmissionBody: 既知のキーだけを読む（anonId は body から取らない）', () => {
  const result = parseSubmissionBody({
    horseId: '12',
    year: 2026,
    rating: 'A',
    memo: MEMO,
    favorite: true,
    skip: true,
    // 匿名IDはヘッダでしか受け取らない。bodyに紛れ込ませても無視される
    anonId: 'なりすまし用',
  });
  assert(result.ok);
  assert.deepEqual(result.value, {
    horseId: '12',
    year: 2026,
    rating: 'A',
    memo: MEMO,
    favorite: true,
    skip: true,
  });
});

test('parseSubmissionBody: 空文字のメモは「消した」として受け取る（未指定と区別する）', () => {
  const result = parseSubmissionBody({ horseId: '12', year: 2026, rating: null, memo: '' });
  assert(result.ok);
  assert.equal(result.value.memo, '');
});

test('parseSubmissionBody: 本人専用の項目も型と長さを検証する', () => {
  const cases: [unknown, string][] = [
    [{ horseId: '1', year: 2026, rating: 'A', memo: 123 }, 'invalid memo'],
    [{ horseId: '1', year: 2026, rating: 'A', memo: 'あ'.repeat(MAX_MEMO_LENGTH + 1) }, 'memo too long'],
    [{ horseId: '1', year: 2026, rating: 'A', favorite: 'true' }, 'invalid favorite'],
    [{ horseId: '1', year: 2026, rating: 'A', skip: 1 }, 'invalid skip'],
  ];
  for (const [input, expected] of cases) {
    const result = parseSubmissionBody(input);
    assert(!result.ok, `通ってはいけない入力が通った: ${JSON.stringify(input).slice(0, 60)}`);
    assert.equal(result.error, expected);
  }
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
    '1': { A: 3, B: 0, C: 1, D: 0, E: 0, skip: 0 },
    '7': { A: 0, B: 0, C: 0, D: 0, E: 2, skip: 0 },
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
  assert.deepEqual(summarizeRows(rows), { '1': { A: 1, B: 0, C: 0, D: 0, E: 0, skip: 0 } });
});

// ---- 消（skip）の集計 ------------------------------------------------------
//
// 2026-09-01追加。「消だけ付けた馬」は rating が NULL なので、rating しか数えていなかった
// 頃は**まだ誰も見ていない馬と区別できなかった**（本人の指摘「消だけというのは
// なんならEより下」）。

test('summarizeRows: 消だけ付いた馬（ratingがNULL）も集計に現れる', () => {
  const rows: SummaryRow[] = [{ horse_id: '9', rating: null, count: 4, skip_count: 4 }];
  // count(=4) は捨てる。★やメモだけ付けた人数まで漏らさないよう、出すのは消の件数だけ
  assert.deepEqual(summarizeRows(rows), { '9': { A: 0, B: 0, C: 0, D: 0, E: 0, skip: 4 } });
});

test('summarizeRows: 「Dかつ消」はA〜Eと消の両方に立てる（片方へ繰り込まない）', () => {
  const rows: SummaryRow[] = [
    { horse_id: '5', rating: 'D', count: 3, skip_count: 2 },
    { horse_id: '5', rating: null, count: 1, skip_count: 1 },
  ];
  assert.deepEqual(summarizeRows(rows), { '5': { A: 0, B: 0, C: 0, D: 3, E: 0, skip: 3 } });
});

test('summarizeRows: ratingも消も無いグループ（★・メモだけ）はキーを作らない', () => {
  const rows: SummaryRow[] = [{ horse_id: '2', rating: null, count: 6, skip_count: 0 }];
  assert.deepEqual(summarizeRows(rows), {});
});

test('summarizeRows: skip_count が無い行でも落ちずに0として扱う', () => {
  const rows: SummaryRow[] = [{ horse_id: '1', rating: 'B', count: 2 }];
  assert.deepEqual(summarizeRows(rows), { '1': { A: 0, B: 2, C: 0, D: 0, E: 0, skip: 0 } });
});

test('totalOf: A〜Eの合計票数', () => {
  assert.equal(totalOf({ A: 1, B: 2, C: 0, D: 0, E: 3 }), 6);
  assert.equal(totalOf(emptyRatingCounts()), 0);
});

// ---- レスポンスの読み取り（壊れていても落ちない） --------------------------

test('parseSummaryResponse: 正常なレスポンスを読む', () => {
  const parsed = parseSummaryResponse({ year: 2026, summary: { '3': { A: 2, B: 1, skip: 4 } } });
  assert.deepEqual(parsed, { '3': { A: 2, B: 1, C: 0, D: 0, E: 0, skip: 4 } });
});

test('parseSummaryResponse: 消しか付いていない馬も残す（0票扱いにしない）', () => {
  const parsed = parseSummaryResponse({ summary: { '9': { skip: 2 } } });
  assert.deepEqual(parsed, { '9': { A: 0, B: 0, C: 0, D: 0, E: 0, skip: 2 } });
});

test('parseSummaryResponse: skipを返さない旧デプロイのレスポンスも読める', () => {
  const parsed = parseSummaryResponse({ summary: { '3': { A: 1 } } });
  assert.deepEqual(parsed, { '3': { A: 1, B: 0, C: 0, D: 0, E: 0, skip: 0 } });
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
  assert.deepEqual(parsed, { '2': { A: 1, B: 0, C: 0, D: 0, E: 0, skip: 0 } });
});

// ---- 自分のデータ（端末間同期） --------------------------------------------

test('summarizeRows: 他会員に見せる集計にはメモ・★が混ざらない', () => {
  // 集計SQLは rating と SUM(skip) しか SELECT しないが、万一行に混ざっても外へ出ないことを担保する。
  // 出てよいのは消の**件数**（skip_count）だけで、生の skip 列も memo も favorite も出さない。
  const rows = [
    { horse_id: '1', rating: 'A', count: 1, skip_count: 1, memo: MEMO, favorite: 1, skip: 1 },
  ] as unknown as SummaryRow[];
  const summary = summarizeRows(rows);
  assert.equal(JSON.stringify(summary).includes('脚元'), false);
  assert.equal(JSON.stringify(summary).includes('favorite'), false);
  assert.deepEqual(summary, { '1': { A: 1, B: 0, C: 0, D: 0, E: 0, skip: 1 } });
});

test('rowsToEvaluationMap: D1の 0/1 を boolean に直して localStorage と同じ形にする', () => {
  const rows: MineRow[] = [
    { horse_id: '3', rating: 'B', memo: MEMO, favorite: 1, skip: 0 },
    // rating が無い（メモだけ付けた馬）も同期対象
    { horse_id: '7', rating: null, memo: '', favorite: 0, skip: 1 },
    // 馬IDが壊れている行は捨てる
    { horse_id: '../etc', rating: 'A', memo: '', favorite: 0, skip: 0 },
  ];
  assert.deepEqual(rowsToEvaluationMap(rows), {
    '3': { rating: 'B', favorite: true, skip: false, memo: MEMO },
    '7': { rating: null, favorite: false, skip: true, memo: '' },
  });
});

test('parseMineResponse: 正常なレスポンスを評価マップとして読む', () => {
  const parsed = parseMineResponse({
    year: 2026,
    evaluations: { '3': { rating: 'C', favorite: true, skip: false, memo: MEMO } },
  });
  assert.deepEqual(parsed, { '3': { rating: 'C', favorite: true, skip: false, memo: MEMO } });
});

test('parseMineResponse: 壊れていたら null（0件の {} と区別する）', () => {
  for (const input of [null, undefined, 'ok', 42, {}, { evaluations: null }, { evaluations: [] }]) {
    assert.equal(parseMineResponse(input), null, `null を返すべき: ${JSON.stringify(input)}`);
  }
  // 0件は「取得できて空だった」なので {} を返す
  assert.deepEqual(parseMineResponse({ evaluations: {} }), {});
});

test('parseMineResponse: 値が壊れていても既定値に丸めて落ちない', () => {
  const parsed = parseMineResponse({
    evaluations: { '5': { rating: 'S', favorite: 'yes', memo: 123 } },
  });
  assert.deepEqual(parsed, { '5': { rating: null, favorite: false, skip: false, memo: '' } });
});

test('parseMineResponse: 長すぎるメモは上限で切る（送り返せない値を持ち込まない）', () => {
  const parsed = parseMineResponse({
    evaluations: { '5': { rating: 'A', memo: 'あ'.repeat(MAX_MEMO_LENGTH + 100) } },
  });
  assert.equal(parsed!['5']!.memo.length, MAX_MEMO_LENGTH);
});

test('mergeEvaluationMaps: 同じ馬は取り込んだ側で上書きし、無い馬は手元のまま残す', () => {
  const local = {
    '1': { rating: 'A', favorite: false, skip: false, memo: 'ローカルだけの馬' },
    '2': { rating: 'B', favorite: false, skip: false, memo: '古い' },
  } as const;
  const remote = {
    '2': { rating: 'D', favorite: true, skip: false, memo: '新しい' },
  } as const;
  assert.deepEqual(mergeEvaluationMaps({ ...local }, { ...remote }), {
    '1': { rating: 'A', favorite: false, skip: false, memo: 'ローカルだけの馬' },
    '2': { rating: 'D', favorite: true, skip: false, memo: '新しい' },
  });
});

// ---- URL / ヘッダ ----------------------------------------------------------

test('summaryUrlForYear: 年度をクエリに付ける', () => {
  assert.equal(summaryUrlForYear(2026), '/api/evaluations/summary?year=2026');
});

test('mineUrlForYear: 自分のデータは集計とは別のパスから取る', () => {
  assert.equal(mineUrlForYear(2026), '/api/evaluations/mine?year=2026');
  assert.notEqual(MINE_API_PATH, summaryUrlForYear(2026).split('?')[0]);
});

test('ANON_ID_HEADER: 匿名IDはbodyではなくヘッダで送る', () => {
  assert.equal(ANON_ID_HEADER, 'X-Anon-Id');
});
