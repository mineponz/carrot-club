/**
 * 2026年募集馬の「抽選ランク発表」（クラブ公式・会員限定ページ）。
 *
 * 出所:
 *   - 9/10snapshot: キャロットクラブ公式サイトの会員限定ページ「抽選ランク発表」
 *     （PDF「２０２６年度１歳馬第１次募集最終集計結果（９月１０日現在）」）。
 *   - 9/11snapshot: PDF「キャロットクラブ　１．５次募集対象馬一覧」。前snapshotのbyIdを
 *     まるごと引き継ぎ（damPriority/normalの発表結果は1次募集のまま変わらない）、
 *     1.5次募集対象になった馬の`remainingShares`だけ追記した（1.5次PDFは対象馬の
 *     出資可能口数しか載っていないため）。対象馬の集合は「1次募集でnormalがlotteryOccurred:false
 *     （残口あり）だった馬」と完全一致し、これは実データ投入時に機械的に検算済み。
 *   TODO(データ投入時に確定): 発表ページの正確なURLを差し替える（会員限定ページのため`lottery.astro`の
 *   出所リンクは暫定でトップを貼っている）。
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
 *   **この `lotteryOccurred: false` の意味は枠（母馬優先／通常）で違う**（本人指摘・
 *   2026-09-10）。母馬優先枠の口数は「募集総口数の半数が最大」という上限であって、
 *   そこで需要が埋まらなければ余りはその場で通常枠に吸収される——1.5次募集へ持ち越す
 *   「残口」にはならないため、母馬優先枠側は単に「当選」。通常枠（＝最終的な全体の結果）が
 *   `lotteryOccurred: false` のときだけ、実際に1.5次募集の目安になる「残口あり」を意味する。
 *   表示の出し分けは `lotteryLabel()`（`lib/lottery-status.ts`）の `frameKind` 引数で行う。
 *
 * ## 発表が来たらやること
 * `LOTTERY_STATUS_SNAPSHOTS` に `{ asOf, label, byId }` を1つ追加するだけでよい
 * （一覧列・詳細ページ・特設ページの表示は自動で追従する）。**表示は最新snapshotの
 * byIdだけを見る**ので、新しい発表が「前回の一部だけを更新する」内容（1.5次募集の
 * 残り口数など、damPriority/normalの再発表を伴わないもの）のときは、前snapshotの
 * byIdを丸ごとコピーしてから差分だけ書き換えること。新しいbyIdを空や一部の馬だけで
 * 作ると、それ以外の馬が「発表待ち」に戻ってしまう。
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

/**
 * 「1.5次募集対象馬一覧」PDFの残り口数。クラブは残口が100口（地方入厩予定馬は25口）以下の
 * 馬だけ実数を出し、それを超える馬は空欄にする。空欄を「不明」にせず`atLeast`（本人指摘・
 * 2026-09-11「数字がない馬は100以上(25以上)と記載」）として持たせ、表示を「100口以上」
 * 「25口以上」にする。しきい値（100/25）は地方入厩予定かどうかで変わるため、このデータを
 * 入れる時点でPDFの所属列を見て`count`にしきい値そのものを入れる。
 */
export type RemainingShares =
  | { kind: 'exact'; count: number }
  | { kind: 'atLeast'; count: number };

export interface LotteryStatusEntry {
  /** 母馬優先枠の結果。対象外の馬（母がキャロット出身でない）はキーごと無し */
  damPriority?: FrameLotteryResult;
  /** 通常枠（母馬優先を使わない申込み分）の結果 */
  normal: FrameLotteryResult;
  /** 残り口数（1.5次募集の目安）。未確定・1.5次募集対象外はnull */
  remainingShares: RemainingShares | null;
}

export interface LotteryStatusSnapshot {
  /** 表示用の発表時点（例 '9/11'） */
  asOf: string;
  /** 例 '抽選ランク発表' */
  label: string;
  /** 募集番号(string) → 結果。発表された馬のキーだけ入れる */
  byId: Readonly<Record<string, LotteryStatusEntry>>;
}

