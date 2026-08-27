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
- **評価の正本はブラウザの `localStorage`。サーバー（D1）にあるのは端末間で持ち回るための控え。**
  画面が読むのは常に localStorage の内容で、通信に失敗してもツールはそのまま使える。
- **「他会員に見せるもの」と「本人だけが読むもの」を混ぜない。** ここがこのリポジトリで一番
  壊してはいけない境界（詳細は下の「会員の評価の集計」「個人評価の端末間同期」）。
  - 他会員に見えるのは `GET /api/evaluations/summary` が返す **A〜Eの件数だけ**。
    `summarizeRows()` は rating 以外を一切読まないので、ここにメモが混ざる経路が無い。
    **集計APIに個人の項目を足さないこと。**
  - メモ・お気に入り（★）・消は、2026-08-20 から**端末間同期のため**に匿名IDへ紐づけて
    保存する（[[20260820-personal-eval-sync]]）。読み出せるのは `GET /api/evaluations/mine`
    （`X-Anon-Id` が一致する行だけ）で、**他会員には公開しない**。
    2026-08-19 の Phase2 までは「そもそも送らない」設計だったが、それは他会員への公開を防ぐ
    ためであって、本人専用の置き場を作ることとは矛盾しない。
  - 送信の組み立ては必ず `buildSubmissionBody()` を通し、受け側の `parseSubmissionBody()` も
    既知のキーだけを1つずつ読む（`...evaluation` のようなスプレッドで写さない）。
    **`Evaluation` に項目が増えても、この2か所を直さない限り送信対象にならない**状態を保つ。
  - minitoolsのような「絶対に外部送信しない」という恒久ポリシーではない点に注意 ―― ただし
    送信・公開する範囲を変える際は必ずvault側の決定ノートを作ってから実装すること
    （黙って送信・公開を始めない）。画面の文言（フッター・FAQ・個別ページ）も同時に直す。
- **`Horse` に個人の評価を持たせない。** 一覧の「自分の評価（A〜E）で絞り込む」機能
  （`HorseFilter.ratings`）は、評価そのものではなく呼び出し側が作った「馬ID→印」の対応表
  （`ratingByHorseId` / `evaluations.ts` の `ratingsByHorseId()`）を受け取る。
  全端末共通の客観データ（`src/data/`）と端末ごとの状態（localStorage）が混ざると、
  ビルド時に埋め込む初期HTMLに個人の評価が漏れる形にしやすい。
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
- **絞り込み条件と並び順もその端末に保存する**（`src/lib/filter-state.ts`、キーは
  `carrot-club:filters:<募集年>`）。開くたびに条件を入れ直す手間をなくすためのもので、
  次に開いたときは前回の条件のまま表示し、条件が入っているときは絞り込みを開いた状態にする
  （畳んだままだと頭数が減っている理由が読み取れない）。保存先は localStorage **だけ**で
  サーバーには送らない ―― 条件の組み合わせから本人の見立てが読めてしまうため。
  評価と同じく年度ごとにキーを分ける（父の選択肢も頭数も年で違う）。保存する形は
  「入力欄のid → 値」なので、絞り込みが増えてもこのファイルと保存済みデータは変えなくてよい
  （知らないidは復元時に読み飛ばす）。複数選べる絞り込み（父・性別のチェックボックス群）は
  「群のid → カンマ区切りの1つの値」に詰める（`serializeMultiValue()` / `parseMultiValue()`）。
  1つしか選べない `<select>` だったころの保存データ（値が1つだけの文字列）もそのまま復元でき、
  「N件の条件」の数え方も1群＝1件に保てる。
- 年度ページ同士は本文冒頭の `.year-switch` で相互リンクする。
- 表の見た目（評価A〜Eの色分けなど）は `BaseLayout.astro` の `is:global` スタイルと
  `src/lib/horse-row.ts` に置いて全年度で共有する。ページ側に書くと年度ぶんだけ複製になる。
