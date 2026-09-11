/**
 * 1.5次募集（残口のある馬）の判定用の純粋関数。
 *
 * **出所は `src/data/lotteryStatus2026.ts` の `LOTTERY_STATUS_SNAPSHOTS` 一本**。
 * 1.5次募集対象馬一覧（9/11発表）は、抽選ランク発表のsnapshotを引き継いだ上で対象馬の
 * `remainingShares` だけを埋める形で投入されているので、**「最新snapshotで `remainingShares`
 * が入っている馬」＝「1.5次募集の対象馬（残口あり）」** になる。
 * 当初は1.5次募集だけを別ファイル（`secondaryOffering2026.ts`）に持たせていたが、同じ事実を
 * 2箇所で手入力することになり、食い違ったときにどちらが正か決められないので取りやめた
 * （2026-09-11。並行セッションが `lotteryStatus2026.ts` 側に実数を投入したのに合わせた）。
 *
 * `lottery-status.ts` と同じ形（`*Info` の判定・`*Rows` の突き合わせ）に揃えてある。
 */
import type { Horse } from './horses.ts';
import type { LotteryStatusSnapshot, RemainingShares } from '../data/lotteryStatus2026.ts';

export interface RemainingSharesInfo {
  /**
   * 1.5次募集の対象馬（＝残口あり）か。
   * 1.5次募集の発表自体がまだ無いときは `null`（発表待ち）。
   */
  hasRemaining: boolean | null;
  /** 残り口数。対象外・未発表は null。`{ kind: 'exact' | 'atLeast', count }`。 */
  shares: RemainingShares | null;
}

function latestSnapshot(
  snapshots: readonly LotteryStatusSnapshot[],
): LotteryStatusSnapshot | null {
  return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
}

/**
 * 1.5次募集の発表が来ているか（＝最新snapshotに残り口数が1件でも入っているか）。
 *
 * 発表前は抽選ランク発表だけがあり `remainingShares` は全件 null なので、これが false になる。
 * 呼び出し側（一覧の切替・「残口」列・絞り込み）は false のあいだUI自体を出さない
 * ――押しても何も起きない死んだUIを並べないため（`hasSurgeryData` と同じ考え方）。
 */
export function secondaryOfferingAnnounced(
  snapshots: readonly LotteryStatusSnapshot[],
): boolean {
  const latest = latestSnapshot(snapshots);
  if (!latest) return false;
  return Object.values(latest.byId).some((entry) => entry.remainingShares !== null);
}

/**
 * `snapshots` の最新（配列末尾）から、その馬の残口状況を引く。
 *
 * - 1.5次募集の発表がまだ無い → `{ hasRemaining: null, shares: null }`（発表待ち）。
 * - 発表はあるが、その馬に残り口数が入っていない → `{ hasRemaining: false, shares: null }`（満口）。
 * - 残り口数が入っている → `{ hasRemaining: true, shares }`。
 */
export function remainingSharesInfo(
  horseId: string,
  snapshots: readonly LotteryStatusSnapshot[],
): RemainingSharesInfo {
  if (!secondaryOfferingAnnounced(snapshots)) return { hasRemaining: null, shares: null };
  const shares = latestSnapshot(snapshots)?.byId[horseId]?.remainingShares ?? null;
  return { hasRemaining: shares !== null, shares };
}

export interface RemainingSharesRow {
  id: string;
  hasRemaining: boolean | null;
  shares: RemainingShares | null;
}

/**
 * `horses` の各馬に、最新の残口状況を突き合わせる。
 * 一覧列・切替（残口あり/全頭）・個別ページ・バッジのすべてがこの行データを共通の出所にする。
 */
export function remainingSharesRows(
  horses: readonly Horse[],
  snapshots: readonly LotteryStatusSnapshot[],
): RemainingSharesRow[] {
  return horses.map((h) => ({ id: h.id, ...remainingSharesInfo(h.id, snapshots) }));
}

/**
 * 絞り込みの「残口」で使う、馬ID→残口ありか、の対応表。
 * `hasRemaining !== true`（false または null）の馬はキーごと含めない
 * （`HorseFilter.remainingSharesByHorseId` は「無ければ残口なし」として読むため）。
 */
export function remainingSharesByHorseId(
  rows: readonly RemainingSharesRow[],
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const row of rows) {
    if (row.hasRemaining === true) out[row.id] = true;
  }
  return out;
}

/**
 * 通常枠で抽選が発生しなかった（＝1次募集で満口にならなかった）募集番号の一覧。募集番号の昇順。
 * 表示には使わない ―― 1.5次募集の残り口数と突き合わせる検算専用。
 */
export function idsWithoutNormalLotteryOutcome(
  snapshots: readonly LotteryStatusSnapshot[],
): string[] {
  const latest = latestSnapshot(snapshots);
  if (!latest) return [];
  return Object.entries(latest.byId)
    .filter(([, entry]) => entry.normal.outcome !== null && !entry.normal.outcome.lotteryOccurred)
    .map(([id]) => id)
    .sort((a, b) => Number(a) - Number(b));
}

export interface RemainingSharesConsistencyResult {
  ok: boolean;
  /** 通常枠は残口ありのはずなのに、残り口数が入っていない募集番号（昇順） */
  missingRemainingShares: string[];
  /** 残り口数が入っているのに、通常枠は抽選が発生している扱いの募集番号（昇順） */
  unexpectedRemainingShares: string[];
}

/**
 * 「残り口数が入っている馬」と「通常枠で抽選が発生しなかった馬」が一致することを検算する。
 *
 * 同じsnapshotの中で、抽選ランク発表（1次募集）と1.5次募集の残り口数はどちらも手入力なので、
 * 次の発表で写し間違いが起きたらビルドを止めたい（`index.astro` のfrontmatterから呼ぶ）。
 * 1.5次募集の発表がまだ無いときは比べる相手が無いので常に一致扱い（`ok: true`）。
 */
export function checkRemainingSharesConsistency(
  snapshots: readonly LotteryStatusSnapshot[],
): RemainingSharesConsistencyResult {
  if (!secondaryOfferingAnnounced(snapshots)) {
    return { ok: true, missingRemainingShares: [], unexpectedRemainingShares: [] };
  }
  const latest = latestSnapshot(snapshots)!;
  const expected = new Set(idsWithoutNormalLotteryOutcome(snapshots));
  const actual = new Set(
    Object.entries(latest.byId)
      .filter(([, entry]) => entry.remainingShares !== null)
      .map(([id]) => id),
  );
  const byId = (a: string, b: string) => Number(a) - Number(b);
  const missingRemainingShares = [...expected].filter((id) => !actual.has(id)).sort(byId);
  const unexpectedRemainingShares = [...actual].filter((id) => !expected.has(id)).sort(byId);
  return {
    ok: missingRemainingShares.length === 0 && unexpectedRemainingShares.length === 0,
    missingRemainingShares,
    unexpectedRemainingShares,
  };
}

/** 検算に落ちたらビルドを止める（`index.astro` のfrontmatterから呼ぶ）。 */
export function assertRemainingSharesConsistent(
  snapshots: readonly LotteryStatusSnapshot[],
): void {
  const result = checkRemainingSharesConsistency(snapshots);
  if (result.ok) return;
  throw new Error(
    '1.5次募集の残り口数と抽選ランク発表（通常枠）が食い違っている。' +
      `残口ありのはずが口数無し=[${result.missingRemainingShares.join(',')}] ` +
      `口数はあるが抽選発生扱い=[${result.unexpectedRemainingShares.join(',')}]`,
  );
}
