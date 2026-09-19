import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { RecruitWithResult } from './analysis-data.ts';
import type { Horse } from './horses.ts';
import { horses2026 } from '../data/horses2026.ts';
import { LOTTERY_STATUS_SNAPSHOTS } from '../data/lotteryStatus2026.ts';
import { remainingSharesRows, remainingSharesByHorseId } from './remaining-shares.ts';
import type { RawDam, RawFoal } from './dam-siblings.ts';
import {
  categorizeFilly,
  computeFillyBenchmark,
  FEMALE_SIZE_CATEGORY_ORDER,
  gradeWinningSiblingsOf,
  isRegionalStablePending,
  roiPctOf,
  screenSecondOffering,
} from './second-offering-screen.ts';

/** 分析用データ1頭ぶんのひな形（sibling-recruits.test.tsと同じ方式）。 */
function recruit(over: Partial<RecruitWithResult>): RecruitWithResult {
  return {
    recruitYear: 2020,
    no: '1',
    recruitName: 'テストメアの2019',
    damName: 'テストメア',
    realName: 'テストホース',
    displayName: 'テストホース',
    sex: '牝',
    netkeibaUrl: 'https://db.sp.netkeiba.com/horse/2019100001/',
    damUrl: 'https://db.sp.netkeiba.com/horse/2010100001/',
    sire: 'キタサンブラック',
    broodmareSire: 'ディープインパクト',
    damAge: 10,
    damParity: 4,
    damProduceCount: 6,
    damGapBeforeYears: 1,
    birthDate: '2019-03-15',
    pricePerShare: 20,
    shareCount: 400,
    height: 155,
    chestGirth: 178,
    caretGirth: 20.5,
    weight: 460,
    chuoPrizeManYen: 0,
    chihoPrizeManYen: 0,
    totalPrizeManYen: 0,
    offeringTotalManYen: 8000,
    shareCountKnown: true,
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

/**
 * `analysis-data.ts`はESMのJSON importで`analysis/data/*.json`を読む（Viteのビルド時解決を
 * 前提にしたコメントが書いてある通り）。`node --test`単体ではJSONのimport属性が無いと
 * 読めないため（Vite/Astroのビルドでは問題ないが、生のnode:testランナーでは
 * `ERR_IMPORT_ATTRIBUTE_MISSING`になる）、実データを使うテストだけは`createRequire`
 * （CJS requireはJSONに属性が要らない）でJSONを直接読み、`loadRecruitsWithResults` /
 * `loadDamRoster`と同じ結合ロジックをテスト内に再現する。本体側（`analysis-data.ts`）は
 * 8記事が依存する共有モジュールなので、このテストのためだけに書き換えない。
 */
const require = createRequire(import.meta.url);
/** `analysis-data.ts`の`DEFAULT_SHARE_COUNT`と同じ値（口数不明馬の近似に使う400口）。 */
const DEFAULT_SHARE_COUNT_FOR_TEST = 400;

function loadRecruitsWithResultsForTest(): RecruitWithResult[] {
  const recruitsJson = require('../../analysis/data/recruits.json') as Record<string, unknown>[];
  const raceResultsJson = require('../../analysis/data/race-results.json') as {
    results: Record<string, unknown>[];
  };
  const byUrl = new Map(raceResultsJson.results.map((r) => [r.netkeibaUrl as string, r]));
  return recruitsJson.map((h) => {
    const r = h.netkeibaUrl ? byUrl.get(h.netkeibaUrl as string) : undefined;
    const chuo = (r?.chuoPrizeManYen as number | null | undefined) ?? null;
    const chiho = (r?.chihoPrizeManYen as number | null | undefined) ?? null;
    return {
      ...h,
      totalPrizeManYen: (chuo ?? 0) + (chiho ?? 0),
      starts: (r?.starts as number | null | undefined) ?? null,
      wins: (r?.wins as number | null | undefined) ?? null,
      gradeWins: (r?.gradeWins as string[] | undefined) ?? [],
      offeringTotalManYen:
        h.pricePerShare != null
          ? (h.pricePerShare as number) * ((h.shareCount as number | null) ?? DEFAULT_SHARE_COUNT_FOR_TEST)
          : null,
    } as unknown as RecruitWithResult;
  });
}

function loadDamRosterForTest(): Map<string, RawDam> {
  const damSiblingsJson = require('../../analysis/data/dam-siblings.json') as { results: RawDam[] };
  return new Map(
    damSiblingsJson.results
      .filter((d): d is RawDam & { damId: string } => d.damId != null)
      .map((d) => [d.damId, d]),
  );
}

// ---- roiPctOf ----

test('roiPctOf: 獲得賞金÷募集総額を%で返す', () => {
  assert.equal(roiPctOf({ offeringTotalManYen: 4000, totalPrizeManYen: 6000 }), 150);
});

test('roiPctOf: 募集総額が不明・0以下ならnull', () => {
  assert.equal(roiPctOf({ offeringTotalManYen: null, totalPrizeManYen: 1000 }), null);
  assert.equal(roiPctOf({ offeringTotalManYen: 0, totalPrizeManYen: 1000 }), null);
});

// ---- computeFillyBenchmark（フィクスチャ） ----

test('computeFillyBenchmark: 「中央値超」は厳密に上回る場合だけ（境界値ちょうどは含めない）', () => {
  // 6頭（偶数）なので中央値は中央2件の平均: 体重435（430と440の平均）、胸囲172.75（172.5と173の平均）。
  const recruits = [
    recruit({ no: '1', weight: 410, chestGirth: 170, pricePerShare: 10 }),
    recruit({ no: '2', weight: 420, chestGirth: 171, pricePerShare: 10 }),
    recruit({ no: '3', weight: 430, chestGirth: 172.5, pricePerShare: 10 }),
    recruit({ no: '4', weight: 440, chestGirth: 173, pricePerShare: 10 }),
    recruit({ no: '5', weight: 450, chestGirth: 174, pricePerShare: 10 }),
    recruit({ no: '6', weight: 460, chestGirth: 175, pricePerShare: 10 }),
  ].map((r) => ({ ...r, recruitYear: 2020 }));

  const benchmark = computeFillyBenchmark(recruits);
  assert.equal(benchmark.n, 6);
  assert.equal(benchmark.medianWeightKg, 435);
  assert.equal(benchmark.medianChestGirthCm, 172.75);
  assert.equal(benchmark.above.n + benchmark.restOrEqual.n, 6);
  // 中央値超（両方とも>中央値）は No.4・5・6 の3頭のみ。
  assert.equal(benchmark.above.n, 3);
  assert.equal(benchmark.restOrEqual.n, 3);
});

test('computeFillyBenchmark: 対象は牝・2017〜2023年度・一口価格判明のみ', () => {
  const recruits = [
    recruit({ no: '1', sex: '牝', recruitYear: 2020, pricePerShare: 10 }),
    recruit({ no: '2', sex: '牡', recruitYear: 2020, pricePerShare: 10 }), // 牡は除外
    recruit({ no: '3', sex: '牝', recruitYear: 2016, pricePerShare: 10 }), // 年度範囲外
    recruit({ no: '4', sex: '牝', recruitYear: 2024, pricePerShare: 10 }), // 年度範囲外
    recruit({ no: '5', sex: '牝', recruitYear: 2020, pricePerShare: null }), // 一口価格不明
    recruit({ no: '6', sex: '牝', recruitYear: 2023, pricePerShare: 10 }),
  ];
  const benchmark = computeFillyBenchmark(recruits);
  assert.equal(benchmark.n, 2);
});

// ---- categorizeFilly ----

test('categorizeFilly: 両方中央値超・片方だけ・どちらも以下・下位1/4を判定する', () => {
  const benchmark = { medianWeightKg: 438, medianChestGirthCm: 174.5, bottomQuartileWeightBoundaryKg: 417 };
  assert.equal(categorizeFilly({ weight: 452, chestGirth: 178 }, benchmark), 'both-above');
  assert.equal(categorizeFilly({ weight: 426, chestGirth: 175 }, benchmark), 'one-above');
  assert.equal(categorizeFilly({ weight: 423, chestGirth: 174.5 }, benchmark), 'below-median'); // 胸囲ちょうど中央値は超に含めない
  assert.equal(categorizeFilly({ weight: 414, chestGirth: 170 }, benchmark), 'bottom-quartile-weight');
  // 境界値ちょうど（417）は下位1/4に含めない
  assert.equal(categorizeFilly({ weight: 417, chestGirth: 174 }, benchmark), 'below-median');
});

// ---- isRegionalStablePending ----

test('isRegionalStablePending: 厩舎欄が"A厩舎or B厩舎"の形なら地方所属予定', () => {
  assert.equal(isRegionalStablePending({ stable: '門別・田中淳司厩舎or大井・荒山勝徳厩舎' }), true);
  assert.equal(isRegionalStablePending({ stable: '鹿戸雄一' }), false);
});

// ---- computeFillyBenchmark（実データ）: 20260913の知見ノートの数値と一致するか ----

test('computeFillyBenchmark（実データ）: 2017-2023年度・牝・価格判明のn=285、中央値438kg/174.5cm', () => {
  const benchmark = computeFillyBenchmark(loadRecruitsWithResultsForTest());
  assert.equal(benchmark.n, 285);
  assert.equal(benchmark.medianWeightKg, 438);
  assert.equal(benchmark.medianChestGirthCm, 174.5);
  assert.equal(benchmark.bottomQuartileWeightBoundaryKg, 417);
});

test('computeFillyBenchmark（実データ）: 両方中央値超113頭・回収率100%超35%(39頭)・中央値57%', () => {
  const benchmark = computeFillyBenchmark(loadRecruitsWithResultsForTest());
  assert.equal(benchmark.above.n, 113);
  assert.equal(benchmark.above.over100Count, 39);
  assert.equal(Math.round(benchmark.above.over100RatePct), 35);
  assert.equal(Math.round(benchmark.above.medianRoiPct), 57);
});

test('computeFillyBenchmark（実データ）: それ以外172頭・回収率100%超18%(31頭)・中央値18%、有意差p<0.01', () => {
  const benchmark = computeFillyBenchmark(loadRecruitsWithResultsForTest());
  assert.equal(benchmark.restOrEqual.n, 172);
  assert.equal(benchmark.restOrEqual.over100Count, 31);
  assert.equal(Math.round(benchmark.restOrEqual.over100RatePct), 18);
  assert.equal(Math.round(benchmark.restOrEqual.medianRoiPct), 18);
  assert.ok(benchmark.over100RateTest.p < 0.01, `p=${benchmark.over100RateTest.p}`);
});

// ---- screenSecondOffering（実データ）: 第2次募集15頭の群分け ----

const SECOND_OFFERING_IDS = Object.keys(
  remainingSharesByHorseId(remainingSharesRows(horses2026, LOTTERY_STATUS_SNAPSHOTS)),
);

test('screenSecondOffering（実データ）: 第2次募集の対象は15頭（牝11・牡4）', () => {
  assert.equal(SECOND_OFFERING_IDS.length, 15);
  const screen = screenSecondOffering(horses2026, SECOND_OFFERING_IDS, loadRecruitsWithResultsForTest());
  assert.equal(screen.females.length, 11);
  assert.equal(screen.males.length, 4);
});

test('screenSecondOffering（実データ）: 牝11頭の群分けが提案資料の内訳と一致する', () => {
  const screen = screenSecondOffering(horses2026, SECOND_OFFERING_IDS, loadRecruitsWithResultsForTest());
  const idsOf = (category: (typeof FEMALE_SIZE_CATEGORY_ORDER)[number]) =>
    screen.females
      .filter((f) => f.category === category)
      .map((f) => f.horse.id)
      .sort((a, b) => Number(a) - Number(b));

  assert.deepEqual(idsOf('both-above'), ['12', '61']);
  assert.deepEqual(idsOf('one-above'), ['26', '82']);
  assert.deepEqual(idsOf('below-median'), ['20', '30', '34', '92']);
  assert.deepEqual(idsOf('bottom-quartile-weight'), ['37', '38', '93']);
});

test('screenSecondOffering（実データ）: 牡4頭はNo.31・79・91・94（群分けしない）', () => {
  const screen = screenSecondOffering(horses2026, SECOND_OFFERING_IDS, loadRecruitsWithResultsForTest());
  assert.deepEqual(
    screen.males.map((m) => m.horse.id),
    ['31', '79', '91', '94'],
  );
});

test('screenSecondOffering（実データ）: 地方所属予定フラグはNo.91〜94だけtrue', () => {
  const screen = screenSecondOffering(horses2026, SECOND_OFFERING_IDS, loadRecruitsWithResultsForTest());
  const all = [...screen.females, ...screen.males];
  const pendingIds = all
    .filter((r) => r.regionalStablePending)
    .map((r) => r.horse.id)
    .sort((a, b) => Number(a) - Number(b));
  assert.deepEqual(pendingIds, ['91', '92', '93', '94']);
});

// ---- gradeWinningSiblingsOf ----

function rawDam(over: Partial<RawDam>): RawDam {
  return {
    damId: '2010100001',
    damName: 'テストメア',
    damUrl: 'https://db.sp.netkeiba.com/horse/2010100001/',
    damClub: 'unknown',
    damOwnerRaw: null,
    damShares: null,
    damStarts: null,
    damWins: null,
    carrotRecruits: [],
    foals: [],
    ...over,
  };
}

function rawFoal(over: Partial<RawFoal>): RawFoal {
  return {
    year: 2020,
    horseId: null,
    url: null,
    name: 'テスト仔',
    sex: null,
    sire: null,
    birthDate: null,
    ownerRaw: null,
    ownerId: null,
    breederRaw: null,
    club: 'unknown',
    clubByOwner: 'unknown',
    isCarrotRecruit: false,
    recruitYear: null,
    sundaySilkCandidate: false,
    shares: null,
    pricePerShareManYen: null,
    starts: null,
    wins: null,
    chuoPrizeManYen: null,
    chihoPrizeManYen: null,
    totalPrizeManYen: null,
    mainWins: [],
    gradeWins: [],
    recordFound: true,
    note: null,
    ...over,
  };
}

test('gradeWinningSiblingsOf: 母のnetkeibaIDから重賞勝ち兄姉だけ返す（どのクラブでもよい）', () => {
  const dam = rawDam({
    foals: [
      rawFoal({ name: '重賞馬', gradeWins: ["23'小倉大賞典(G3)"] }),
      rawFoal({ name: '未勝利馬', gradeWins: [] }),
    ],
  });
  const roster = new Map([['2010100001', dam]]);
  const result = gradeWinningSiblingsOf({ damUrl: 'https://db.netkeiba.com/horse/2010100001/' }, roster);
  assert.deepEqual(
    result.map((f) => f.name),
    ['重賞馬'],
  );
});

test('gradeWinningSiblingsOf: 母が見つからない・damUrlが空なら空配列', () => {
  const roster = new Map<string, RawDam>();
  assert.deepEqual(gradeWinningSiblingsOf({ damUrl: '' }, roster), []);
  assert.deepEqual(gradeWinningSiblingsOf({ damUrl: 'https://db.netkeiba.com/horse/999/' }, roster), []);
});

test('gradeWinningSiblingsOf（実データ）: 15頭のうち重賞勝ち兄姉がいるのはNo.20だけ', () => {
  const damRoster = loadDamRosterForTest();
  const found: { id: string; siblings: string[] }[] = [];
  for (const id of SECOND_OFFERING_IDS) {
    const h = horses2026.find((x) => x.id === id) as Horse;
    const siblings = gradeWinningSiblingsOf(h, damRoster);
    if (siblings.length > 0) found.push({ id, siblings: siblings.map((s) => s.name ?? '') });
  }
  assert.deepEqual(found, [{ id: '20', siblings: ['ヒンドゥタイムズ'] }]);
});
