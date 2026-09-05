import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_LOTTERY_RANKS,
  lotteryLabel,
  lotterySeverity,
  lotteryStatusRows,
  sortLotteryStatusRows,
  type LotteryStatusRow,
} from './lottery-status.ts';
import type { FrameLotteryResult, LotteryStatusSnapshot } from '../data/lotteryStatus2026.ts';
import type { Horse } from './horses.ts';

function makeHorse(overrides: Partial<Horse> & Pick<Horse, 'id'>): Horse {
  return {
    name: `テスト号${overrides.id}`,
    sex: '牡',
    netkeibaUrl: 'https://example.com/',
    sire: 'テストサイアー',
    broodmareSire: 'テスト母父',
    damAge: 8,
    damParity: 3,
    birthDate: '2024-03-01',
    stable: 'テスト厩舎',
    pricePerShare: 20,
    height: 158,
    chestGirth: 178,
    caretGirth: 20,
    weight: 440,
    sibling: '',
    damPriority: false,
    surgery: '',
    xSearchUrl: 'https://x.com/search',
    damUrl: '',
    ...overrides,
  };
}

function frame(overrides: Partial<FrameLotteryResult> = {}): FrameLotteryResult {
  return { cutoffRank: 'x2', lotteryOccurred: true, note: null, ...overrides };
}

test('lotteryLabel: cutoffRankがnullなら発表待ち/mid', () => {
  const label = lotteryLabel(frame({ cutoffRank: null }));
  assert.deepEqual(label, { text: '発表待ち', tone: 'mid' });
});

test('lotteryLabel: 抽選発生ならランク名+抽選/strong', () => {
  assert.deepEqual(lotteryLabel(frame({ cutoffRank: 'x2', lotteryOccurred: true })), {
    text: '最優先×2抽選',
    tone: 'strong',
  });
  assert.deepEqual(lotteryLabel(frame({ cutoffRank: 'general', lotteryOccurred: true })), {
    text: '一般抽選',
    tone: 'strong',
  });
});

test('lotteryLabel: 抽選なし（満口）ならランク名+で確保/clear', () => {
  assert.deepEqual(lotteryLabel(frame({ cutoffRank: 'x1', lotteryOccurred: false })), {
    text: '最優先×1で確保',
    tone: 'clear',
  });
});

test('lotteryLabel: ranksに無いcutoffRankはエラー（データ入力ミスに早く気づくため）', () => {
  assert.throws(() => lotteryLabel(frame({ cutoffRank: 'general' }), ['x2', 'x1', 'none']));
});

test('lotteryLabel: ranks省略時はALL_LOTTERY_RANKSが使われる', () => {
  assert.doesNotThrow(() => lotteryLabel(frame({ cutoffRank: 'general' })));
  assert.equal(ALL_LOTTERY_RANKS.length, 4);
});

test('lotterySeverity: 抽選発生 > 確保 > 未発表(-1) の順で、同じ区分内は強いランクほど大きい', () => {
  const occurredX2 = lotterySeverity(frame({ cutoffRank: 'x2', lotteryOccurred: true }));
  const occurredGeneral = lotterySeverity(frame({ cutoffRank: 'general', lotteryOccurred: true }));
  const securedX2 = lotterySeverity(frame({ cutoffRank: 'x2', lotteryOccurred: false }));
  const unannounced = lotterySeverity(null);
  assert.ok(occurredX2 > occurredGeneral);
  assert.ok(occurredGeneral > securedX2);
  assert.equal(unannounced, -1);
  assert.ok(securedX2 > unannounced);
});

test('lotteryStatusRows: 発表済みの馬はdamPriority/normal/remainingSharesが入る', () => {
  const horses = [makeHorse({ id: '1', damPriority: true }), makeHorse({ id: '2' })];
  const snapshots: LotteryStatusSnapshot[] = [
    {
      asOf: '9/11',
      label: '抽選ランク発表',
      byId: {
        '1': {
          damPriority: frame({ cutoffRank: 'none', lotteryOccurred: false }),
          normal: frame({ cutoffRank: 'general', lotteryOccurred: true }),
          remainingShares: null,
        },
        '2': {
          normal: frame({ cutoffRank: 'general', lotteryOccurred: false }),
          remainingShares: 12,
        },
      },
    },
  ];
  const rows = lotteryStatusRows(horses, snapshots);
  assert.equal(rows[0].hasDamPriority, true);
  assert.deepEqual(rows[0].damPriority, { cutoffRank: 'none', lotteryOccurred: false, note: null });
  assert.equal(rows[0].normal?.cutoffRank, 'general');
  assert.equal(rows[1].hasDamPriority, false);
  assert.equal(rows[1].damPriority, null);
  assert.equal(rows[1].remainingShares, 12);
});

