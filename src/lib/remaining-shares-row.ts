/**
 * 残口（追加募集で今から出資できる馬）のHTML組み立て（一覧の「残口」列セル）。
 *
 * `remaining-shares.ts`（ロジック）と分けてあるのは `lottery-status.ts`/`lottery-status-row.ts`
 * と同じ理由（ロジックとマークアップを分離し、両方とも `node --test` で検証できるようにするため）。
 */
import type { RemainingSharesRow, SoldOutRound } from './remaining-shares.ts';

/**
 * 追加募集の途中で満口になった馬のラベル（例 `'1.5'` → 「1.5次完売」）。
 * 募集回の値からそのまま作る（回が増えても書き足さずに済む）。
 */
export function soldOutLabel(round: SoldOutRound): string {
  return `${round}次完売`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 一覧テーブル「残口」列の中身（`<td>` の中身だけ。`<td>` 自体は `horse-row.ts` 側が出す）。
 *
 * - `row` が `null`（＝その年度に情報源が無い。2025年募集など）→ 「—」。
 * - 未発表（追加募集の発表自体がまだ無い）→ 「発表待ち」。
 * - 対象（残り口数が入っている）→ 「12口」。クラブが実数を出すのは残口100口（地方入厩予定馬は
 *   25口）以下の馬だけで、それを超える馬は「100口以上」になる（`kind: 'atLeast'`。表記の規則は
 *   `lottery-status-row.ts` と同じ）。いずれもバッジで強調する。
 * - 前の回では残口があったが今回満口になった馬 → 「1.5次完売」。**残口ありのバッジとは別の
 *   控えめな見た目にする**（`remaining-sold-out`）。今から出資できる馬と紛らわしくしないため。
 * - それ以外の対象外（1次募集で満口）→ 「—」。
 */
export function remainingSharesCellHtml(row: RemainingSharesRow | null): string {
  if (row === null) return '—';
  if (row.hasRemaining === null) return '発表待ち';
  if (!row.hasRemaining) {
    if (!row.soldOutInRound) return '—';
    return `<span class="remaining-sold-out">${escapeHtml(soldOutLabel(row.soldOutInRound))}</span>`;
  }
  const text =
    row.shares === null
      ? 'あり'
      : row.shares.kind === 'exact'
        ? `${row.shares.count}口`
        : `${row.shares.count}口以上`;
  return `<span class="remaining-badge">${escapeHtml(text)}</span>`;
}
