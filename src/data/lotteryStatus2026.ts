/**
 * 2026年募集馬の「抽選ランク発表」（クラブ公式・会員限定ページ）。
 *
 * 出所: キャロットクラブ公式サイトの会員限定ページ「抽選ランク発表」。
 *   TODO(データ投入時に確定): 発表ページの正確なURL・発表日を差し替える。
 *
 * ## 制度の前提（詳細: secondBrain `1-projects/carrot-club/notes/20260905-lottery-status-terminology.md`）
 * - 「最優先×2（過去2年最優先落選）」「最優先×1（前年最優先落選）」「最優先×なし（前年最優先当選）」
 *   「一般」の4段階。強い順: x2 → x1 → none → general。この強さの順で抽選が発生する
 *   （×2内で抽選 → 残口があれば×1内で抽選 → …）。
 * - 母がキャロット出身馬の場合のみ「母馬優先枠」が別に存在し、募集口数の半分を優先確保する。
 *   母馬優先枠と通常枠（最優先＋一般）は独立しており、同じ馬でも枠ごとに結果が異なりうる
 *   （実例: 母馬優先なら最優先で確保できるが、一般枠は落選、等）。
 * - **「×2/×1/×なし」は会員個人に付くステータスで、馬には付かない。** ここで表示するのは
 *   「その馬がどの優先ランクまで抽選が発生したか」という馬側の抽選結果（会員個人のバツ状態とは別物）。
 *
 * ## キー定義
 * - `LOTTERY_STATUS_SNAPSHOTS` の要素1つ = 1回の発表（`asOf`・`label`）。
 *   通常は1次募集で1回だが、1.5次募集等で複数回になりうるので配列にしてある。
 *   表示・判定には**最新（配列末尾）のsnapshotだけ**を使う（時系列比較はしない。
 *   `entryVotes2026.ts` の「回ごとに列を増やす」設計とは違う）。
 * - `byId`: 募集番号(string) → `LotteryStatusEntry`。**発表された馬のキーだけ**入れる
 *   （未発表の馬はキーごと無し。一覧・特設ページでは「発表待ち」表示になる）。
 * - `FrameLotteryResult.outcome`: 発表された抽選結果。未確定は `null`。
 *   **最優先（×2/×1/×なし）は抽選が発生した場合のみ発表される**（本人の実体験に基づく訂正・
 *   2026-09-05「バツ系には確保というステータスはない。一般だけ存在する」）。つまり
 *   「×1で確保」のような発表は実在しない——あるランクで申込者が口数に届かなければ、
 *   そのランクの人は無条件で出資でき、抽選ランク発表としては特に取り上げられない。
 *   「抽選なしで確保（全員当選）」という状態が明示的に発表されるのは**一般枠だけ**。
 *   これを型で表現し（`LotteryOutcome`）、バツ系ランクに `lotteryOccurred: false` の
 *   組み合わせが作れないようにしてある。
 *
 * ## 発表が来たらやること
 * `LOTTERY_STATUS_SNAPSHOTS` に `{ asOf, label, byId }` を1つ追加するだけでよい
 * （一覧列・詳細ページ・特設ページの表示は自動で追従する）。
 * **器の段階（実データ投入前）はこの配列自体を空にしておく**（`entryVotes2026.ts` の
 * 「空の byId」と違い、発表時点の日付自体まだ決まっていないため配列ごと空にする）。
 */

export type LotteryRank = 'x2' | 'x1' | 'none' | 'general';
// x2=最優先×2(過去2年最優先落選) / x1=最優先×1(前年最優先落選) /
// none=最優先×なし(前年最優先当選) / general=一般申込み。強い順: x2 > x1 > none > general

/**
 * 発表される抽選結果。最優先ランク（x2/x1/none）は抽選が発生した場合しか型として作れない
 * （`lotteryOccurred: false` は `rank: 'general'` のときだけ許される）。
 * 「バツ系には確保ってステータスはない。一般だけ存在する」（本人・2026-09-05）をそのまま型にした。
 */
export type LotteryOutcome =
  | { rank: LotteryRank; lotteryOccurred: true }
  | { rank: 'general'; lotteryOccurred: false };

export interface FrameLotteryResult {
  /** 発表されたその枠の結果。未確定（未発表）は null */
  outcome: LotteryOutcome | null;
  /** 発表文言の生の補足（例 "一般出資枠は落選"）。無ければ null */
  note: string | null;
}

export interface LotteryStatusEntry {
  /** 母馬優先枠の結果。対象外の馬（母がキャロット出身でない）はキーごと無し */
  damPriority?: FrameLotteryResult;
  /** 通常枠（母馬優先を使わない申込み分）の結果 */
  normal: FrameLotteryResult;
  /** 残り口数（1.5次募集の目安）。未確定はnull */
  remainingShares: number | null;
}

export interface LotteryStatusSnapshot {
  /** 表示用の発表時点（例 '9/11'） */
  asOf: string;
  /** 例 '抽選ランク発表' */
  label: string;
  /** 募集番号(string) → 結果。発表された馬のキーだけ入れる */
  byId: Readonly<Record<string, LotteryStatusEntry>>;
}

export const LOTTERY_STATUS_SNAPSHOTS: readonly LotteryStatusSnapshot[] = [];
