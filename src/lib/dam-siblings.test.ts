import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupByDamOrigin,
  buildDamSplits,
  buildGradeSiblingCases,
  currentYearMajorClubRecruits,
  summarize,
  isMajorClubOrigin,
  isMajorClubFoal,
  recordText,
  shortGradeName,
  mannWhitney,
  twoProportionTest,
  probabilityOfZero,
  median,
  type RawFoal,
  type RawDam,
} from './dam-siblings.ts';

let seq = 0;
const foal = (p: Partial<RawFoal>): RawFoal => ({
  year: 2018,
  horseId: 'h' + ++seq,
  url: null,
  name: 'テスト',
  sex: '牡',
  sire: 'テストサイアー',
  birthDate: null,
  ownerRaw: null,
  ownerId: null,
  breederRaw: null,
  club: 'carrot',
  clubByOwner: 'carrot',
  isCarrotRecruit: true,
  recruitYear: 2019,
  sundaySilkCandidate: false,
  shares: 400,
  pricePerShareManYen: 10,
  starts: 10,
  wins: 2,
  chuoPrizeManYen: 3000,
  chihoPrizeManYen: 0,
  totalPrizeManYen: 3000,
  mainWins: [],
  gradeWins: [],
  recordFound: true,
  note: null,
  ...p,
});

const dam = (p: Partial<RawDam> & { damName: string; foals: RawFoal[] }): RawDam => ({
  damId: 'd_' + p.damName,
  damUrl: null,
  damClub: 'sunday',
  damOwnerRaw: 'サンデーレーシング',
  damShares: 40,
  damStarts: 12,
  damWins: 2,
  carrotRecruits: [],
  ...p,
});

// ---- 群1: 母の出身クラブ別 --------------------------------------------------

test('groupByDamOrigin: 母の出身クラブで分け、生年で足切りする', () => {
  const results = [
    dam({
      damName: 'サンデー母',
      damClub: 'sunday',
      foals: [
        foal({ year: 2018, club: 'carrot' }),
        foal({ year: 2023, club: 'carrot' }), // 生年フィルタで除外
        foal({ year: 2019, club: 'sunday', isCarrotRecruit: false }), // キャロット募集馬でない
      ],
    }),
    dam({
      damName: 'シルク母',
      damClub: 'silk',
      foals: [foal({ year: 2017, club: 'carrot' })],
    }),
    dam({
      damName: 'キャロ母',
      damClub: 'carrot',
      foals: [foal({ year: 2016, club: 'carrot' })],
    }),
    dam({
      damName: '個人母',
      damClub: 'private',
      foals: [foal({ year: 2016, club: 'carrot' })],
    }),
    dam({
      damName: '不明母',
      damClub: 'unknown',
      foals: [foal({ year: 2016, club: 'carrot' })],
    }),
    dam({
      damName: '社台母',
      damClub: 'shadai-rh',
      foals: [foal({ year: 2016, club: 'carrot' })],
    }),
    dam({
      // G1レーシング出身の母もサンデー・シルクと同じ「向こうのクラブ」群に入る（other ではない）
      damName: 'G1母',
      damClub: 'g1',
      foals: [foal({ year: 2018, club: 'carrot' })],
    }),
  ];
  const g = groupByDamOrigin(results, 2021);
  assert.equal(g.foals.majorClub.length, 3); // サンデー母1 + シルク母1 + G1母1
  assert.equal(g.foals.carrot.length, 1);
  assert.equal(g.foals.private.length, 1);
  assert.equal(g.foals.unknown.length, 1);
  assert.equal(g.foals.other.length, 1); // 社台RHだけ
  assert.equal(g.all.length, 7);
  assert.equal(g.majorClubDamCount, 3);
  // 群の合計は all と一致する（どこにも入らない/二重計上が無い）
  const summed = (Object.values(g.foals) as RawFoal[][]).reduce((s, a) => s + a.length, 0);
  assert.equal(summed, g.all.length);
});

test('summarize: 出走率・中央値・勝ち上がり・重賞率', () => {
  const s = summarize([
    foal({ starts: 0, wins: 0, totalPrizeManYen: 0 }),
    foal({ starts: 5, wins: 0, totalPrizeManYen: 400 }),
    foal({
      starts: 8,
      wins: 3,
      totalPrizeManYen: 5000,
      gradeWins: ["24'テストS(G3)"],
    }),
    foal({ starts: null, wins: null, totalPrizeManYen: null }), // 成績不明は分母から除外
  ]);
  assert.equal(s.n, 4);
  assert.equal(s.withRecord, 3);
  assert.equal(s.raced, 2);
  assert.equal(Number(s.debutRate.toFixed(4)), Number((2 / 3).toFixed(4)));
  assert.equal(s.medianPrize, 2700); // (400 + 5000) / 2
  assert.equal(s.maxPrize, 5000);
  assert.equal(s.winRate, 0.5);
  assert.equal(s.gradeWinners, 1);
  assert.equal(s.gradeRate, 0.25);
});

