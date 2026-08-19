# carrot-club

一口馬主クラブの募集馬をソート・フィルタで見比べ、自分の評価を保存できる選定支援ツール。
運用記録・タスク管理は別リポジトリの Obsidian vault（`~/secondBrain`、
`1-projects/carrot-club/`）側にある。方針の背景・意思決定はそちらを参照。

## このリポジトリの方針

- **馬データ（`src/data/`）は客観情報のみ。** 血統・測尺など公表可能な情報に限定し、
  特定個人の評価・メモ・見送り判定はコミットしない。ユーザーごとの評価はアプリの利用者が
  自分で入力する（下記）。
- **ロジックは `src/lib/` に分離し、必ずテストを書く。** UIから切り離しておくことで
  `node --test` で検証できる。ロジックを `.astro` の `<script>` に直接書かない。
- **Phase1（現状）は評価をブラウザの `localStorage` に保存する。外部送信はしない。**
  Phase2として「他ユーザーの評価傾向を集計して見せる」機能を計画しており、その際は
  Cloudflare D1 + Workers APIへの送信を追加する予定（[[20260810-build-phase1]]参照）。
  minitoolsのような「絶対に外部送信しない」という恒久ポリシーではない点に注意
  ―― ただし送信を追加する際は必ずvault側の決定ノートを作ってから実装すること
  （黙って送信を始めない）。
- 対応しない仕様は「対応しない」と明示する。

## コマンド

```
npm run dev      # 開発サーバー
npm test         # src/lib/*.test.ts を実行
npm run check    # 型チェック + テスト
npm run build    # dist/ に静的出力
```

## データ

年度ごとに `src/data/horses<募集年>.ts` を持つ。サイトが表示するのは最新年（現在は
`horses2026.ts` = 2025年産・2026年募集の94頭）。過去年のファイルは参照用に残す。

- `scripts/convert-csv.mjs`（2025年募集）: 本人のスプレッドシートCSV（客観列のみ）→ `horses2025.ts`。
- `scripts/fetch-2026-data.mjs`（2026年募集）: クラブ公式の募集馬CSV（Shift-JIS）→ `horses2026.ts` と、
  本人のスプレッドシート取込用CSV（`~/Downloads/carrot-club-2026-for-sheets.csv`）。
  今年の公式CSVには netkeibaURL・兄弟・母齢が無いため netkeiba から取得している
  （取得手順とレート配慮はスクリプト冒頭のコメント参照）。取得結果は `.cache/`（git管理外）に
  キャッシュされ、再実行時は再取得しない。

元CSV・生成したスプレッドシート用CSVは個人データを載せる前提なので**コミットしない**。
手術・既往（`surgery`）は公式CSVにもnetkeibaにも無く、クラブ公式PDFの一覧が唯一の情報源。
2026年募集ぶんは `scripts/fetch-2026-data.mjs` の `SURGERY_BY_NO` に対応表として持たせている
（再生成しても消えない。PDFが更新されたらここを直す）。`horses2026.ts` を作った背景は
vault: `1-projects/carrot-club/tasks/20260818-import-2026-data.md`。

## 年度ページの構成

- `/`（`src/pages/index.astro`）が**常に最新募集年**。`src/consts.ts` の `SITE_TAGLINE` /
  `SITE_DESCRIPTION` もルート＝最新年度向け。
- 過去年度は `/2025/`（`src/pages/2025/index.astro`）のように退避する。文言は
  `SITE_TAGLINE_2025` のように年度別定数を足し、`BaseLayout` に `title` / `description` /
  `tagline` を渡してメタ情報をその年のものにする。
- **評価の localStorage キーは年度ごとに分ける**（`storageKeyForYear(年)`）。馬IDはクラブの
  募集番号で年ごとに1から振り直されるため、キーを共有すると別の馬の評価が出てしまう。
  2025年ぶんの既存データは `carrot-club:evaluations:2025` に入っているので変更しないこと。
- 年度ページ同士は本文冒頭の `.year-switch` で相互リンクする。
- 表の見た目（評価A〜Eの色分けなど）は `BaseLayout.astro` の `is:global` スタイルと
  `src/lib/horse-row.ts` に置いて全年度で共有する。ページ側に書くと年度ぶんだけ複製になる。

### 個別ページ

- 1頭1ページを `/horses/{募集番号}/`（最新年度）と `/2025/horses/{募集番号}/` に静的生成する
  （`src/pages/horses/[id].astro` / `src/pages/2025/horses/[id].astro` の `getStaticPaths`）。
  一覧の表は横スクロールで1行に出せる情報量に限りがあるため、馬名でのロングテール検索の
  受け皿を別ページに分けている。
- 表示は `src/components/HorseDetail.astro`（年度共通）。年度差はprops（募集年・一覧のURL）だけ。
  コンポーネント内のクライアントスクリプトはpropsを直接読めないので、馬ID・募集年は
  `#eval-panel` の `data-` 属性で受け渡している。
- title / description は `src/lib/horse-meta.ts` で馬ごとに機械生成する。似た雛形が187ページ並ぶと
  重複コンテンツになりうるので、馬名・血統・測尺などその馬固有の値を必ず混ぜること。
- 一覧の馬名セルが個別ページへのリンク。年度ごとのURL接頭辞は `horseRowHtml()` の第3引数
  （既定 `/horses/`、2025年版は `/2025/horses/`）。**ビルド時とクライアント側の両方**に同じ値を
  渡すこと（片方だけだと再描画後にリンク先が年度をまたぐ）。
- `trailingSlash: 'always'` なので内部リンクは末尾スラッシュ必須（`horseDetailHref()` が付ける）。

## 注意点（minitoolsから引き継いだ実際の落とし穴）

- Node の型ストリップは TypeScript の**パラメータプロパティ**（`constructor(readonly x: T)`）に
  非対応。`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` になるのでフィールドを明示的に宣言する。
- JSON-LD は `<script type="application/ld+json" set:html={...} />` と書く。
- `SITE_URL`（`src/consts.ts`）は canonical と sitemap.xml に直結する。本番URLと一致させる。
- Cloudflareの新フローでは `wrangler.jsonc` が必須（`assets.directory` で出力先指定）。
  `not_found_handling` は `"single-page-application"` にしない（全URL 200になり重複コンテンツ扱い）。

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.
