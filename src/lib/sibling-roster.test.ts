import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SelfMeasurement, SiblingRecruit } from './sibling-recruits.ts';
import {
  buildSiblingRoster,
  formatSiblingOwner,
  hasNonCarrotSibling,
  indexMeasurements,
  SELF_ROW_NAME,
  type RosterFoal,
  type RosterMeasurement,
} from './sibling-roster.ts';

const self: SelfMeasurement = {
  id: '10',
  netkeibaUrl: 'https://db.netkeiba.com/horse/2025100010/',
  sire: 'イクイノックス',
  sex: '牡',
  birthDate: '2025-04-30',
  height: 147,
  chestGirth: 169,
  caretGirth: 20.6,
  weight: 420,
};

function foal(over: Partial<RosterFoal>): RosterFoal {
  return {
    year: 2023,
    horseId: '2023100001',
    url: 'https://db.netkeiba.com/horse/2023100001/',
    name: 'テストキョウダイ',
    sex: '牝',
    sire: 'エピファネイア',
    birthDate: '2023-03-17',
    club: 'silk',
    ownerRaw: 'シルクレーシング',
    isCarrotRecruit: false,
    recruitYear: null,
    starts: 5,
    wins: 1,
    totalPrizeManYen: 880,
    ...over,
  };
}

function sibling(over: Partial<SiblingRecruit>): SiblingRecruit {
  return {
    recruitYear: 2022,
    no: '30',
    name: 'キャロット兄',
    netkeibaUrl: 'https://db.netkeiba.com/horse/2021100002/',
    sire: 'キズナ',
    sex: '牡',
    birthDate: '2021-05-02',
    height: 152,
    chestGirth: 175,
    caretGirth: 20,
    weight: 450,
    starts: 14,
    wins: 3,
    totalPrizeManYen: 4800,
    matchedBy: 'dam',
    ...over,
  };
}

const noMeasurements = indexMeasurements([]);