// ---- 群2: 母内比較 ----------------------------------------------------------

test('buildDamSplits: 両群に仔がいる母だけ・稼ぎ頭の降順', () => {
  const results = [
    dam({
      // G1レーシング出身の母も比較表に入る（isMajorClubOrigin / isMajorClubFoal 経由）
      damName: '両方いる小',
      damClub: 'g1',
      foals: [
        foal({
          year: 2016,
          club: 'g1',
          isCarrotRecruit: false,
          totalPrizeManYen: 1000,
        }),
        foal({ year: 2018, club: 'carrot', totalPrizeManYen: 900 }),
      ],
    }),
    dam({
      damName: '両方いる大',
      foals: [
        foal({
          year: 2017,
          club: 'silk',
          isCarrotRecruit: false,
          totalPrizeManYen: 30000,
        }),
        foal({ year: 2019, club: 'carrot', totalPrizeManYen: 2000 }),
      ],
    }),
    dam({
      damName: 'キャロットだけ',
      foals: [foal({ year: 2018, club: 'carrot' })],
    }),
    dam({
      damName: '生年オーバーで消える',
      foals: [
        foal({ year: 2023, club: 'sunday', isCarrotRecruit: false }),
        foal({ year: 2018, club: 'carrot' }),
      ],
    }),
    dam({
      damName: '母がキャロット出身なので対象外',
      damClub: 'carrot',
      foals: [
        foal({ year: 2016, club: 'sunday', isCarrotRecruit: false }),
        foal({ year: 2018, club: 'carrot' }),
      ],
    }),
  ];
  const v = buildDamSplits(results, 2021);
  assert.deepEqual(
    v.splits.map((s) => s.dam.damName),
    ['両方いる大', '両方いる小'],
  );
  assert.equal(v.splits.find((s) => s.dam.damName === '両方いる小')?.dam.damClub, 'g1');
  assert.equal(v.stayedAll.length, 2);
  assert.equal(v.cameAll.length, 2);
  assert.equal(v.stayedStats.medianPrize, median([1000, 30000]));
  assert.equal(v.cameStats.medianPrize, median([900, 2000]));
});

test('buildDamSplits: 成績不明（starts=null）の仔は両群から外れる', () => {
  const results = [
    dam({
      damName: 'A',
      foals: [
        foal({
          year: 2016,
          club: 'sunday',
          isCarrotRecruit: false,
          starts: null,
        }),
        foal({ year: 2018, club: 'carrot' }),
      ],
    }),
  ];
  assert.equal(buildDamSplits(results, 2021).splits.length, 0);
});

// ---- 群3: 重賞兄姉ケース ----------------------------------------------------

test('buildGradeSiblingCases: 母がキャロット出身は除外し、重賞兄姉の賞金降順', () => {
  const results = [
    dam({
      damName: 'G1の下',
      damClub: 'unknown',
      foals: [
        foal({
          year: 2022,
          club: 'sunday',
          isCarrotRecruit: false,
          totalPrizeManYen: 133495,
          gradeWins: ["25'日本ダービー(G1)"],
        }),
        foal({ year: 2020, club: 'carrot', totalPrizeManYen: 642 }),
      ],
    }),
    dam({
      damName: 'G3の下',
      damClub: 'private',
      foals: [
        foal({
          year: 2016,
          club: 'silk',
          isCarrotRecruit: false,
          totalPrizeManYen: 20568,
          gradeWins: ["23'小倉大賞典(G3)"],
        }),
        foal({ year: 2023, club: 'carrot', totalPrizeManYen: 216 }),
      ],
    }),
    dam({
      damName: '母キャロットなので除外',
      damClub: 'carrot',
      foals: [
        foal({
          year: 2016,
          club: 'sunday',
          isCarrotRecruit: false,
          gradeWins: ["20'有馬記念(G1)"],
        }),
        foal({ year: 2017, club: 'carrot' }),
      ],
    }),
    dam({
      damName: '重賞兄姉なし',
      damClub: 'unknown',
      foals: [
        foal({ year: 2016, club: 'sunday', isCarrotRecruit: false }),
        foal({ year: 2018, club: 'carrot' }),
      ],
    }),
  ];
  const cases = buildGradeSiblingCases(results);
  assert.deepEqual(
    cases.map((c) => c.dam.damName),
    ['G1の下', 'G3の下'],
  );
  assert.equal(cases[0].gradeSiblings.length, 1);
  assert.equal(cases[0].majorClubFoals.length, 1);
  assert.equal(cases[0].carrotFoals.length, 1);
});