- **狭い画面（`max-width: 40rem`）では No・父・母父・性・厩舎の列を隠し、馬名セルに
  重ねて出す**（`horse-row.ts` の `.sp-no` / `.sp-line` と `pedigreeLine()` /
  `stableSexLine()`）。横スクロールは残したまま、左端に固定される馬名セルだけで馬の素性
  （番号・血統・厩舎・性）が分かるようにするため。表の幅も約2160px→1430pxに縮み、
  測尺まで指を滑らせる距離が短くなる。
  **並べ替えは見出しのボタンだけで行う。** 隠した5列は見出しごと消えるため、SPではその5列で
  並べ替えられなくなるが、これは了承済み（2026-08-23）。一時期SP専用の並び替えバー
  （select＋昇順/降順ボタン）を出していたが、元の「見出しをタップして並べ替える」UIに戻すため
  取りやめた。同じ並び順の状態を2か所に見せる作りにしないこと（片方だけ直すと表示がずれる）。
  なお保存済みの並び順が隠した列だった場合、並びとしては効いたまま（切り替えだけができない）。

### 個別ページ

- 1頭1ページを `/horses/{募集番号}/`（最新年度）と `/2025/horses/{募集番号}/` に静的生成する
  （`src/pages/horses/[id].astro` / `src/pages/2025/horses/[id].astro` の `getStaticPaths`）。
  一覧の表は横スクロールで1行に出せる情報量に限りがあるため、馬名でのロングテール検索の
  受け皿を別ページに分けている。
- 表示は `src/components/HorseDetail.astro`（年度共通）。年度差はprops（募集年・一覧のURL・
  その年度の全頭・個別ページの接頭辞）だけ。
  コンポーネント内のクライアントスクリプトはpropsを直接読めないので、馬ID・募集年は
  `#eval-panel` の `data-` 属性で受け渡している。
- **馬送り**（`src/components/HorseNav.astro`、ページの上下2か所）。一覧に戻らず隣の馬を
  見られるようにするためのもの（本人の要望・2026-08-26）。並びは一覧の既定と同じ**No.昇順**
  （`findHorseNeighbors()`）で、先頭・末尾では片側のリンクを出さない（中央のセレクトの位置が
  ずれないよう、同じ幅の空要素で場所だけ残す）。前後リンクは素の `<a href>`（no-JSでも効き、
  全頭ページを数珠つなぎにたどれる）で、任意の馬へ飛ぶ `<select>` だけがJS必須。狭い画面
  （`max-width: 40rem`）では前後リンクとセレクトを2行に分ける ―― 1行に詰めると馬名が
  全部省略されて「No.54 ス…」になり、どの馬か読めなくなるため。
- 基本情報の定義リスト（`.fact-list`）は**どんなに狭い画面でも2列以上**にする。列の下限を
  `min(11rem, (100% - 1rem) / 2)` にしてあるのがそれで、素の `11rem` に戻すとSP幅（375〜412px）
  で1列に落ち、15項目が縦一列に並んでページの高さが倍になる（390px幅で515px→987px、
  2026-08-27）。広い画面では `11rem` 側が効くので3列以上の見た目は変わらない。
- 測尺（体高・胸囲・管囲・馬体重）には**同じ募集年の全頭中での順位**を添える
  （`measurementRank()` / `formatMeasurementRank()`。大きい方が1位・同値は同順位）。
  数字だけでは大柄なのか平均的なのかがその年の分布次第で読み取れないため。母集団は年度で
  閉じているので `allHorses` に別の年の配列を渡さないこと（No.も測尺の比較対象も年ごと）。
- title / description は `src/lib/horse-meta.ts` で馬ごとに機械生成する。似た雛形が187ページ並ぶと
  重複コンテンツになりうるので、馬名・血統・測尺などその馬固有の値を必ず混ぜること。
- 一覧の馬名セルが個別ページへのリンク。年度ごとのURL接頭辞は `horseRowHtml()` の第3引数
  （既定 `/horses/`、2025年版は `/2025/horses/`）。**ビルド時とクライアント側の両方**に同じ値を
  渡すこと（片方だけだと再描画後にリンク先が年度をまたぐ）。
