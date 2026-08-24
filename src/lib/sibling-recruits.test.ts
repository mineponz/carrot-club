import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RecruitWithResult } from './analysis-data.ts';
import {
  buildMeasurementRows,
  findSiblingRecruits,
  formatSiblingMeasurements,
  formatSiblingRecord,
  formatResultsAsOf,
  netkeibaHorseId,
  siblingDetailHref,
  SELF_ROW_NAME,
} from './sibling-recruits.ts';

/** 分析用データ1頭ぶんのひな形。テストで見たい列だけ上書きする。 */
function recruit(over: Partial<RecruitWithResult>): RecruitWithResult {
  return {
    recruitYear: 2025,
    no: '1',
    recruitName: 'テストメアの2024',
    damName: 'テストメア',
    realName: 'テストホース',
    displayName: 'テストホース',
    sex: '牡',
    netkeibaUrl: 'https://db.sp.netkeiba.com/horse/2024100001/',
    damUrl: 'https://db.sp.netkeiba.com/horse/2010100001/',
    sire: 'キタサンブラック',
    broodmareSire: 'ディープインパクト',
    damAge: 10,
    birthDate: '2024-03-15',
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
    { name: 'テストメアの25', damUrl: 'https://db.netkeiba.com/horse/2010100001/', sibling: '' },
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
    recruit({ recruitYear: 2022, no: '15', displayName: 'リュケイオン', realName: 'リュケイオン', damUrl: null, damName: '別のメア' }),
  ];
  const found = findSiblingRecruits({ name: 'テストメアの25', damUrl: '', sibling: 'リュケイオン' }, 2026, pool);
  assert.deepEqual(
    found.map((s) => [s.recruitYear, s.name, s.matchedBy]),
    [[2022, 'リュケイオン', 'name']]
  );
});

test('findSiblingRecruits: 母のURLが無い年度（2021〜2023年募集）でも母馬名で拾える', () => {
  // 実例: No.72サンブルエミューズの25 に対する2021年募集No.65（ラヴェル）。
  // 母の列が無いので `damUrl` は null、`Horse.sibling` に載っているのは別の1頭だけ。
  const pool = [
    recruit({ recruitYear: 2021, no: '65', displayName: 'ラヴェル', realName: 'ラヴェル', damUrl: null }),
  ];
  const found = findSiblingRecruits(
    { name: 'テストメアの25', damUrl: 'https://db.netkeiba.com/horse/2010100001/', sibling: '別の兄姉' },
    2026,
    pool
  );
  assert.deepEqual(
    found.map((s) => [s.name, s.matchedBy]),
    [['ラヴェル', 'damName']]
  );
});

test('findSiblingRecruits: 母のURLが両方にあって違うなら、母馬名が同じでも兄姉にしない', () => {
  const pool = [
    recruit({ no: '45', displayName: '別の母の馬', damUrl: 'https://db.sp.netkeiba.com/horse/2010109999/' }),
  ];
  const found = findSiblingRecruits(
    { name: 'テストメアの25', damUrl: 'https://db.netkeiba.com/horse/2010100001/', sibling: '' },
    2026,
    pool
  );
  assert.deepEqual(found, []);
});

test('findSiblingRecruits: 「Ⅱ」の有無は別の繁殖牝馬として扱う（半角II表記とは同じ母）', () => {
  const pool = [
    recruit({ recruitYear: 2022, no: '39', displayName: '外国産の母の馬', damUrl: null, damName: 'アンフィトリテII' }),
    recruit({ recruitYear: 2023, no: '41', displayName: '内国産の母の馬', damUrl: null, damName: 'アンフィトリテ' }),
  ];
  assert.deepEqual(
    findSiblingRecruits({ name: 'アンフィトリテの25', damUrl: '', sibling: '' }, 2026, pool).map((s) => s.name),
    ['内国産の母の馬']
  );
  assert.deepEqual(
    findSiblingRecruits({ name: 'アンフィトリテⅡの25', damUrl: '', sibling: '' }, 2026, pool).map((s) => s.name),
    ['外国産の母の馬']
  );
});