// ---- 最新年度 ---------------------------------------------------------------

test('currentYearMajorClubRecruits: 該当年度のみ・No.昇順・兄姉つき', () => {
  const results = [
    dam({
      damName: 'パストフォリア',
      damClub: 'sunday',
      carrotRecruits: [
        { recruitYear: 2026, no: '42', name: 'パストフォリアの25' },
        { recruitYear: 2021, no: '3', name: 'パストフォリアの20' },
      ],
      foals: [
        foal({
          year: 2019,
          club: 'sunday',
          isCarrotRecruit: false,
          name: 'サブライムアンセム',
        }),
      ],
    }),
    dam({
      damName: 'ブランノワール',
      damClub: 'silk',
      carrotRecruits: [{ recruitYear: 2026, no: '1', name: 'ブランノワールの25' }],
      foals: [foal({ year: 2017, club: 'silk', isCarrotRecruit: false })],
    }),
    dam({
      damName: '母がキャロット',
      damClub: 'carrot',
      carrotRecruits: [{ recruitYear: 2026, no: '2', name: '対象外の25' }],
      foals: [],
    }),
    dam({
      // G1レーシング出身の母の募集馬も今年の表に出る（#79 ベデザンジュの25 相当）
      damName: 'G1母',
      damClub: 'g1',
      carrotRecruits: [{ recruitYear: 2026, no: '79', name: 'ベデザンジュの25' }],
      foals: [foal({ year: 2025, club: 'carrot', isCarrotRecruit: true, starts: null })],
    }),
  ];
  const cur = currentYearMajorClubRecruits(results, 2026);
  assert.deepEqual(
    cur.map((c) => c.no),
    ['1', '42', '79'],
  );
  assert.ok(cur.map((c) => c.no).includes('79'));
  assert.equal(cur[1].majorClubSiblings[0].name, 'サブライムアンセム');
});

// ---- 検定 -------------------------------------------------------------------

test('mannWhitney: 明確に差がある2群は有意、同じ分布なら有意でない', () => {
  const low = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
  const high = low.map((v) => v + 5000);
  assert.ok(mannWhitney(low, high).p < 0.05);
  assert.ok(mannWhitney(low, [...low]).p > 0.5);
});

test('twoProportionTest: 期待度数5未満なら usable=false（pを読ませない）', () => {
  const small = twoProportionTest(0, 36, 37, 493);
  assert.equal(small.usable, false);
  assert.ok(small.minExpected < 5);
  const big = twoProportionTest(40, 100, 20, 100);
  assert.equal(big.usable, true);
  assert.ok(big.p < 0.05);
});

test('probabilityOfZero: 7.5%が36回起きない確率はおよそ6%', () => {
  const p = probabilityOfZero(37 / 493, 36);
  assert.ok(p > 0.05 && p < 0.07, `実際: ${p}`);
});

// ---- ヘルパ -----------------------------------------------------------------

test('recordText / isMajorClubOrigin / isMajorClubFoal / shortGradeName', () => {
  assert.equal(recordText(foal({ starts: 7, wins: 2 })), '7戦2勝');
  assert.equal(recordText(foal({ starts: null, wins: null })), '—');
  assert.equal(isMajorClubOrigin(dam({ damName: 'a', damClub: 'sunday', foals: [] })), true);
  assert.equal(isMajorClubOrigin(dam({ damName: 'a', damClub: 'silk', foals: [] })), true);
  assert.equal(isMajorClubOrigin(dam({ damName: 'a', damClub: 'g1', foals: [] })), true);
  assert.equal(isMajorClubOrigin(dam({ damName: 'a', damClub: 'carrot', foals: [] })), false);
  assert.equal(isMajorClubOrigin(dam({ damName: 'a', damClub: 'shadai-rh', foals: [] })), false);
  assert.equal(isMajorClubFoal(foal({ club: 'silk' })), true);
  assert.equal(isMajorClubFoal(foal({ club: 'g1' })), true);
  assert.equal(isMajorClubFoal(foal({ club: 'carrot' })), false);
  assert.equal(shortGradeName("23'オールカマー(G2)"), 'オールカマー(G2)');
});
