/**
 * 2026年募集で確定リスト後に募集中止になった馬。
 *
 * `horses2026.ts` には載せず（＝一覧・絞り込み・頭数はリスト時点のまま）、記事とトップページの
 * 注記でだけ触れる。馬名・No.をページ側にハードコードすると片方だけ直し忘れるので、
 * ここを単一の真実源にして必ず参照する。
 */
export interface CancelledRecruit {
  no: string;
  name: string;
  damName: string;
  reason: string;
}

export const cancelledRecruits2026: CancelledRecruit[] = [
  { no: '56', name: 'マルシュロレーヌの25', damName: 'マルシュロレーヌ', reason: '募集中止' },
  { no: '62', name: 'ドナウエレンの25', damName: 'ドナウエレン', reason: '募集中止' },
];

export const isCancelled2026 = (no: string): boolean =>
  cancelledRecruits2026.some((r) => r.no === no);
