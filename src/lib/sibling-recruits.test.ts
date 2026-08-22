import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RecruitWithResult } from './analysis-data.ts';
import {
  findSiblingRecruits,
  formatSiblingMeasurements,
  formatSiblingRecord,
  formatResultsAsOf,
  netkeibaHorseId,
  siblingDetailHref,
} from './sibling-recruits.ts';

/** 分析用データ1頭ぶんのひな形。テストで見たい列だけ上書きする。 */
function recruit(over: Partial<RecruitWithResult>): RecruitWithResult {
  return {
    recruitYear: 2025,
    no: '1',
    recruitName: 'テストメアの2024',
    realName: 'テストホース',
    displayName: 'テストホース',
    sex: '牡',
    netkeibaUrl: 'https://db.sp.netkeiba.com/horse/2024100001/',
    damUrl: 'https://db.sp.netkeiba.com/horse/2010100001/',
    sire: 'キタサンブラック',
    broodmareSire: 'ディープインパクト',
    pricePerShare: 20,
    height: 155,
    chestGirth: 178,
    caretGirth: 20.5,
    weight: 460,
    chuoPrizeManYen: 0,
    chihoPrizeManYen: 0,
    totalPrizeManYen: 0,
    starts: 0,
    wins: 0,
    seconds: 0,
    thirds: 0,
    others: 0,
    mainWins: [],
    gradeWins: [],
    ...over,
  };
}

test('netkeibaHorseId: sp/PC どちらのURLからもIDを取り出す', () => {
  assert.equal(netkeibaHorseId('https://db.netkeiba.com/horse/2024106528/'), '2024106528');
  assert.equal(netkeibaHorseId('https://db.sp.netkeiba.com/horse/2024106528/'), '2024106528');
});

test('netkeibaHorseId: 外国産繁殖牝馬の英数字IDも取れる（数字だけで切らない）', () => {
  assert.equal(netkeibaHorseId('https://db.sp.netkeiba.com/horse/000a01294d/'), '000a01294d');
});

test('netkeibaHorseId: URLが無ければ null', () => {
  assert.equal(netkeibaHorseId(''), null);
  assert.equal(netkeibaHorseId(null), null);
  assert.equal(netkeibaHorseId('https://db.netkeiba.com/'), null);
});

test('findSiblingRecruits: 母が同じ過去の募集馬を兄姉として返す', () => {
  const pool = [
    recruit({ recruitYear: 2025, no: '44', displayName: 'グルドロッティン' }),
    recruit({ recruitYear: 2025, no: '45', displayName: '別の母の馬', damUrl: 'https://db.sp.netkeiba.com/horse/2010109999/' }),
  ];
  const found = findSiblingRecruits(
    { damUrl: 'https://db.netkeiba.com/horse/2010100001/', sibling: '' },
    2026,
    pool
  );
  assert.deepEqual(
    found.map((s) => [s.no, s.matchedBy]),
    [['44', 'dam']]
  );
});

test('findSiblingRecruits: 母のURLが無い年度でも、代表兄姉の実名で拾える', () => {
  const pool = [
    recruit({ recruitYear: 2022, no: '15', displayName: 'リュケイオン', realName: 'リュケイオン', damUrl: null }),
  ];
  const found = findSiblingRecruits({ damUrl: '', sibling: 'リュケイオン' }, 2026, pool);
  assert.deepEqual(
    found.map((s) => [s.recruitYear, s.name, s.matchedBy]),
    [[2022, 'リュケイオン', 'name']]
  );
});

test('findSiblingRecruits: 母一致と名前一致が重なっても1頭にまとめ、母一致を残す', () => {
  const pool = [recruit({ recruitYear: 2025, no: '44', displayName: 'グルドロッティン', realName: 'グルドロッティン' })];
  const found = findSiblingRecruits(
    { damUrl: 'https://db.netkeiba.com/horse/2010100001/', sibling: 'グルドロッティン' },
    2026,
    pool
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].matchedBy, 'dam');
});