test('findSiblingRecruits: 母一致と名前一致が重なっても1頭にまとめ、母一致を残す', () => {
  const pool = [recruit({ recruitYear: 2025, no: '44', displayName: 'グルドロッティン', realName: 'グルドロッティン' })];
  const found = findSiblingRecruits(
    { name: 'テストメアの25', damUrl: 'https://db.netkeiba.com/horse/2010100001/', sibling: 'グルドロッティン' },
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
  const found = findSiblingRecruits({ name: 'テストメアの25', damUrl: 'https://db.netkeiba.com/horse/2010100001/', sibling: '' }, 2025, pool);
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
  const found = findSiblingRecruits({ name: 'テストメアの25', damUrl: 'https://db.netkeiba.com/horse/2010100001/', sibling: '' }, 2026, pool);
  assert.deepEqual(
    found.map((s) => [s.recruitYear, s.no]),
    [
      [2025, '4'],
      [2024, '63'],
    ]
  );
});

test('findSiblingRecruits: 手がかりが無ければ空（全頭が兄姉になったりしない）', () => {
  const pool = [recruit({ damUrl: null, damName: '別のメア', realName: 'テストホース' })];
  assert.deepEqual(findSiblingRecruits({ name: 'テストメアの25', damUrl: '', sibling: '' }, 2026, pool), []);
});

test('findSiblingRecruits: 過去募集馬の母馬名が分からなければ名前一致だけで判定する', () => {
  // 2017〜2020年募集の `name` は競走馬の実名なので、母馬名は復元できず null になる。
  // ここを「実名＝母馬名」と扱うと、同名の繁殖牝馬の産駒を兄姉として並べてしまう。
  const pool = [recruit({ recruitYear: 2019, no: '5', damUrl: null, damName: null, realName: 'テストメア' })];
  assert.deepEqual(findSiblingRecruits({ name: 'テストメアの25', damUrl: '', sibling: '' }, 2026, pool), []);
});

test('formatSiblingRecord: 出走数と勝ち数。未出走と成績なしを区別する', () => {
  const base = findSiblingRecruits(
    { name: 'テストメアの25', damUrl: 'https://db.netkeiba.com/horse/2010100001/', sibling: '' },
    2026,
    [recruit({ starts: 12, wins: 2 })]
  )[0];
  assert.equal(formatSiblingRecord(base), '12戦2勝');
  assert.equal(formatSiblingRecord({ ...base, starts: 0, wins: 0 }), '未出走');
  assert.equal(formatSiblingRecord({ ...base, starts: null, wins: null }), null);
});

test('findSiblingRecruits: 成績が取れていない馬は賞金も null にする（0万円と混ざらない）', () => {
  const pool = [recruit({ starts: null, wins: null, totalPrizeManYen: 0 })];
  const found = findSiblingRecruits({ name: 'テストメアの25', damUrl: 'https://db.netkeiba.com/horse/2010100001/', sibling: '' }, 2026, pool);
  assert.equal(found[0].totalPrizeManYen, null);
});

test('formatSiblingMeasurements: 欠けている測尺は飛ばす', () => {
  const sibling = findSiblingRecruits(
    { name: 'テストメアの25', damUrl: 'https://db.netkeiba.com/horse/2010100001/', sibling: '' },
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
    { name: 'テストメアの25', damUrl: 'https://db.netkeiba.com/horse/2010100001/', sibling: '' },
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

/** 表に自分の行を作るのに要る値だけのひな形（`Horse` の一部）。 */
function self(over: Partial<Parameters<typeof buildMeasurementRows>[0]> = {}) {
  return {
    id: '5',
    netkeibaUrl: 'https://db.netkeiba.com/horse/2025100005/',
    sire: 'イクイノックス',
    height: 152,
    chestGirth: 175,
    caretGirth: 20,
    weight: 440,
    ...over,
  };
}

test('buildMeasurementRows: その馬自身が1行目に来る（兄姉と同じ列で測尺を見比べるため）', () => {
  const siblings = findSiblingRecruits(
    { name: 'テストメアの25', damUrl: 'https://db.netkeiba.com/horse/2010100001/', sibling: '' },
    2026,
    [recruit({ recruitYear: 2025, no: '44', displayName: 'グルドロッティン', starts: 12, wins: 2 })]
  );
  const rows = buildMeasurementRows(self(), 2026, siblings);
  assert.deepEqual(
    rows.map((r) => [r.name, r.recruitYear, r.no, r.isSelf]),
    [
      [SELF_ROW_NAME, 2026, '5', true],
      ['グルドロッティン', 2025, '44', false],
    ]
  );
  assert.deepEqual(
    [rows[0].height, rows[0].chestGirth, rows[0].caretGirth, rows[0].weight],
    [152, 175, 20, 440]
  );
});

test('buildMeasurementRows: 自身の行は募集名ではなく「本馬」（「〇〇の25」で列が伸びないように）', () => {
  const rows = buildMeasurementRows(self(), 2026, []);
  assert.equal(rows[0].name, '本馬');
});

test('buildMeasurementRows: 自身はまだ走っていないので成績・賞金は持たない', () => {
  const rows = buildMeasurementRows(self(), 2026, []);
  assert.deepEqual([rows[0].starts, rows[0].wins, rows[0].totalPrizeManYen], [null, null, null]);
  assert.equal(formatSiblingRecord(rows[0]), null);
});

test('buildMeasurementRows: 父を各行に持つ（同じ母の産駒なので違いは父に出る）', () => {
  const siblings = findSiblingRecruits(
    { name: 'テストメアの25', damUrl: 'https://db.netkeiba.com/horse/2010100001/', sibling: '' },
    2026,
    [recruit({ recruitYear: 2025, no: '44', sire: 'キタサンブラック' })]
  );
  const rows = buildMeasurementRows(self({ sire: 'イクイノックス' }), 2026, siblings);
  assert.deepEqual(
    rows.map((r) => r.sire),
    ['イクイノックス', 'キタサンブラック']
  );
});

test('buildMeasurementRows: netkeibaのURLが無ければ null（空文字のリンクを作らない）', () => {
  const rows = buildMeasurementRows(self({ netkeibaUrl: '' }), 2026, []);
  assert.equal(rows[0].netkeibaUrl, null);
});
