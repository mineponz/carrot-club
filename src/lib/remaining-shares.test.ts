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
  soldOutInRoundByHorseId,
} from './remaining-shares.ts';
import type { LotteryStatusEntry, LotteryStatusSnapshot } from '../data/lotteryStatus2026.ts';
import { LOTTERY_STATUS_SNAPSHOTS } from '../data/lotteryStatus2026.ts';
import type { Horse } from './horses.ts';
import { horses2026 } from '../data/horses2026.ts';

/** 通常枠だけの1頭ぶん。`lotteryOccurred:false` が「1次募集で満口にならなかった」＝残口ありの側。 */
function entry(
  lotteryOccurred: boolean,
  shares: LotteryStatusEntry['remainingShares'] = null,
  soldOutInRound?: LotteryStatusEntry['soldOutInRound'],
): LotteryStatusEntry {
  return {
    normal: { outcome: { rank: 'general', lotteryOccurred } as LotteryStatusEntry['normal']['outcome'], note: null },
    remainingShares: shares,
    ...(soldOutInRound === undefined ? {} : { soldOutInRound }),
  };
}

/** 抽選ランク発表だけ（追加募集の残り口数はまだ入っていない）状態 */
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
  const waiting = { hasRemaining: null, shares: null, soldOutInRound: null };
  assert.deepEqual(remainingSharesInfo('9', []), waiting);
  assert.deepEqual(remainingSharesInfo('9', lotteryOnly), waiting);
});

test('remainingSharesInfo: 残り口数が入っている馬は残口あり・実数つき', () => {
  assert.deepEqual(remainingSharesInfo('9', withSecondary), {
    hasRemaining: true,
    shares: { kind: 'exact', count: 12 },
    soldOutInRound: null,
  });
  assert.deepEqual(remainingSharesInfo('12', withSecondary), {
    hasRemaining: true,
    shares: { kind: 'atLeast', count: 100 },
    soldOutInRound: null,
  });
});

test('remainingSharesInfo: 口数が入っていない馬・未掲載の馬は満口（false）', () => {
  const soldOut = { hasRemaining: false, shares: null, soldOutInRound: null };
  assert.deepEqual(remainingSharesInfo('1', withSecondary), soldOut);
  assert.deepEqual(remainingSharesInfo('999', withSecondary), soldOut);
});

test('remainingSharesInfo: 見るのは最新snapshotだけ（古い発表に引きずられない）', () => {
  const reverted: LotteryStatusSnapshot[] = [
    ...withSecondary,
    { asOf: '9/12', label: '締切', byId: { '9': entry(false) } },
  ];
  assert.deepEqual(remainingSharesInfo('9', reverted), {
    hasRemaining: null,
    shares: null,
    soldOutInRound: null,
  });
});

const horses = [{ id: '1' }, { id: '9' }, { id: '12' }] as Horse[];

test('remainingSharesRows: 全頭ぶんを馬IDつきで返す', () => {
  assert.deepEqual(remainingSharesRows(horses, withSecondary), [
    { id: '1', hasRemaining: false, shares: null, soldOutInRound: null },
    { id: '9', hasRemaining: true, shares: { kind: 'exact', count: 12 }, soldOutInRound: null },
    { id: '12', hasRemaining: true, shares: { kind: 'atLeast', count: 100 }, soldOutInRound: null },
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

test('実データ: 残口あり15頭 ∪ 1.5次完売8頭 = 通常枠で抽選が発生しなかった23頭', () => {
  const result = checkRemainingSharesConsistency(LOTTERY_STATUS_SNAPSHOTS);
  assert.equal(result.ok, true);

  // 1次募集の結果そのもの。募集回が進んでも動かない（出所PDF: 2026-09-10
  // 「第1次募集最終集計結果」の「1.5次募集」列が○の馬）。
  const ids = idsWithoutNormalLotteryOutcome(LOTTERY_STATUS_SNAPSHOTS);
  assert.deepEqual(ids, [
    '9', '12', '17', '19', '20', '24', '26', '28', '30', '31', '32', '34',
    '37', '38', '61', '74', '79', '82', '90', '91', '92', '93', '94',
  ]);

  const rows = remainingSharesRows(horses2026, LOTTERY_STATUS_SNAPSHOTS);
  // 第2次募集の対象15頭（出所PDF: 2026-09-16「第2次募集対象馬一覧」）。
  const remaining = Object.keys(remainingSharesByHorseId(rows)).sort((a, b) => Number(a) - Number(b));
  assert.deepEqual(remaining, [
    '12', '20', '26', '30', '31', '34', '37', '38', '61', '79', '82', '91', '92', '93', '94',
  ]);
  // 1.5次募集で満口になった8頭（＝上のPDFから消えた馬）。
  const soldOut = Object.keys(soldOutInRoundByHorseId(rows)).sort((a, b) => Number(a) - Number(b));
  assert.deepEqual(soldOut, ['9', '17', '19', '24', '28', '32', '74', '90']);
  assert.deepEqual([...remaining, ...soldOut].sort((a, b) => Number(a) - Number(b)), ids);
});

test('実データ: 残り口数は第2次募集のPDFどおり（実数6頭・100口以上6頭・25口以上3頭）', () => {
  const byId = new Map(
    remainingSharesRows(horses2026, LOTTERY_STATUS_SNAPSHOTS).map((r) => [r.id, r.shares]),
  );
  assert.deepEqual(byId.get('12'), { kind: 'exact', count: 65 });
  assert.deepEqual(byId.get('26'), { kind: 'exact', count: 83 });
  assert.deepEqual(byId.get('31'), { kind: 'exact', count: 100 });
  assert.deepEqual(byId.get('38'), { kind: 'exact', count: 79 });
  assert.deepEqual(byId.get('61'), { kind: 'exact', count: 40 });
  assert.deepEqual(byId.get('94'), { kind: 'exact', count: 13 });
  // 実数が出ないのは残口が100口（地方入厩予定馬は25口）を超える馬。
  assert.deepEqual(byId.get('20'), { kind: 'atLeast', count: 100 });
  assert.deepEqual(byId.get('91'), { kind: 'atLeast', count: 25 });
});

test('実データ: 追加募集の発表が入っている（一覧の切替・列が出る状態）', () => {
  assert.equal(secondaryOfferingAnnounced(LOTTERY_STATUS_SNAPSHOTS), true);
});

test('checkRemainingSharesConsistency: 残口と満口フラグが両方立っていたら落ちる', () => {
  const broken: LotteryStatusSnapshot[] = [
    {
      asOf: '9/16',
      label: '第2次募集対象馬一覧',
      byId: { '9': entry(false, { kind: 'exact', count: 12 }, '1.5') },
    },
  ];
  const result = checkRemainingSharesConsistency(broken);
  assert.equal(result.ok, false);
  assert.deepEqual(result.bothRemainingAndSoldOut, ['9']);
});

test('checkRemainingSharesConsistency: 満口フラグだけでも「残口ありだった馬」として数える', () => {
  const ok: LotteryStatusSnapshot[] = [
    {
      asOf: '9/16',
      label: '第2次募集対象馬一覧',
      byId: {
        '1': entry(true),
        '9': entry(false, null, '1.5'),
        '12': entry(false, { kind: 'exact', count: 65 }),
      },
    },
  ];
  assert.equal(checkRemainingSharesConsistency(ok).ok, true);
  assert.deepEqual(soldOutInRoundByHorseId(remainingSharesRows([{ id: '9' }] as Horse[], ok)), {
    '9': '1.5',
  });
});
