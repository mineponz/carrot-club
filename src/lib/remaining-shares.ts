/**
 * 追加募集（1.5次募集・第2次募集…）で残口のある馬の判定用の純粋関数。
 *
 * **出所は `src/data/lotteryStatus2026.ts` の `LOTTERY_STATUS_SNAPSHOTS` 一本**。
 * 追加募集の対象馬一覧は、抽選ランク発表のsnapshotを引き継いだ上で対象馬の
 * `remainingShares` だけを埋める形で投入されているので、**「最新snapshotで `remainingShares`
 * が入っている馬」＝「今の募集回で出資できる馬（残口あり）」** になる。
 *
 * 募集回が進むと、前の回で残口があった馬が満口になって対象馬一覧から消える。消えた馬は
 * `remainingShares: null` に戻るので、**そのままだと1次募集で満口になった馬と区別できない**。
 * そこで `soldOutInRound`（満口になった募集回）を別に持たせ、
 * **残口あり ∪ 途中で満口 ＝ 通常枠で抽選が発生しなかった馬** を不変条件として検算する
 * （2026-09-16。1.5次募集の23頭が、第2次募集の15頭＋1.5次で満口の8頭に分かれた回で導入）。
 * 当初は1.5次募集だけを別ファイル（`secondaryOffering2026.ts`）に持たせていたが、同じ事実を
 * 2箇所で手入力することになり、食い違ったときにどちらが正か決められないので取りやめた
 * （2026-09-11。並行セッションが `lotteryStatus2026.ts` 側に実数を投入したのに合わせた）。
 *
 * `lottery-status.ts` と同じ形（`*Info` の判定・`*Rows` の突き合わせ）に揃えてある。
 */
import type { Horse } from './horses.ts';
import type {
  LotteryStatusEntry,
  LotteryStatusSnapshot,
  RemainingShares,
} from '../data/lotteryStatus2026.ts';

/** 満口になった募集回（`LotteryStatusEntry['soldOutInRound']` の非undefined側）。 */
export type SoldOutRound = NonNullable<LotteryStatusEntry['soldOutInRound']>;

export interface RemainingSharesInfo {
  /**
   * 今の募集回の対象馬（＝残口あり）か。
   * 追加募集の発表自体がまだ無いときは `null`（発表待ち）。
   */
  hasRemaining: boolean | null;
  /** 残り口数。対象外・未発表は null。`{ kind: 'exact' | 'atLeast', count }`。 */
  shares: RemainingShares | null;
  /**
   * 追加募集の途中で満口になった馬の、満口になった募集回（例 `'1.5'`）。
   * 1次募集で満口になった馬・まだ残口のある馬は null。
   */
  soldOutInRound: SoldOutRound | null;
}

function latestSnapshot(
  snapshots: readonly LotteryStatusSnapshot[],
): LotteryStatusSnapshot | null {
  return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
}

/**
 * 追加募集の発表が来ているか（＝最新snapshotに残り口数が1件でも入っているか）。
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
 * - 追加募集の発表がまだ無い → `{ hasRemaining: null, shares: null }`（発表待ち）。
 * - 発表はあるが、その馬に残り口数が入っていない → `{ hasRemaining: false, shares: null }`（満口）。
 * - 残り口数が入っている → `{ hasRemaining: true, shares }`。
 *
 * 満口の馬のうち、**前の募集回では残口があったのに今回満口になった馬**だけ
 * `soldOutInRound` が入る（表示の「1.5次完売」はこれを見る）。
 */
export function remainingSharesInfo(
  horseId: string,
  snapshots: readonly LotteryStatusSnapshot[],
): RemainingSharesInfo {
  if (!secondaryOfferingAnnounced(snapshots)) {
    return { hasRemaining: null, shares: null, soldOutInRound: null };
  }
  const entry = latestSnapshot(snapshots)?.byId[horseId];
  const shares = entry?.remainingShares ?? null;
  return { hasRemaining: shares !== null, shares, soldOutInRound: entry?.soldOutInRound ?? null };
}

