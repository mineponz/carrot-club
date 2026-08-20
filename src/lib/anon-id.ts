/**
 * 集計用の匿名ID。
 *
 * ブラウザの localStorage に UUID を1つだけ作って持ち回る。**会員番号・メールアドレス等の
 * 個人を特定できる情報とは一切紐付けない**（そもそもこのサイトはログインを持たない）。
 * 目的は「同じ人が同じ馬に2票入れないようにする」ことだけで、誰かを識別するためではない。
 *
 * 年度をまたいでも同じIDを使う（保存キーは評価本体と違って年度で分けない）。
 * 年ごとにIDを変えると、同じ人が去年と今年で別人として数えられるわけでもなく、
 * ID自体が増えるだけで良いことがない。
 *
 * localStorage を消せばIDも消え、次から別人として数えられる。それで構わない
 * （集計の目的は「他の人がどう見ているかの傾向」であって、正確な人数ではない）。
 */

import type { KeyValueStore } from './evaluations.ts';
import { isValidAnonId } from './evaluation-api.ts';

export const ANON_ID_STORAGE_KEY = 'carrot-club:anon-id';

/**
 * 保存済みのIDを返す。無い／壊れている場合は `generate()` で作って保存する。
 *
 * `generate` を引数に取っているのは、`crypto.randomUUID` に直接依存すると
 * テストで結果が固定できないため（evaluations.ts が `KeyValueStore` を受け取るのと同じ理由）。
 */
export function getOrCreateAnonId(store: KeyValueStore, generate: () => string): string {
  const stored = store.getItem(ANON_ID_STORAGE_KEY);
  // 形式が壊れているものはサーバー側のバリデーションで弾かれ、以後ずっと送信が失敗し続ける。
  // 黙って作り直す方が復旧できる。
  if (isValidAnonId(stored)) return stored;

  const created = generate();
  store.setItem(ANON_ID_STORAGE_KEY, created);
  return created;
}

/**
 * 別の端末で発行されたIDをこの端末に設定する（端末間同期の復元）。
 *
 * 形式が不正なら書き込まずに false を返す（貼り付けミスのIDを保存して、以後ずっと
 * 送信が失敗し続ける状態を作らない）。**このIDは事実上の合言葉**で、知っている人は
 * その人の評価を読み書きできる。画面側で「他人に教えない」注記を必ず出すこと。
 *
 * 乗り換える前のIDで入れた集計の票は消えずに残る（前のIDの票のまま）。
 * 集計は正確な人数ではなく傾向を見るためのものなので、そこまでは面倒を見ない。
 */
export function setAnonId(store: KeyValueStore, id: string): boolean {
  if (!isValidAnonId(id)) return false;
  store.setItem(ANON_ID_STORAGE_KEY, id);
  return true;
}

/**
 * ブラウザのUUID生成。`crypto.randomUUID()` はセキュアコンテキスト（https / localhost）
 * でしか生えないため、そうでない環境では `getRandomValues` から自前で組み立てる。
 * どちらも使えない場合は空文字を返し、呼び出し側が送信を諦める。
 */
export function randomAnonId(): string {
  const c: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return '';
}