test('lotteryStatusRows: 未掲載の馬・snapshotsが空の場合はすべてnull', () => {
  const horses = [makeHorse({ id: '1' })];
  assert.deepEqual(lotteryStatusRows(horses, []), [
    {
      id: '1',
      name: 'テスト号1',
      sire: 'テストサイアー',
      sex: '牡',
      hasDamPriority: false,
      damPriority: null,
      normal: null,
      remainingShares: null,
    },
  ]);
  const rowsWithEmptyById = lotteryStatusRows(horses, [{ asOf: '9/11', label: '抽選ランク発表', byId: {} }]);
  assert.equal(rowsWithEmptyById[0].normal, null);
});

test('lotteryStatusRows: 複数snapshotがある場合は最新（配列末尾）だけを見る', () => {
  const horses = [makeHorse({ id: '1' })];
  const snapshots: LotteryStatusSnapshot[] = [
    {
      asOf: '9/11',
      label: '1次募集',
      byId: { '1': { normal: frame({ cutoffRank: 'x2', lotteryOccurred: true }), remainingShares: null } },
    },
    {
      asOf: '9/20',
      label: '1.5次募集',
      byId: { '1': { normal: frame({ cutoffRank: 'general', lotteryOccurred: false }), remainingShares: 3 } },
    },
  ];
  const rows = lotteryStatusRows(horses, snapshots);
  assert.equal(rows[0].normal?.cutoffRank, 'general');
  assert.equal(rows[0].remainingShares, 3);
});

test('sortLotteryStatusRows: normalキーで抽選発生を上位に並べ、未発表は常に末尾', () => {
  const rows: LotteryStatusRow[] = [
    {
      id: '1',
      name: '確保馬',
      sire: 'A',
      sex: '牡',
      hasDamPriority: false,
      damPriority: null,
      normal: frame({ cutoffRank: 'x2', lotteryOccurred: false }),
      remainingShares: null,
    },
    {
      id: '2',
      name: '未発表馬',
      sire: 'A',
      sex: '牡',
      hasDamPriority: false,
      damPriority: null,
      normal: null,
      remainingShares: null,
    },
    {
      id: '3',
      name: '抽選発生馬',
      sire: 'A',
      sex: '牡',
      hasDamPriority: false,
      damPriority: null,
      normal: frame({ cutoffRank: 'general', lotteryOccurred: true }),
      remainingShares: null,
    },
  ];
  const sortedDesc = sortLotteryStatusRows(rows, 'normal', 'desc');
  assert.deepEqual(sortedDesc.map((r) => r.id), ['3', '1', '2']);
  const sortedAsc = sortLotteryStatusRows(rows, 'normal', 'asc');
  // 昇順でも未発表は末尾（降順で先頭に出て「抽選が一番強い馬」と見間違えないように）
  assert.equal(sortedAsc.at(-1)!.id, '2');
});

test('sortLotteryStatusRows: remainingSharesは数値順、未確定(null)は常に末尾', () => {
  const base = {
    sire: 'A',
    sex: '牡' as const,
    hasDamPriority: false,
    damPriority: null,
    normal: null,
  };
  const rows: LotteryStatusRow[] = [
    { id: '1', name: 'a', ...base, remainingShares: 5 },
    { id: '2', name: 'b', ...base, remainingShares: null },
    { id: '3', name: 'c', ...base, remainingShares: 20 },
  ];
  const sorted = sortLotteryStatusRows(rows, 'remainingShares', 'desc');
  assert.deepEqual(sorted.map((r) => r.id), ['3', '1', '2']);
});

test('sortLotteryStatusRows: idは数値として並べ替える', () => {
  const base = {
    name: 'x',
    sire: 'A',
    sex: '牡' as const,
    hasDamPriority: false,
    damPriority: null,
    normal: null,
    remainingShares: null,
  };
  const rows: LotteryStatusRow[] = [
    { id: '10', ...base },
    { id: '2', ...base },
  ];
  const sorted = sortLotteryStatusRows(rows, 'id', 'asc');
  assert.deepEqual(sorted.map((r) => r.id), ['2', '10']);
});
