import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, formatBirthDate, horseRowHtml } from './horse-row.ts';
import { DEFAULT_EVALUATION } from './evaluations.ts';
import type { Horse } from './horses.ts';

const horse: Horse = {
  id: '7',
  name: 'フィリアプーラの2024',
  sex: '牡',
  netkeibaUrl: 'https://db.sp.netkeiba.com/horse/2024106111/',
  sire: 'エピファネイア',
  broodmareSire: 'ハービンジャー',
  damAge: 8,
  birthDate: '2024-01-10',
  stable: '木村哲也',
  pricePerShare: 25,
  height: 156,
  chestGirth: 176,
  caretGirth: 20,
  weight: 430,
  sibling: 'テストシスター',
  damPriority: true,
  surgery: '',
  xSearchUrl: 'https://x.com/search?q=フィリアプーラ&src=typed_query',
};

test('escapeHtml: HTMLの特殊文字をエスケープする', () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('formatBirthDate: ISO日付を月/日にする', () => {
  assert.equal(formatBirthDate('2024-01-10'), '01/10');
});

test('horseRowHtml: 馬の識別子と主要データを含む', () => {
  const html = horseRowHtml(horse, DEFAULT_EVALUATION);
  assert.match(html, /data-horse-id="7"/);
  assert.match(html, /フィリアプーラの2024/);
  assert.match(html, /エピファネイア/);
  assert.match(html, /木村哲也/);
});

test('horseRowHtml: netkeibaリンクを必ず出力する', () => {
  const html = horseRowHtml(horse, DEFAULT_EVALUATION);
  assert.match(html, /href="https:\/\/db\.sp\.netkeiba\.com\/horse\/2024106111\/"/);
  assert.match(html, />netkeiba</);
});

test('horseRowHtml: Xの検索リンクを出力する', () => {
  const html = horseRowHtml(horse, DEFAULT_EVALUATION);
  assert.match(html, /x\.com\/search/);
});

test('horseRowHtml: 外部リンクには rel="noopener" を付ける', () => {
  const html = horseRowHtml(horse, DEFAULT_EVALUATION);
  const links = html.match(/<a [^>]*>/g) ?? [];
  assert.equal(links.length, 2);
  for (const link of links) assert.match(link, /rel="noopener"/);
});

test('horseRowHtml: 母優先の馬には◯を出す', () => {
  assert.match(horseRowHtml(horse, DEFAULT_EVALUATION), /class="dam-priority">◯</);
  assert.match(horseRowHtml({ ...horse, damPriority: false }, DEFAULT_EVALUATION), /class="dam-priority"><\/td>/);
});

test('horseRowHtml: 手術欄の改行は1行に畳む', () => {
  const html = horseRowHtml({ ...horse, surgery: '手術A (2024/1/1)\n手術B (2025/1/8)' }, DEFAULT_EVALUATION);
  assert.match(html, /手術A \(2024\/1\/1\) \/ 手術B \(2025\/1\/8\)/);
  assert.ok(!html.includes('手術A (2024/1/1)\n'));
});

test('horseRowHtml: 保存済みの評価を反映する', () => {
  const html = horseRowHtml(horse, { rating: 'A', favorite: true, skip: true, memo: '本命' });
  assert.match(html, /<option value="A" selected>/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /data-field="skip" checked/);
  assert.match(html, /value="本命"/);
  assert.match(html, /data-skip="true"/);
});

test('horseRowHtml: 評価セルに data-rating を出す（CSSの色分けがこの属性に依存している）', () => {
  assert.match(horseRowHtml(horse, { ...DEFAULT_EVALUATION, rating: 'C' }), /class="rating-select"[^>]*data-rating="C"/);
  // 未評価は空文字。色を付けない側の条件なので固定しておく
  assert.match(horseRowHtml(horse, DEFAULT_EVALUATION), /class="rating-select"[^>]*data-rating=""/);
});

test('horseRowHtml: 馬名の引用符をエスケープしてHTMLを壊さない', () => {
  const html = horseRowHtml({ ...horse, name: 'テスト"号' }, DEFAULT_EVALUATION);
  assert.ok(!html.includes('テスト"号'));
  assert.match(html, /テスト&quot;号/);
});
