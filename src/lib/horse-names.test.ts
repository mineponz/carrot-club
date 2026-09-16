import test from 'node:test';
import assert from 'node:assert/strict';
import type { RecruitWithResult } from './analysis-data.ts';
import {
  originOf,
  normalizeLanguage,
  nameLength,
  damNameOfHorseName,
  loadHorseNames,
  joinRecruit,
  stripImportPrefix,
  HORSE_NAMES_FETCHED_AT,
  HORSE_NAMES_SOURCE,
} from './horse-names.ts';

// ---- origin ------------------------------------------------------------

test('originOf: 本人指定の8ケース', () => {
  assert.equal(originOf('父名、母父名より連想'), 'sire'); // コティノス
  assert.equal(originOf('母、母母名より連想'), 'dam');
  assert.equal(originOf('父名、母名より連想'), 'both');
  assert.equal(originOf('母と同じような栄光をつかむことを願って'), 'other');
  assert.equal(originOf('母から子への伝承'), 'other');
  assert.equal(originOf('牝系の名より'), 'dam');
  assert.equal(originOf('父の出身である愛国の神話'), 'sire');
  assert.equal(originOf('両親名より連想'), 'both');
});

test('originOf: 「母父名」を含んでいても他に母方語が無ければ母方に数えない', () => {
  // 「母父名」は判定前に取り除かれる。取り除いた後に母方語（母名・母系・牝系等）が
  // 残らなければ、母父名の存在だけでは dam/both にならない（実データより）。
  assert.equal(
    originOf('ロバート・デニーロ監督の映画「ブロンクス物語」の原題より。父名および母父名より連想。'),
    'sire'
  );
  assert.equal(originOf('主力艦。母名、母父名より連想。Ｇ１で主力となることを願い。'), 'dam');
});

// ---- language ------------------------------------------------------------

test('normalizeLanguage: 表記ゆれの正規化', () => {
  assert.equal(normalizeLanguage('希語'), 'ギリシャ語');
  assert.equal(normalizeLanguage('古代ギリシャ語'), 'ギリシャ語');
  assert.equal(normalizeLanguage('葡語'), 'ポルトガル語');
  assert.equal(normalizeLanguage('蘭語'), 'オランダ語');
  assert.equal(normalizeLanguage('ペルシャ語'), 'ペルシア語');
  assert.equal(normalizeLanguage('西国'), '西語');
});

test('normalizeLanguage: 変換不要な言語はそのまま', () => {
  assert.equal(normalizeLanguage('英語'), '英語');
  assert.equal(normalizeLanguage('仏語'), '仏語');
  assert.equal(normalizeLanguage('ペルシア語'), 'ペルシア語');
});

test('normalizeLanguage: 「、」「＋」区切りの複数言語は「複数」に寄せる', () => {
  assert.equal(normalizeLanguage('英語、仏語'), '複数');
  assert.equal(normalizeLanguage('仏語、英語'), '複数');
  assert.equal(normalizeLanguage('英語＋ラテン語'), '複数');
});

// ---- 外国産馬の接頭辞 ------------------------------------------------------

test('stripImportPrefix: 「外)」「外）」を落とす（半角・全角とも）', () => {
  // recruits.json 側に「外)ザガールインザットソング」と半角括弧つきの母名があり、
  // これを落とさないと馬名一覧側の「ザガールインザットソング」と結合できない
  // （2026-09-16、セレナズヴォイス1頭がこれで取りこぼされていた）。
  assert.equal(stripImportPrefix('外)ザガールインザットソング'), 'ザガールインザットソング');
  assert.equal(stripImportPrefix('外）ザガールインザットソング'), 'ザガールインザットソング');
  assert.equal(stripImportPrefix('ザガールインザットソング'), 'ザガールインザットソング');
  // 名前の途中に出てくる「外」は落とさない
  assert.equal(stripImportPrefix('カイガイエンセイ'), 'カイガイエンセイ');
});

test('normalizeLanguage: 空文字はnull', () => {
  assert.equal(normalizeLanguage(''), null);
  assert.equal(normalizeLanguage('   '), null);
});

// ---- length ------------------------------------------------------------

