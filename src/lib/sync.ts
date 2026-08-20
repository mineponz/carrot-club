/**
 * 端末間同期パネル（`src/components/SyncPanel.astro`）が使う純粋なロジック。
 *
 * `.astro` の `<script>` にはDOM操作だけを置き、判定・文言はここに集めてテストする
 * （AGENTS.md「ロジックは src/lib/ に分離し、必ずテストを書く」）。
 *
 * ## 同期IDの扱い
 * 同期IDは `src/lib/anon-id.ts` の匿名IDそのもの。**知っている人は誰でもその評価を
 * 読み書きできる合言葉**なので、画面では既定で伏せ字にし（`maskAnonId()`）、
 * 「他人に教えない」注記と一緒にしか出さない。
 */

import { isValidAnonId } from './evaluation-api.ts';

/**
 * 同期IDの取り込みが終わったことを一覧ページへ知らせるイベント名。
 *
 * 同期パネルと表は別のスクリプトなので、パネルが localStorage を書き換えても
 * 表は古い内容を持ったままになる。`document` 経由で合図し、表側に読み直させる。
 */
export const EVALUATIONS_RESTORED_EVENT = 'carrot-club:evaluations-restored';

/**
 * 貼り付けられたIDを整える。前後の空白・引用符・全角空白のほか、
 * メールやメモアプリ経由で混ざりがちな改行も落とす。大文字は小文字に直す
 * （`isValidAnonId()` は小文字のUUIDしか通さないが、利用者にそれを求める意味はない）。
 */
export function normalizeAnonIdInput(raw: string): string {
  return raw
    .replace(/[\s　]/gu, '')
    .replace(/^["'「『]+|["'」』]+$/gu, '')
    .toLowerCase();
}

/**
 * 表示用に伏せ字にする。**どのIDかは分かるが、そのままでは使えない**ようにするため、
 * 先頭ブロックと末尾4文字だけ残す。肩越しに見られた・スクリーンショットを共有した、
 * といった経路で丸ごと漏れるのを防ぐのが目的。
 */
export function maskAnonId(id: string): string {
  if (!isValidAnonId(id)) return '';
  const head = id.slice(0, 8);
  const tail = id.slice(-4);
  return `${head}-••••-••••-••••-••••••••${tail}`;
}

/** アップロード後の結果表示。0件の時に「成功0件」と出しても意味が伝わらないので分ける。 */
export function uploadResultMessage(sent: number, failed: number): string {
  if (sent === 0 && failed === 0) {
    return 'この端末にはまだ評価が入っていません。馬にA〜Eやメモを付けてから預けてください。';
  }
  if (failed === 0) return `${sent}頭ぶんの評価を預けました。`;
  if (sent === 0) {
    return `預けられませんでした（${failed}頭ぶん失敗）。通信状況を確かめてもう一度お試しください。`;
  }
  return `${sent}頭ぶんを預けましたが、${failed}頭ぶんは失敗しました。もう一度押すと失敗したぶんを送り直します。`;
}

/**
 * 取り込み後の結果表示。0件は「失敗」ではなく「預けたデータがまだ無い」なので、
 * 引き継ぎ元で先に預ける必要があることまで書く（ここで詰まると原因が分からない）。
 */
export function restoreResultMessage(count: number): string {
  if (count === 0) {
    return 'このIDにはまだ評価が預けられていませんでした。引き継ぎ元の端末で「この端末の評価を預ける」を押してから、もう一度お試しください。';
  }
  return `${count}頭ぶんの評価を取り込みました。この端末は今後このIDで同期します。`;
}
