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

`src/data/horses2025.ts` が2025年募集馬の客観データ。現状はプレースホルダ（ダミー3頭）。
本人からCSV（客観列のみ）を受け取り次第、実データに差し替える
（vault: `1-projects/carrot-club/tasks/20260810-build-phase1.md` 手順1）。

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
