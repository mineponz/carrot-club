import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALWAYS_VISIBLE_COLUMN_KEYS,
  COLUMNS,
  escapeHtml,
  formatBirthDate,
  horseDetailHref,
  horseRowHtml,
  pedigreeLine,
  shortStableLabel,
  stableSexLine,
  toggleableColumns,
} from './horse-row.ts';
import { DEFAULT_EVALUATION } from './evaluations.ts';
import type { Horse } from './horses.ts';

const horse: Horse = {
  id: '7',
  name: 'フィリアプーラの2024',
  sex: '牡',
  netkeibaUrl: 'https://db.sp.netkeiba.com/horse/2024106111/',
  damUrl: 'https://db.netkeiba.com/horse/2010104512/',
  sire: 'エピファネイア',
  broodmareSire: 'ハービンジャー',
  damAge: 8,
  damParity: 3,
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

test('horseRowHtml: 外部リンク（別タブで開くもの）には rel="noopener" を付ける', () => {
  const html = horseRowHtml(horse, DEFAULT_EVALUATION);
  const external = (html.match(/<a [^>]*>/g) ?? []).filter((a) => a.includes('target="_blank"'));
  // netkeiba / X検索 / 母のnetkeiba の3本
  assert.equal(external.length, 3);
  for (const link of external) assert.match(link, /rel="noopener"/);
});

test('horseDetailHref: 末尾スラッシュ付きのURLを作る（trailingSlash: always に合わせる）', () => {
  assert.equal(horseDetailHref('7'), '/2026/horses/7/');
  assert.equal(horseDetailHref('7', '/2025/horses/'), '/2025/horses/7/');
});

test('horseRowHtml: 馬名セルは個別ページへのリンクになる（同一タブ遷移なので target は付けない）', () => {
  const html = horseRowHtml(horse, DEFAULT_EVALUATION);
  const cell = html.match(/<td data-col="name" class="horse-name">[^]*?<\/td>/)![0];
  assert.match(cell, /<a href="\/2026\/horses\/7\/">フィリアプーラの2024<\/a>/);
  assert.ok(!cell.includes('target='));
});

test('horseRowHtml: 馬名セルにSP用の No.・父（母父）・厩舎・性を重ねて持たせる', () => {
  const html = horseRowHtml(horse, DEFAULT_EVALUATION);
  const cell = html.match(/<td data-col="name" class="horse-name">[^]*?<\/td>/)![0];
  assert.match(cell, /<span class="sp-no">7\.<\/span>/);
  assert.match(cell, /<span class="sp-line">エピファネイア（ハービンジャー）<\/span>/);
  assert.match(cell, /<span class="sp-line">木村哲也・牡<\/span>/);
});

test('pedigreeLine: 母父が無ければ括弧ごと出さない', () => {
  assert.equal(pedigreeLine(horse), 'エピファネイア（ハービンジャー）');
  assert.equal(pedigreeLine({ ...horse, broodmareSire: '' }), 'エピファネイア');
});

test('stableSexLine: 厩舎が無ければ性だけにする', () => {
  assert.equal(stableSexLine(horse), '木村哲也・牡');
  assert.equal(stableSexLine({ ...horse, stable: '' }), '牡');
});

test('stableSexLine: SP用の行も厩舎は短い表記にする（馬名セルの幅で切れないように）', () => {
  assert.equal(
    stableSexLine({ ...horse, stable: '門別・田中淳司厩舎or大井・渡邉和雄厩舎（外厩）' }),
    '門別or大井・牡',
  );
});

test('horseRowHtml: 過去年度は個別ページの接頭辞を差し替えられる', () => {
  assert.match(horseRowHtml(horse, DEFAULT_EVALUATION, '/2025/horses/'), /href="\/2025\/horses\/7\/"/);
});

test('horseRowHtml: 母のnetkeibaリンクは damUrl がある時だけ出す', () => {
  assert.match(
    horseRowHtml(horse, DEFAULT_EVALUATION),
    /href="https:\/\/db\.netkeiba\.com\/horse\/2010104512\/"[^>]*>母</,
  );
  assert.ok(!horseRowHtml({ ...horse, damUrl: '' }, DEFAULT_EVALUATION).includes('>母<'));
});

test('horseRowHtml: セル数が COLUMNS の列数と一致する（見出しと中身がずれない）', () => {
  const cells = horseRowHtml(horse, DEFAULT_EVALUATION).match(/<td[ >]/g) ?? [];
  assert.equal(cells.length, COLUMNS.length);
});

test('COLUMNS: 一口価格の見出しには単位を付ける（万円と分かるように）', () => {
  const labels: readonly string[] = COLUMNS.map((c) => c.label);
  assert.ok(labels.includes('一口(万)'));
  // 単位なしの「一口」が残っていない＝見出しを差し替え忘れていない
  assert.ok(!labels.includes('一口'));
});

test('COLUMNS: メモ列だけ見出し・セル共通のクラスを持つ', () => {
  const withClass = COLUMNS.filter((c): c is typeof c & { cls: string } => 'cls' in c);
  assert.equal(withClass.length, 1);
  assert.equal(withClass[0].label, 'メモ');
  assert.equal(withClass[0].cls, 'memo-col');
});

test('COLUMNS: netkeibaは血統より左、X検索と母は右端、左3列は No・馬名・評価', () => {
  const labels = COLUMNS.map((c) => c.label);
  assert.ok(labels.indexOf('netkeiba') < labels.indexOf('父'));
  assert.equal(labels.at(-2), 'X検索');
  assert.equal(labels.at(-1), '母');
  assert.deepEqual(labels.slice(0, 3), ['No', '馬名', '評価']);
});

test('COLUMNS: メモは評価のすぐ隣（4列目）に置く', () => {
  const labels = COLUMNS.map((c) => c.label);
  assert.equal(labels.indexOf('メモ'), labels.indexOf('評価') + 1);
  assert.equal(labels[3], 'メモ');
});

test('COLUMNS: 抽選はメモのすぐ隣（5列目、netkeibaより左）に置く', () => {
  const labels = COLUMNS.map((c) => c.label);
  assert.equal(labels.indexOf('抽選'), labels.indexOf('メモ') + 1);
  assert.equal(labels[4], '抽選');
  assert.ok(labels.indexOf('抽選') < labels.indexOf('netkeiba'));
});

test('COLUMNS: 列のkeyは重複しない（表示設定の保存が別の列に効かないように）', () => {
  const keys = COLUMNS.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.match(key, /^[A-Za-z][A-Za-z0-9]*$/);
});

test('horseRowHtml: 各セルの data-col が COLUMNS の key と同じ並びで付く（見出しと対で使う）', () => {
  const html = horseRowHtml(horse, DEFAULT_EVALUATION);
  // <td> の先頭に置いた data-col だけを拾う（中の要素の属性を拾わないよう <td 直後に限る）
  const cols = [...html.matchAll(/<td data-col="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(cols, COLUMNS.map((c) => c.key));
});

test('toggleableColumns: No・馬名・評価・メモ以外のすべてを切り替え対象にする', () => {
  const keys = toggleableColumns().map((c) => c.key);
  assert.deepEqual(ALWAYS_VISIBLE_COLUMN_KEYS, ['id', 'name', 'rating', 'memo']);
  for (const always of ALWAYS_VISIBLE_COLUMN_KEYS) assert.ok(!keys.includes(always));
  assert.equal(keys.length, COLUMNS.length - ALWAYS_VISIBLE_COLUMN_KEYS.length);
  // 並びは COLUMNS のまま（設定の並び順が表の並び順と一致する）
  assert.deepEqual(
    keys,
    COLUMNS.map((c) => c.key).filter((k) => !ALWAYS_VISIBLE_COLUMN_KEYS.includes(k)),
  );
});

test('COLUMNS: SP幅で馬名見出しを押したときは No（id）で並べ替える', () => {
  // 見出しのラベルは「馬名」のまま変えず、押したときのキーだけ差し替える（本人合意・2026-08-26）。
  // SPでは No 列を隠しているので、そのままだと募集番号順に戻す手段が無くなるため。
  const name = COLUMNS.find((c) => c.key === 'name')!;
  assert.equal(name.label, '馬名');
  assert.equal(name.sortKey, 'name');
  assert.equal((name as { spSortKey?: string }).spSortKey, 'id');
  // 代替キーを持つのは馬名だけ（他の列はPC/SPで同じ挙動）
  assert.equal(COLUMNS.filter((c) => 'spSortKey' in c).length, 1);
});

test('COLUMNS: SPで隠す列（No・父・母父・性・厩舎）の位置がページのCSSと一致する', () => {
  // index.astro / 2025/index.astro の @media (max-width: 40rem) が nth-child の番号で
  // 列を隠しているので、列を入れ替えたらここも一緒に直す（ずれると別の列が消える）。
  // 2026-09-05に抽選列を5列目に挿入したぶん、以前の 1/6/7/8/17 から後ろの4つが1つずつ
  // 後ろにずれている（No自体は1列目のまま）。
  const labels = COLUMNS.map((c) => c.label);
  const hiddenOnSp = [1, 7, 8, 9, 18].map((n) => labels[n - 1]);
  assert.deepEqual(hiddenOnSp, ['No', '父', '母父', '性', '厩舎']);
});

test('horseRowHtml: 母優先の馬には◯を出す', () => {
  assert.match(horseRowHtml(horse, DEFAULT_EVALUATION), /class="dam-priority">◯</);
  assert.match(horseRowHtml({ ...horse, damPriority: false }, DEFAULT_EVALUATION), /class="dam-priority"><\/td>/);
});

test('horseRowHtml: 手術・既往は有無を◯で出すだけにする（全文は title と個別ページ）', () => {
  const html = horseRowHtml({ ...horse, surgery: '手術A (2024/1/1)\n手術B (2025/1/8)' }, DEFAULT_EVALUATION);
  const cell = html.match(/<td data-col="surgery"[^]*?<\/td>/)![0];
  // 改行は1行に畳んだうえで title（ホバー）にだけ残す
  assert.match(cell, /title="手術A \(2024\/1\/1\) \/ 手術B \(2025\/1\/8\)"/);
  assert.match(cell, />◯<\/td>/);
  assert.ok(!cell.includes('手術A (2024/1/1)\n'));
});

test('horseRowHtml: 手術・既往の記載が無ければ◯を出さない', () => {
  assert.match(horseRowHtml(horse, DEFAULT_EVALUATION), /<td data-col="surgery" class="surgery" title=""><\/td>/);
});

test('horseRowHtml: 抽選ステータスの行を渡さなければ「—」（2025年募集など情報源が無い年度）', () => {
  const html = horseRowHtml(horse, DEFAULT_EVALUATION);
  assert.match(html, /<td data-col="lottery" class="lottery-col">—<\/td>/);
});

test('horseRowHtml: 抽選ステータスの行を渡すと一覧セルに反映される', () => {
  const html = horseRowHtml(horse, DEFAULT_EVALUATION, undefined, {
    id: horse.id,
    name: horse.name,
    sire: horse.sire,
    sex: horse.sex,
    hasDamPriority: true,
    damPriority: { outcome: { rank: 'x2', lotteryOccurred: true }, note: null },
    normal: { outcome: { rank: 'general', lotteryOccurred: false }, note: null },
    remainingShares: null,
  });
  const cell = html.match(/<td data-col="lottery"[^]*?<\/td>/)![0];
  assert.match(cell, /最優先×2抽選/);
  assert.match(cell, /残口あり/);
});

test('shortStableLabel: 地方馬の長い表記はトラック名だけにする', () => {
  assert.equal(shortStableLabel('門別・田中淳司厩舎or大井・渡邉和雄厩舎（外厩）'), '門別or大井');
  // 2025年募集は or の前後に空白が入る書き方だった
  assert.equal(shortStableLabel('門別・田中淳司厩舎 or 川崎・内田勝義厩舎（外厩）'), '門別or川崎');
});

test('shortStableLabel: JRAの調教師名（・を含まない）はそのまま返す', () => {
  assert.equal(shortStableLabel('木村哲也'), '木村哲也');
  assert.equal(shortStableLabel(''), '');
});

test('horseRowHtml: 厩舎セルは短い表記にして、元の記載は title に残す', () => {
  const stable = '門別・田中淳司厩舎or大井・渡邉和雄厩舎（外厩）';
  const html = horseRowHtml({ ...horse, stable }, DEFAULT_EVALUATION);
  assert.match(html, /<td data-col="stable" title="門別・田中淳司厩舎or大井・渡邉和雄厩舎（外厩）">門別or大井<\/td>/);
});

test('horseRowHtml: メモの有無をメモ列の印（data-has-memo）で示す', () => {
  const memoCell = (memo: string) =>
    horseRowHtml(horse, { ...DEFAULT_EVALUATION, memo }).match(/<td data-col="memo" class="memo-col">[^]*?<\/td>/)![0];
  assert.match(memoCell('本命'), /class="memo-flag" data-field="memo-toggle" data-has-memo="true"/);
  assert.match(memoCell('本命'), /title="メモ: 本命"/);
  // 空でもアイコンは出す（そこから書き始められるように）。印だけ false にする。
  assert.match(memoCell(''), /class="memo-flag" data-field="memo-toggle" data-has-memo="false"/);
});

test('horseRowHtml: 評価欄にメモの印は置かない（メモ列のアイコンに一本化した）', () => {
  const evalCell = horseRowHtml(horse, { ...DEFAULT_EVALUATION, memo: '本命' }).match(
    /<div class="eval-cell">[^]*?<\/div>/,
  )![0];
  assert.ok(!evalCell.includes('memo-flag'));
});

test('horseRowHtml: メモのセルはアイコン（button）と入力欄を両方持つ（CSSで排他表示する）', () => {
  const cell = horseRowHtml(horse, DEFAULT_EVALUATION).match(/<td data-col="memo" class="memo-col">[^]*?<\/td>/)![0];
  assert.match(cell, /<button type="button" class="memo-flag"/);
  assert.match(cell, /<input type="text" class="memo-input" data-field="memo"/);
  // アイコンはクリックで開く前提の読み上げ文言にする
  assert.match(cell, /aria-label="フィリアプーラの2024のメモを開く"/);
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