test('本馬は産駒ロスター側の行ではなく測尺つきの自前の行で出る', () => {
  const rows = buildSiblingRoster({
    self,
    selfRecruitYear: 2026,
    // ロスターには本馬も載っている（測尺は持っていない）
    foals: [foal({ year: 2025, horseId: '2025100010', name: 'テストメアの2025', club: 'carrot', isCarrotRecruit: true, recruitYear: 2026, starts: 0, wins: 0, totalPrizeManYen: 0 })],
    carrotSiblings: [],
    measurements: noMeasurements,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, SELF_ROW_NAME);
  assert.equal(rows[0].isSelf, true);
  assert.equal(rows[0].height, 147);
  assert.equal(rows[0].no, '10');
});

test('キャロット以外のきょうだいも並び、測尺は空のまま', () => {
  const rows = buildSiblingRoster({
    self,
    selfRecruitYear: 2026,
    foals: [foal({})],
    carrotSiblings: [],
    measurements: noMeasurements,
  });
  const other = rows.find((r) => !r.isSelf)!;
  assert.equal(other.name, 'テストキョウダイ');
  assert.equal(other.club, 'silk');
  assert.equal(other.height, null);
  assert.equal(other.weight, null);
  // 成績と父・牡牝・誕生日は出る
  assert.equal(other.starts, 5);
  assert.equal(other.sire, 'エピファネイア');
  assert.equal(other.sex, '牝');
  assert.equal(other.birthDate, '2023-03-17');
  assert.equal(hasNonCarrotSibling(rows), true);
});

test('キャロット募集のきょうだいには測尺と実名が結合される', () => {
  const measurement: RosterMeasurement = {
    netkeibaUrl: 'https://db.sp.netkeiba.com/horse/2023100001/',
    recruitYear: 2024,
    no: '30',
    name: 'ホンメイホース',
    height: 152,
    chestGirth: 175,
    caretGirth: 20,
    weight: 450,
  };
  const rows = buildSiblingRoster({
    self,
    selfRecruitYear: 2026,
    foals: [foal({ name: 'テストメアの2023', club: 'carrot', isCarrotRecruit: true, recruitYear: 2024 })],
    carrotSiblings: [],
    measurements: indexMeasurements([measurement]),
  });
  const row = rows.find((r) => !r.isSelf)!;
  assert.equal(row.name, 'ホンメイホース');
  assert.equal(row.height, 152);
  assert.equal(formatSiblingOwner(row), 'キャロット24 No.30');
});

test('弟妹も出し、生年の新しい順に並ぶ', () => {
  const rows = buildSiblingRoster({
    self,
    selfRecruitYear: 2026,
    foals: [
      foal({ year: 2020, horseId: 'a', url: null, name: '2020年生', birthDate: '2020-02-01' }),
      foal({ year: 2026, horseId: 'b', url: null, name: '2026年生（弟）', birthDate: '2026-03-01' }),
      foal({ year: 2023, horseId: 'c', url: null, name: '2023年生', birthDate: '2023-03-17' }),
    ],
    carrotSiblings: [],
    measurements: noMeasurements,
  });
  assert.deepEqual(
    rows.map((r) => r.name),
    ['2026年生（弟）', SELF_ROW_NAME, '2023年生', '2020年生']
  );
});

test('産駒ロスターに無いキャロットの兄姉は合流し、重複はしない', () => {
  const rows = buildSiblingRoster({
    self,
    selfRecruitYear: 2026,
    foals: [foal({ horseId: '2021100002', name: 'キャロット兄', club: 'carrot', isCarrotRecruit: true, recruitYear: 2022 })],
    // 同じ馬（netkeiba ID一致）と、ロスターに出てこない馬の2頭
    carrotSiblings: [sibling({}), sibling({ no: '31', name: '救済兄', netkeibaUrl: null, recruitYear: 2019, birthDate: null })],
    measurements: noMeasurements,
  });
  assert.equal(rows.length, 3);
  const rescued = rows.find((r) => r.name === '救済兄')!;
  assert.equal(rescued.club, 'carrot');
  assert.equal(rescued.height, 152);
  // 誕生日が取れていない馬は募集年の前年を生年とみなして並べる
  assert.equal(rescued.birthYear, 2018);
});

test('成績が取れていない馬の賞金はnull（0円と混同しない）', () => {
  const rows = buildSiblingRoster({
    self,
    selfRecruitYear: 2026,
    foals: [foal({ starts: null, wins: null, totalPrizeManYen: null })],
    carrotSiblings: [],
    measurements: noMeasurements,
  });
  assert.equal(rows.find((r) => !r.isSelf)!.totalPrizeManYen, null);
});

test('所属の表示', () => {
  const row = { ownerRaw: null, recruitYear: null, no: null };
  // クラブ名は表が横に伸びないよう短い呼び方にする
  assert.equal(formatSiblingOwner({ ...row, club: 'sunday' }), 'サンデー');
  assert.equal(formatSiblingOwner({ ...row, club: 'shadai-rh' }), '社台RH');
  // 短縮形を用意していないクラブは記事と同じ表記に落ちる
  assert.equal(formatSiblingOwner({ ...row, club: 'normandy' }), 'ノルマンディー');
  // 個人馬主は名前を出さない
  assert.equal(formatSiblingOwner({ ...row, club: 'private', ownerRaw: '山田太郎' }), '個人馬主');
  assert.equal(formatSiblingOwner({ ...row, club: 'unknown' }), '—');
  // 2017年より前のキャロット馬は募集年・番号を持たない（分析用データの対象外）
  assert.equal(formatSiblingOwner({ ...row, club: 'carrot' }), 'キャロット');
  assert.equal(formatSiblingOwner({ ...row, club: 'carrot', recruitYear: 2026, no: '1' }), 'キャロット26 No.1');
});

test('所属の表示: クラブ名を判定しきれなかった行は馬主欄をそのまま出す', () => {
  const row = { recruitYear: null, no: null };
  assert.equal(
    formatSiblingOwner({ ...row, club: 'club-other', ownerRaw: '東京ホースレーシング' }),
    '東京ホースレーシング'
  );
  assert.equal(formatSiblingOwner({ ...row, club: 'club-unknown', ownerRaw: 'シルク' }), 'シルク');
  // 馬主欄が空ならラベルに戻す
  assert.equal(formatSiblingOwner({ ...row, club: 'club-other', ownerRaw: null }), '他クラブ');
});