test('nameLength: 長音・小書き文字も1字と数える', () => {
  assert.equal(nameLength('パルパデオ'), 5);
  assert.equal(nameLength('シャルロッテ'), 6); // シ・ャ・ル・ロ・ッ・テ
  assert.equal(nameLength('コティノス'), 5);
});

// ---- damName ------------------------------------------------------------

test('damNameOfHorseName: 「◯◯の2024」から母馬名を取り出す', () => {
  assert.equal(damNameOfHorseName('ピンクアリエスの2024'), 'ピンクアリエス');
  assert.equal(damNameOfHorseName('外）リカビトスの2024'), 'リカビトス');
});

test('damNameOfHorseName: 募集名の形でなければnull', () => {
  assert.equal(damNameOfHorseName('ナミュール'), null);
});

test('damNameOfHorseName: Ⅱ/IIの表記ゆれを吸収する（horse-meta.tsのnormalizeDamNameと同じ）', () => {
  assert.equal(damNameOfHorseName('アンフィトリテⅡの2020'), damNameOfHorseName('アンフィトリテIIの2020'));
});

// ---- loadHorseNames（実データ） -------------------------------------------

test('loadHorseNames: 2016〜2024年産は838頭（本人確認済みの粗集計と一致）', () => {
  const entries = loadHorseNames({ fromBirthYear: 2016, toBirthYear: 2024 });
  assert.equal(entries.length, 838);
  assert.ok(entries.every((e) => e.birthYear >= 2016 && e.birthYear <= 2024));
});

test('loadHorseNames: origin/language/length/damNameが1頭ずつ付く', () => {
  const entries = loadHorseNames({ fromBirthYear: 2023, toBirthYear: 2023 });
  const kotinosu = entries.find((e) => e.name === 'コティノス');
  assert.ok(kotinosu, 'コティノスが2023年産に見つかること');
  assert.equal(kotinosu?.origin, 'sire');
  assert.equal(kotinosu?.languageNormalized, 'ギリシャ語');
  assert.equal(kotinosu?.length, nameLength('コティノス'));
  assert.equal(kotinosu?.damName, 'ココファンタジア');
});

test('loadHorseNames: 範囲外の年は含まない', () => {
  const entries = loadHorseNames({ fromBirthYear: 2016, toBirthYear: 2024 });
  assert.ok(!entries.some((e) => e.birthYear < 2016 || e.birthYear > 2024));
});

test('HORSE_NAMES_FETCHED_AT / HORSE_NAMES_SOURCE: 取得時点と出所が入っている', () => {
  assert.equal(HORSE_NAMES_FETCHED_AT, '2026-09-16');
  assert.ok(HORSE_NAMES_SOURCE.includes('carrotclub.net'));
});

// ---- joinRecruit ------------------------------------------------------------

/** recruits.jsonの1頭ぶんのひな形（sibling-recruits.test.tsと同じ方針）。 */
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
    damParity: 4,
    damProduceCount: 6,
    damGapBeforeYears: 1,
    birthDate: '2024-03-15',
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

test('joinRecruit: 母名（正規化）＋生年（recruitYear-1）で一致する馬を返す', () => {
  const recruits = [
    recruit({ recruitYear: 2025, damName: 'テストメア' }), // birthYear 2024
    recruit({ recruitYear: 2022, damName: 'テストメア' }), // birthYear 2021（別の年の同名母）
  ];
  const found = joinRecruit({ damName: 'テストメア', birthYear: 2024 }, recruits);
  assert.equal(found, recruits[0]);
  const found2021 = joinRecruit({ damName: 'テストメア', birthYear: 2021 }, recruits);
  assert.equal(found2021, recruits[1]);
});

test('joinRecruit: damNameがnullなら常にnull', () => {
  const recruits = [recruit({ damName: null })];
  assert.equal(joinRecruit({ damName: null, birthYear: 2024 }, recruits), null);
});

test('joinRecruit: 一致する母名・生年が無ければnull', () => {
  const recruits = [recruit({ recruitYear: 2025, damName: 'テストメア' })];
  assert.equal(joinRecruit({ damName: '別の母', birthYear: 2024 }, recruits), null);
  assert.equal(joinRecruit({ damName: 'テストメア', birthYear: 2020 }, recruits), null);
});