- `trailingSlash: 'always'` なので内部リンクは末尾スラッシュ必須（`horseDetailHref()` が付ける）。
- 「キャロットにいる兄姉」欄（`src/lib/sibling-recruits.ts`）は、その馬と**同じ母の産駒で過去に
  キャロットが募集した馬**の募集時測尺と通算成績・獲得賞金を出す。突き合わせ元は分析用の
  `analysis/data/`（2017〜2025年募集）で、`analysis-data.ts` 経由でビルド時にだけ読む。
  照合は3通り ―― ①「母のnetkeiba個体ページIDが一致」（確実。母のURLがあるのは2017〜2020・
  2024・2025年募集）、②「母馬名が一致」（①が使えない2021〜2023年募集ぶんを拾う）、
  ③「`Horse.sibling` の実名が過去募集馬の実名と一致」（母を特定できなくても代表兄姉1頭は拾える）。
  母馬名は年度によって置き場が違う（2017〜2020は`damName`列、2022は`dam`列、他は募集名
  「<母馬名>の<生年>」から復元）ので `analysis-data.ts` の `damName` に寄せる。復元には
  `damNameFromRecruitName()`（`horse-meta.ts`）を使い、**募集名の形でないものは null にする**
  ―― 2017〜2020年募集の `name` は競走馬の実名なので、そのまま母馬名として扱うと同名の
  繁殖牝馬の産駒を兄姉として並べてしまう。②は**両方に母のURLがあって不一致のときは使わない**
  （URLで別の母と分かっているものを名前で拾い直さないため）。「アンフィトリテ」と
  「アンフィトリテⅡ」は別の繁殖牝馬なので、`normalizeDamName()` は全角Ⅱ↔半角IIを揃えるだけで
  **Ⅱ自体は落とさない**。
  `findSiblingRecruits()` は配列を引数で受け取る純粋関数にしてある（JSONの読み込みを含めると
  `node --test` で動かせなくなるため）。

## 会員の評価の集計（Phase2 / D1 + Worker）

一覧の「みんな」列と個別ページの「他の会員の評価」に、馬ごとのA〜E件数を出す。

- **新しいサーバーは無い。** 同じWorkersプロジェクトに `main`（`worker/index.ts`）と
  D1バインディングを足しただけ。`worker/index.ts` の最後は必ず `env.ASSETS.fetch(request)`
  にフォールバックすること。ここを外すとアセットに一致しないURL（＝全ページ）がWorkerで
  行き止まりになり、`not_found_handling: "404-page"` も効かなくなる。
  **新しいルートはこのフォールバックより前に足す。**
- API: `POST /api/evaluations`（自分の評価を1行upsert） /
  `GET /api/evaluations/summary?year=`（馬IDごとのA〜E件数） /
  `GET /api/evaluations/mine?year=`（自分の行だけ）。それ以外は静的アセット。
- **匿名IDはbodyではなく `X-Anon-Id` ヘッダで送る。** 「誰が」と「何を」を別の場所に置くと、
  bodyの検証をrating関連だけに閉じ込められる。IDは `localStorage` の
  `carrot-club:anon-id` に置くUUIDで、年度で分けない（`src/lib/anon-id.ts`）。
- 送信・保存する項目を増やさないための作りは「このリポジトリの方針」を参照。
- 通信は**失敗しても画面を壊さない**（`src/lib/evaluation-client.ts` が例外を飲む）。
  一覧の「みんな」列は未取得＝「…」、取得済みで0票＝「−」と表示を分ける。
  同じ表示にすると通信失敗と0票が利用者に区別できない。
- ローカル確認:
  ```
  npx wrangler d1 migrations apply carrot-club-evaluations --local
  npx wrangler dev --local
  ```
  ローカルのworkerdバイナリが `wrangler.jsonc` の `compatibility_date` に追いつくまでは
  `--compatibility-date` で古い日付を渡して起動する（設定ファイル側は本番に合わせたまま）。