export interface RemainingSharesRow {
  id: string;
  hasRemaining: boolean | null;
  shares: RemainingShares | null;
  soldOutInRound: SoldOutRound | null;
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
 * 追加募集の途中で満口になった馬のID→その募集回、の対応表。
 * 一覧の「1.5次完売」ラベル・個別ページのバッジがここを見る。
 */
export function soldOutInRoundByHorseId(
  rows: readonly RemainingSharesRow[],
): Record<string, SoldOutRound> {
  const out: Record<string, SoldOutRound> = {};
  for (const row of rows) {
    if (row.soldOutInRound !== null) out[row.id] = row.soldOutInRound;
  }
  return out;
}

/**
 * 通常枠で抽選が発生しなかった（＝1次募集で満口にならなかった）募集番号の一覧。募集番号の昇順。
 * 表示には使わない ―― 追加募集の残り口数と突き合わせる検算専用。
 * **募集回が進んでも値は変わらない**（1次募集の結果そのものなので）。2026年度なら常に23頭。
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
  /** 通常枠は残口ありのはずなのに、残り口数も満口フラグも入っていない募集番号（昇順） */
  missingRemainingShares: string[];
  /** 残り口数か満口フラグが入っているのに、通常枠は抽選が発生している扱いの募集番号（昇順） */
  unexpectedRemainingShares: string[];
  /** 残り口数と満口フラグが同じ馬に両方入っている募集番号（昇順）。どちらか一方しかありえない */
  bothRemainingAndSoldOut: string[];
}

/**
 * **残口あり ∪ 追加募集の途中で満口 ＝ 通常枠で抽選が発生しなかった馬**、を検算する。
 *
 * 同じsnapshotの中で、抽選ランク発表（1次募集）の結果と追加募集の残り口数はどちらも手入力なので、
 * 次の発表で写し間違いが起きたらビルドを止めたい（`index.astro` のfrontmatterから呼ぶ）。
 * 追加募集の発表がまだ無いときは比べる相手が無いので常に一致扱い（`ok: true`）。
 *
 * 募集回が進むと左辺の内訳だけが移る（2026年度: 1.5次は 23+0、第2次は 15+8）。**合計23頭は
 * 1次募集の結果そのものなので動かない**ので、次の回の投入で1頭でも取りこぼせばここで落ちる。
 */
export function checkRemainingSharesConsistency(
  snapshots: readonly LotteryStatusSnapshot[],
): RemainingSharesConsistencyResult {
  if (!secondaryOfferingAnnounced(snapshots)) {
    return {
      ok: true,
      missingRemainingShares: [],
      unexpectedRemainingShares: [],
      bothRemainingAndSoldOut: [],
    };
  }
  const latest = latestSnapshot(snapshots)!;
  const expected = new Set(idsWithoutNormalLotteryOutcome(snapshots));
  const entries = Object.entries(latest.byId);
  const actual = new Set(
    entries
      .filter(([, entry]) => entry.remainingShares !== null || entry.soldOutInRound !== undefined)
      .map(([id]) => id),
  );
  const byId = (a: string, b: string) => Number(a) - Number(b);
  const missingRemainingShares = [...expected].filter((id) => !actual.has(id)).sort(byId);
  const unexpectedRemainingShares = [...actual].filter((id) => !expected.has(id)).sort(byId);
  const bothRemainingAndSoldOut = entries
    .filter(([, entry]) => entry.remainingShares !== null && entry.soldOutInRound !== undefined)
    .map(([id]) => id)
    .sort(byId);
  return {
    ok:
      missingRemainingShares.length === 0 &&
      unexpectedRemainingShares.length === 0 &&
      bothRemainingAndSoldOut.length === 0,
    missingRemainingShares,
    unexpectedRemainingShares,
    bothRemainingAndSoldOut,
  };
}

/** 検算に落ちたらビルドを止める（`index.astro` のfrontmatterから呼ぶ）。 */
export function assertRemainingSharesConsistent(
  snapshots: readonly LotteryStatusSnapshot[],
): void {
  const result = checkRemainingSharesConsistency(snapshots);
  if (result.ok) return;
  throw new Error(
    '追加募集の残り口数と抽選ランク発表（通常枠）が食い違っている。' +
      `残口ありのはずが口数も満口フラグも無し=[${result.missingRemainingShares.join(',')}] ` +
      `口数か満口フラグはあるが抽選発生扱い=[${result.unexpectedRemainingShares.join(',')}] ` +
      `残口と満口フラグが両方=[${result.bothRemainingAndSoldOut.join(',')}]`,
  );
}
