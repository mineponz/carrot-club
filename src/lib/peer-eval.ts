/**
 * 他の会員の評価分布（馬ごとのA〜E件数）の見せ方。
 *
 * 一覧の表（`horse-row.ts` からビルド時とブラウザ側の両方で呼ぶ）と、個別ページの
 * 「他の会員の評価」欄で同じ関数を使う。片方だけ直して見た目がずれるのを防ぐため、
 * マークアップの定義はここ1か所に置く。
 *
 * 見た目のルール:
 * - 色は既存の評価A〜Eの色（`--rating-a-bg` など）をそのまま使う。集計用に新しい色相を
 *   増やさない（自分の評価セルと同じ色 = 同じ意味、と読めるようにする）。
 * - 票数の差は「積み上げ棒の長さ」だけで表し、枠線や影は足さない。
 * - 出力する値は数値とA〜Eの固定文字列だけなので、HTMLエスケープの必要が無い
 *   （ユーザー入力は一切混ぜない）。
 */

import { RATINGS, totalOf, type RatingCounts } from './evaluation-api.ts';

/** 「5人（A2・B2・C1）」のような読み上げ・ツールチップ用の文字列 */
export function peerSummaryLabel(counts: RatingCounts | null): string {
  if (!counts) return '他の会員の評価はまだありません';
  const total = totalOf(counts);
  if (total === 0) return '他の会員の評価はまだありません';
  const breakdown = RATINGS.filter((r) => counts[r] > 0)
    .map((r) => `${r}${counts[r]}`)
    .join('・');
  return `他の会員${total}人の評価（${breakdown}）`;
}

/**
 * 積み上げ棒。幅の比率は flex-grow で表す（パーセント計算だと端数の丸めで
 * 合計が100%を超えたり足りなかったりする）。
 */
export function peerBarHtml(counts: RatingCounts): string {
  const segments = RATINGS.filter((r) => counts[r] > 0)
    .map((r) => `<span class="peer-seg" data-rating="${r}" style="flex-grow:${counts[r]}"></span>`)
    .join('');
  return `<span class="peer-bar" aria-hidden="true">${segments}</span>`;
}

/**
 * 一覧の表の1セルぶん。
 *
 * まだ集計を取得できていない（`null`）ときと、集計はあるが0票のときを見た目で分ける:
 * 前者は「…」（読み込み中）、後者は「−」（まだ誰も評価していない）。
 * 同じ表示にすると、通信に失敗したのか本当に0票なのかが利用者に伝わらない。
 */
export function peerCellHtml(counts: RatingCounts | null | undefined): string {
  if (counts === undefined) return '<span class="peer-loading" title="読み込み中">…</span>';
  const total = counts ? totalOf(counts) : 0;
  if (!counts || total === 0) {
    return '<span class="peer-empty" title="他の会員の評価はまだありません">−</span>';
  }
  const label = peerSummaryLabel(counts);
  return `<span class="peer-eval" title="${label}">${peerBarHtml(counts)}<span class="peer-total">${total}</span><span class="visually-hidden">${label}</span></span>`;
}

/**
 * 個別ページ用。A〜Eを5行すべて出す（0票の段も出すことで「その馬にどの評価が
 * 付いていないか」が形として読める）。
 */
export function peerBreakdownHtml(counts: RatingCounts | null): string {
  const total = counts ? totalOf(counts) : 0;
  if (!counts || total === 0) {
    return '<p class="peer-none">この馬にはまだ他の会員の評価がありません。</p>';
  }
  const rows = RATINGS.map((r) => {
    const n = counts[r];
    const percent = (n / total) * 100;
    return `<div class="peer-row">
      <span class="peer-key" data-rating="${r}">${r}</span>
      <span class="peer-track"><span class="peer-fill" data-rating="${r}" style="width:${percent.toFixed(1)}%"></span></span>
      <span class="peer-count">${n}人</span>
    </div>`;
  }).join('');
  return `<div class="peer-breakdown">${rows}</div>
    <p class="peer-total-note">他の会員${total}人が評価しています。</p>`;
}