export const LOTTERY_STATUS_SNAPSHOTS: readonly LotteryStatusSnapshot[] = [
  {
    asOf: '9/10',
    label: '抽選ランク発表（1次募集）',
    byId: {
      '1': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '2': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '3': { normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '4': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '5': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '6': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '7': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '8': { damPriority: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'x1', lotteryOccurred: true }, note: null }, remainingShares: null },
      '9': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '10': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '11': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '12': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '13': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '14': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '15': { damPriority: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'x1', lotteryOccurred: true }, note: null }, remainingShares: null },
      '16': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '17': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '18': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '19': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '20': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '21': { normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '22': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '23': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '24': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '25': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '26': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '27': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '28': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '29': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '30': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '31': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '32': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '33': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'x1', lotteryOccurred: true }, note: null }, remainingShares: null },
      '34': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '35': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '36': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '37': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '38': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '39': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '40': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '41': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '42': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '43': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '44': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '45': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '46': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '47': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '48': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '49': { damPriority: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'x1', lotteryOccurred: true }, note: null }, remainingShares: null },
      '50': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'x1', lotteryOccurred: true }, note: null }, remainingShares: null },
      '51': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'x2', lotteryOccurred: true }, note: null }, remainingShares: null },
      '52': { normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '53': { normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '54': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '55': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '57': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '58': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '59': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '60': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '61': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '63': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '64': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '65': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'x1', lotteryOccurred: true }, note: null }, remainingShares: null },
      '66': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '67': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '68': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '69': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '70': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '71': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '72': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '73': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '74': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '75': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '76': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '77': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '78': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '79': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '80': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '81': { damPriority: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'x1', lotteryOccurred: true }, note: null }, remainingShares: null },
      '82': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '83': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '84': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '85': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '86': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '87': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '88': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '89': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '90': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '91': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '92': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '93': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
      '94': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: null },
    },
  },
  {
    asOf: '9/11',
    label: '1.5次募集対象馬一覧',
    byId: {
      '1': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '2': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '3': { normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '4': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '5': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '6': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '7': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '8': { damPriority: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'x1', lotteryOccurred: true }, note: null }, remainingShares: null },
      '9': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'exact', count: 27 } },
      '10': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '11': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '12': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'atLeast', count: 100 } },
      '13': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '14': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '15': { damPriority: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'x1', lotteryOccurred: true }, note: null }, remainingShares: null },
      '16': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '17': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'atLeast', count: 100 } },
      '18': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '19': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'exact', count: 43 } },
      '20': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'atLeast', count: 100 } },
      '21': { normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '22': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '23': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '24': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'exact', count: 40 } },
      '25': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '26': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'atLeast', count: 100 } },
      '27': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '28': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'exact', count: 13 } },
      '29': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '30': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'atLeast', count: 100 } },
      '31': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'atLeast', count: 100 } },
      '32': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'exact', count: 76 } },
      '33': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'x1', lotteryOccurred: true }, note: null }, remainingShares: null },
      '34': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'atLeast', count: 100 } },
      '35': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '36': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '37': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'atLeast', count: 100 } },
      '38': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'atLeast', count: 100 } },
      '39': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '40': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '41': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '42': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '43': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '44': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '45': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '46': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '47': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '48': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '49': { damPriority: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'x1', lotteryOccurred: true }, note: null }, remainingShares: null },
      '50': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'x1', lotteryOccurred: true }, note: null }, remainingShares: null },
      '51': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'x2', lotteryOccurred: true }, note: null }, remainingShares: null },
      '52': { normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '53': { normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '54': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '55': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '57': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '58': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '59': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '60': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '61': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'atLeast', count: 100 } },
      '63': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '64': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '65': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'x1', lotteryOccurred: true }, note: null }, remainingShares: null },
      '66': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '67': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '68': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '69': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '70': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '71': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '72': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '73': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '74': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'exact', count: 74 } },
      '75': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '76': { damPriority: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '77': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '78': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '79': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'atLeast', count: 100 } },
      '80': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '81': { damPriority: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, normal: { outcome: { rank: 'x1', lotteryOccurred: true }, note: null }, remainingShares: null },
      '82': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'atLeast', count: 100 } },
      '83': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '84': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'none', lotteryOccurred: true }, note: null }, remainingShares: null },
      '85': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '86': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '87': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '88': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '89': { normal: { outcome: { rank: 'general', lotteryOccurred: true }, note: null }, remainingShares: null },
      '90': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'exact', count: 12 } },
      '91': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'atLeast', count: 25 } },
      '92': { damPriority: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'atLeast', count: 25 } },
      '93': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'atLeast', count: 25 } },
      '94': { normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null }, remainingShares: { kind: 'exact', count: 24 } },
    },
  },
];
