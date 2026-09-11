import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertRemainingSharesConsistent,
  checkRemainingSharesConsistency,
  idsWithoutNormalLotteryOutcome,
  remainingSharesByHorseId,
  remainingSharesInfo,
  remainingSharesRows,
  secondaryOfferingAnnounced,
} from './remaining-shares.ts';
import type { LotteryStatusEntry, LotteryStatusSnapshot } from '../data/lotteryStatus2026.ts';
import { LOTTERY_STATUS_SNAPSHOTS } from '../data/lotteryStatus2026.ts';
import type { Horse } from './horses.ts';

/** 通常枠だけの1頭ぶん。`lotteryOccurred:false` が「1次募集で満口にならなかった」＝残口ありの側。 */
function entry(lotteryOccurred: boolean, shares: LotteryStatusEntry['remainingShares'] = null): LotteryStatusEntry {
  return {
    normal: { outcome: { rank: 'general', lotteryOccurred } as LotteryStatusEntry['normal']['outcome'], note: null },
    remainingShares: shares,
  };
}

/** 抽選ランク発表だけ（1.5次募集の残り口数はまだ入っていない）状態 */
const lotteryOnly: LotteryStatusSnapshot[] = [
  { asOf: '9/10', label: '抽選ランク発表', byId: { '1': entry(true), '9': entry(false) } },
];

/** 1.5次募集の残り口数まで入った状態（対象馬 = No.9・No.12） */
const withSecondary: LotteryStatusSnapshot[] = [
  ...lotteryOnly,
  {
    asOf: '9/11',
    label: '1.5次募集対象馬一覧',
    byId: {
      '1': entry(true),
      '9': entry(false, { kind: 'exact', count: 12 }),
      '12': entry(false, { kind: 'atLeast', count: 100 }),
    },
  },
];

test('secondaryOfferingAnnounced: 残り口数が1件も無ければ「発表前」', () => {
  assert.equal(secondaryOfferingAnnounced([]), false);
  assert.equal(secondaryOfferingAnnounced(lotteryOnly), false);
  assert.equal(secondaryOfferingAnnounced(withSecondary), true);
});

test('remainingSharesInfo: 発表前は hasRemaining も shares も null（発表待ち）', () => {
  assert.deepEqual(remainingSharesInfo('9', []), { hasRemaining: null, shares: null });
  assert.deepEqual(remainingSharesInfo('9', lotteryOnly), { hasRemaining: null, shares: null });
});

test('remainingSharesInfo: 残り口数が入っている馬は残口あり・実数つき', () => {
  assert.deepEqual(remainingSharesInfo('9', withSecondary), {
    hasRemaining: true,
    shares: { kind: 'exact', count: 12 },
  });
  assert.deepEqual(remainingSharesInfo('12', withSecondary), {
    hasRemaining: true,
    shares: { kind: 'atLeast', count: 100 },
  });
});

test('remainingSharesInfo: 口数が入っていない馬・未掲載の馬は満口（false）', () => {
  assert.deepEqual(remainingSharesInfo('1', withSecondary), { hasRemaining: false, shares: null });
  assert.deepEqual(remainingSharesInfo('999', withSecondary), { hasRemaining: false, shares: null });
});

test('remainingSharesInfo: 見るのは最新snapshotだけ（古い発表に引きずられない）', () => {
  const reverted: LotteryStatusSnapshot[] = [
    ...withSecondary,
    { asOf: '9/12', label: '締切', byId: { '9': entry(false) } },
  ];
  assert.deepEqual(remainingSharesInfo('9', reverted), { hasRemaining: null, shares: null });
});

const horses = [{ id: '1' }, { id: '9' }, { id: '12' }] as Horse[];

test('remainingSharesRows: 全頭ぶんを馬IDつきで返す', () => {
  assert.deepEqual(remainingSharesRows(horses, withSecondary), [
    { id: '1', hasRemaining: false, shares: null },
    { id: '9', hasRemaining: true, shares: { kind: 'exact', count: 12 } },
    { id: '12', hasRemaining: true, shares: { kind: 'atLeast', count: 100 } },
  ]);
});

test('remainingSharesByHorseId: 残口ありの馬だけをキーに持つ', () => {
  assert.deepEqual(remainingSharesByHorseId(remainingSharesRows(horses, withSecondary)), {
    '9': true,
    '12': true,
  });
  assert.deepEqual(remainingSharesByHorseId(remainingSharesRows(horses, lotteryOnly)), {});
});

test('idsWithoutNormalLotteryOutcome: 通常枠で抽選が発生しなかった馬を昇順で返す', () => {
  assert.deepEqual(idsWithoutNormalLotteryOutcome(withSecondary), ['9', '12']);
  assert.deepEqual(idsWithoutNormalLotteryOutcome([]), []);
});

test('checkRemainingSharesConsistency: 発表前は比べる相手が無いので常に一致扱い', () => {
  assert.equal(checkRemainingSharesConsistency(lotteryOnly).ok, true);
});

test('checkRemainingSharesConsistency: 残口ありなのに口数が無い馬を拾う', () => {
  const broken: LotteryStatusSnapshot[] = [
    {
      asOf: '9/11',
      label: '1.5次募集対象馬一覧',
      byId: { '9': entry(false, { kind: 'exact', count: 12 }), '12': entry(false) },
    },
  ];
  const result = checkRemainingSharesConsistency(broken);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingRemainingShares, ['12']);
  assert.deepEqual(result.unexpectedRemainingShares, []);
  assert.throws(() => assertRemainingSharesConsistent(broken), /食い違っている/);
});

test('checkRemainingSharesConsistency: 抽選が発生した馬に口数が入っていたら拾う', () => {
  const broken: LotteryStatusSnapshot[] = [
    {
      asOf: '9/11',
      label: '1.5次募集対象馬一覧',
      byId: { '1': entry(true, { kind: 'exact', count: 5 }), '9': entry(false, { kind: 'exact', count: 12 }) },
    },
  ];
  const result = checkRemainingSharesConsistency(broken);
  assert.equal(result.ok, false);
  assert.deepEqual(result.unexpectedRemainingShares, ['1']);
});

// --- 実データに対する検算（本番で表示される値そのものを確かめる） ---

test('実データ: 1.5次募集の対象馬は23頭で、通常枠で抽選が発生しなかった馬と完全一致する', () => {
  const result = checkRemainingSharesConsistency(LOTTERY_STATUS_SNAPSHOTS);
  assert.equal(result.ok, true);
  const ids = idsWithoutNormalLotteryOutcome(LOTTERY_STATUS_SNAPSHOTS);
  assert.equal(ids.length, 23);
  // 出所PDF（2026-09-10「第1次募集最終集計結果」の「1.5次募集」列が○の馬）を書き写したもの。
  assert.deepEqual(ids, [
    '9', '12', '17', '19', '20', '24', '26', '28', '30', '31', '32', '34',
    '37', '38', '61', '74', '79', '82', '90', '91', '92', '93', '94',
  ]);
});

test('実データ: 1.5次募集の発表が入っている（一覧の切替・列が出る状態）', () => {
  assert.equal(secondaryOfferingAnnounced(LOTTERY_STATUS_SNAPSHOTS), true);
});