- `wrangler.jsonc` の `database_id` は `wrangler d1 create` の出力に差し替えること。
  ローカル実行はこの値を見ないので、未設定でも気づかずデプロイで失敗しうる。
- `wrangler dev` は**必ずバックグラウンドで起動して curl で確かめる**。フォアグラウンドで
  起動するとプロンプトが返らず、AIセッションは無応答のまま止まる（実際に起きた）。

## 個人評価の端末間同期（2026-08-20）

ログインを持たないまま、スマホとPCで同じ評価を見られるようにする仕組み。

- **同期ID＝匿名ID**（`carrot-club:anon-id` のUUID）。集計の重複除けと同じものを使い回す。
  これは**知っている人が誰でもその人の評価とメモを読み書きできる合言葉**なので、
  画面では既定で伏せ字（`maskAnonId()`）にし、「他人に教えない」注記と必ずセットで出す。
  この注記を消す・弱めることはしない。
- UIは `src/components/SyncPanel.astro`（年度一覧ページの表の直下）。BaseLayoutには置かない
  ―― 評価の保存キーは年度ごとなので、年度を知らないページに出すと対象年が曖昧になる。
- 取り込み（復元）は**明示操作のみ**。ページを開いただけでサーバーの内容を被せない
  （オフラインで入れた手元の評価を黙って消さないため）。突き合わせは `mergeEvaluationMaps()`
  ＝「同じ馬はサーバー側で上書き、サーバーに無い馬は手元のまま」。
- 初回の「預ける」だけは全件アップロード（`uploadAllEvaluations()`）。Phase2までの評価は
  rating しか送られていないため、これを押さないと引き継ぎ先にメモが出てこない。
- 以後の変更は `queueEvaluationSync()` が少しまとめて送る（メモの打鍵ごとにPOSTしない）。
  離脱時は `pagehide` / `visibilitychange` で送り切る。
- メモの上限 `MAX_MEMO_LENGTH` は `evaluation-api.ts` の一箇所だけに置き、入力欄の
  `maxlength` もそこから取る。別々に持つと「入力できるのに同期だけ400で失敗」する。
- 同期パネルと一覧の表は別スクリプトなので、取り込み後は `EVALUATIONS_RESTORED_EVENT` を
  `document` に投げて表に読み直させる（表はメモリ上にマップを持っている）。
- マイグレーションは `0002`（memo / favorite / skip 列と anon_id 索引の追加）と
  `0003`（rating を NULL 許容に作り直す）の2本。**両方適用しないと「メモだけ付けた馬」が
  同期されない**（0001 の `rating TEXT NOT NULL` に引っかかってINSERTが落ちる）。
  0002 だけの状態でも rating 付きの評価は同期でき、クライアントは失敗を握りつぶす。

## 注意点（minitoolsから引き継いだ実際の落とし穴）

- Node の型ストリップは TypeScript の**パラメータプロパティ**（`constructor(readonly x: T)`）に
  非対応。`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` になるのでフィールドを明示的に宣言する。
- JSON-LD は `<script type="application/ld+json" set:html={...} />` と書く。
- OGP画像は既定が `public/og-v2.png`（全ページ共通）。`BaseLayout` に `ogImage` /
  `ogImageAlt` を渡すとページ単位で差し替えられる。分析記事（`/articles/*`）は記事名が
  カードに出ないと何の記事か分からないので専用画像を持つ
  （生成: `node scripts/generate-og-article.mjs <スラッグ>`。1200x630・要playwright）。
  **作り替えたらファイル名の `-v1` を上げること**（SNSは画像URL単位でキャッシュする）。
  記事の相関係数のように成績更新で変わる数字は画像に焼き込まない（カードだけ古い値で残る）。
- `SITE_URL`（`src/consts.ts`）は canonical と sitemap.xml に直結する。本番URLと一致させる。
- Cloudflareの新フローでは `wrangler.jsonc` が必須（`assets.directory` で出力先指定）。
  `not_found_handling` は `"single-page-application"` にしない（全URL 200になり重複コンテンツ扱い）。

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.