test('findSiblingRecruits: 同年・後年の馬は兄姉にならない', () => {
  const pool = [
    recruit({ recruitYear: 2025, no: '10' }),
    recruit({ recruitYear: 2024, no: '10' }),
  ];
  const found = findSiblingRecruits({ damUrl: 'https://db.netkeiba.com/horse/2010100001/', sibling: '' }, 2025, pool);
  assert.deepEqual(
    found.map((s) => s.recruitYear),
    [2024]
  );
});

test('findSiblingRecruits: 募集年の新しい順に並ぶ', () => {
  const pool = [
    recruit({ recruitYear: 2024, no: '63' }),
    recruit({ recruitYear: 2025, no: '4' }),
  ];
  const found = findSiblingRecruits({ damUrl: 'https://db.netkeiba.com/horse/2010100001/', sibling: '' }, 2026, pool);
  assert.deepEqual(
    found.map((s) => [s.recruitYear, s.no]),
    [
      [2025, '4'],
      [2024, '63'],
    ]
  );
});

test('findSiblingRecruits: 手がかりが無ければ空（全頭が兄姉になったりしない）', () => {
  const pool = [recruit({ damUrl: null, realName: 'テストホース' })];
  assert.deepEqual(findSiblingRecruits({ damUrl: '', sibling: '' }, 2026, pool), []);
});

test('formatSiblingRecord: 出走数と勝ち数。未出走と成績なしを区別する', () => {
  const base = findSiblingRecruits(
    { damUrl: 'https://db.netkeiba.com/horse/2010100001/', sibling: '' },
    2026,
    [recruit({ starts: 12, wins: 2 })]
  )[0];
  assert.equal(formatSiblingRecord(base), '12戦2勝');
  assert.equal(formatSiblingRecord({ ...base, starts: 0, wins: 0 }), '未出走');
  assert.equal(formatSiblingRecord({ ...base, starts: null, wins: null }), null);
});

test('findSiblingRecruits: 成績が取れていない馬は賞金も null にする（0万円と混ざらない）', () => {
  const pool = [recruit({ starts: null, wins: null, totalPrizeManYen: 0 })];
  const found = findSiblingRecruits({ damUrl: 'https://db.netkeiba.com/horse/2010100001/', sibling: '' }, 2026, pool);
  assert.equal(found[0].totalPrizeManYen, null);
});

test('formatSiblingMeasurements: 欠けている測尺は飛ばす', () => {
  const sibling = findSiblingRecruits(
    { damUrl: 'https://db.netkeiba.com/horse/2010100001/', sibling: '' },
    2026,
    [recruit({})]
  )[0];
  assert.equal(formatSiblingMeasurements(sibling), '体高155cm / 胸囲178cm / 管囲20.5cm / 馬体重460kg');
  assert.equal(
    formatSiblingMeasurements({ ...sibling, chestGirth: null, caretGirth: null }),
    '体高155cm / 馬体重460kg'
  );
});

test('siblingDetailHref: 個別ページがある年度だけリンクする（末尾スラッシュ必須）', () => {
  const sibling = findSiblingRecruits(
    { damUrl: 'https://db.netkeiba.com/horse/2010100001/', sibling: '' },
    2026,
    [recruit({ recruitYear: 2025, no: '44' })]
  )[0];
  assert.equal(siblingDetailHref(sibling), '/2025/horses/44/');
  assert.equal(siblingDetailHref({ ...sibling, recruitYear: 2026 }), '/horses/44/');
  assert.equal(siblingDetailHref({ ...sibling, recruitYear: 2024 }), null);
});

test('formatResultsAsOf: 成績の取得時点を年月で出す', () => {
  assert.equal(formatResultsAsOf('2026-08-21T22:48:05.011Z'), '2026年8月');
  assert.equal(formatResultsAsOf(''), '');
});
