import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RecruitWithResult } from './analysis-data.ts';
import { buildHorseInsights, dayOfYear, type LeadingRankFn } from './horse-insights.ts';

const leadingRankOf: LeadingRankFn = () => ({ rank: 2, year: 2023, substituted: false, matchedBy: 'id' });

let seq = 0;
function recruit(p: Partial<RecruitWithResult>): RecruitWithResult {
  seq += 1;
  return {
    recruitYear: 2022,
    no: String(seq),
    recruitName: `テスト${seq}の21`,
    sex: '牡',
    netkeibaUrl: `https://db.netkeiba.com/horse/${seq}/`,
    damUrl: null,
    damName: null,
    sire: null,
    broodmareSire: null,
    damAge: 10,
    damParity: 3,
    damProduceCount: 5,
    damGapBeforeYears: 1,
    birthDate: '2021-03-01',
    pricePerShare: null,
    shareCount: null,
    height: 155,
    chestGirth: 175,
    caretGirth: 20,
    weight: 450,
    chuoPrizeManYen: 1000,
    chihoPrizeManYen: 0,
    totalPrizeManYen: 1000,
    starts: 5,
    wins: 1,
    seconds: 0,
    thirds: 0,
    others: 4,
    mainWins: [],
    gradeWins: [],
    realName: null,
    displayName: `テスト${seq}`,
    offeringTotalManYen: null,
    shareCountKnown: false,
    ...p,
  } as RecruitWithResult;
}

test('dayOfYear: 3月10日は69日目、2/29は3/1と同じ60日目', () => {
  assert.equal(dayOfYear('2001-03-10'), 69);
  assert.equal(dayOfYear('2020-02-29'), 60);
  assert.equal(dayOfYear('2021-03-01'), 60);
});

test('buildHorseInsights: 募集データの行が無い馬（追加募集）は項目なし', () => {
  const pool = [recruit({})];
  assert.deepEqual(buildHorseInsights({ recruit: null, pool, damResults: [], trainer: null, leadingRankOf }), []);
});

test('buildHorseInsights: 欠けた項目は出さず、揃っている項目だけ出す', () => {
  const target = recruit({ height: null, chestGirth: null, caretGirth: null, weight: null, damAge: null, damParity: null, birthDate: null });
  const pool = [target, recruit({}), recruit({})];
  const out = buildHorseInsights({ recruit: target, pool, damResults: [], trainer: null, leadingRankOf });
  assert.deepEqual(out, []);
});

test('buildHorseInsights: 体高158cm以上と未満で文が分かれ、重賞馬率の数字は母集団から出る', () => {
  const tall = recruit({ height: 160, gradeWins: ['G1'] });
  const pool = [tall, recruit({ height: 150 }), recruit({ height: 152 }), recruit({ height: 156 })];
  const [h] = buildHorseInsights({ recruit: tall, pool, damResults: [], trainer: null, leadingRankOf }).filter((i) => i.key === 'height');
  assert.equal(h.figure, '160cm');
  assert.match(h.body, /158cm以上は1頭中1頭（100\.0%）/);
  assert.match(h.body, /158cm未満の0\.0%より高め/);
  const short = pool[1];
  const [s] = buildHorseInsights({ recruit: short, pool, damResults: [], trainer: null, leadingRankOf }).filter((i) => i.key === 'height');
  assert.match(s.body, /158cm未満の重賞馬率は0\.0%/);
  assert.match(s.body, /160〜160cmに散らばって/);
});

test('buildHorseInsights: 管囲・馬体重は同性の中で見る（牡のページに牝の数字を出さない）', () => {
  const colt = recruit({ sex: '牡', weight: 500 });
  const pool = [colt, recruit({ sex: '牝', weight: 400 }), recruit({ sex: '牝', weight: 410 }), recruit({ sex: '牡', weight: 460 })];
  const w = buildHorseInsights({ recruit: colt, pool, damResults: [], trainer: null, leadingRankOf }).find((i) => i.key === 'weight')!;
  assert.match(w.figureNote ?? '', /牡/);
  assert.match(w.body, /牡は賞金で見るかぎり/);
});

test('buildHorseInsights: 産次は初仔だけ専用文、空胎明けのときだけ空胎の文が付く', () => {
  const first = recruit({ damParity: 1, damGapBeforeYears: null });
  const rest = recruit({ damParity: 4, damGapBeforeYears: 2 });
  const pool = Array.from({ length: 30 }, () => recruit({})).concat([first, rest]);
  const a = buildHorseInsights({ recruit: first, pool, damResults: [], trainer: null, leadingRankOf }).find((i) => i.key === 'birth-order')!;
  assert.equal(a.figure, '1番仔');
  assert.doesNotMatch(a.body, /空胎/);
  const b = buildHorseInsights({ recruit: rest, pool, damResults: [], trainer: null, leadingRankOf }).find((i) => i.key === 'birth-order')!;
  assert.match(b.body, /空胎/);
});

test('buildHorseInsights: 厩舎は募集データの担当と食い違えば出さない', () => {
  const r = recruit({ region: '東', finalTrainer: '堀宣行', finalTrainerId: '01070', recruitYear: 2023 });
  const out = buildHorseInsights({ recruit: r, pool: [r], damResults: [], trainer: '別の調教師', leadingRankOf });
  assert.equal(out.find((i) => i.key === 'stable'), undefined);
});

test('buildHorseInsights: 厩舎は担当が一致し順位が取れていれば、数字を先に出す', () => {
  const r = recruit({ region: '東', finalTrainer: '堀宣行', finalTrainerId: '01070', recruitYear: 2023, gradeWins: [] });
  const pool = Array.from({ length: 20 }, () => recruit({ region: '西' })).concat([r]);
  const st = buildHorseInsights({ recruit: r, pool, damResults: [], trainer: '堀宣行', leadingRankOf }).find((i) => i.key === 'stable')!;
  assert.equal(st.figure, '2位');
  assert.match(st.figureLabel, /堀宣行厩舎（美浦）の2023年/);
});
