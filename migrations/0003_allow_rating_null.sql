-- rating を NULL 許容にする（「メモだけ」「★だけ」の馬を保存できるようにするため）。
--
-- ## なぜ必要か
-- 0001 の evaluations は「rating を集計するためのテーブル」だったので
-- `rating TEXT NOT NULL CHECK (rating IN ('A'..'E'))` になっている。0002 でメモ等を足したが、
-- A〜Eを付けずにメモだけ書いた馬（「気になるので後で調べる」等）は rating が無いため
-- 1行も INSERT できない＝その馬のメモが同期されない。NOT NULL は ALTER TABLE では外せないので、
-- SQLite の定石どおりテーブルを作り直す。
--
-- ## 安全性
-- - 移行は「新テーブルへ全行コピー → 旧テーブルを削除 → 改名」の順で、D1 は
--   1ファイル内の文を1つのトランザクションとしてまとめて実行するため、途中で失敗しても
--   ロールバックされる（部分適用にならない）。
-- - コピーするのは既存の5列＋0002で足した3列。列の中身は変換しない。
-- - CHECK は「NULL または A〜E」に緩めるだけで、A〜E以外の文字列は今まで通り入らない。
--
-- ## 0002 だけ適用した状態でも壊れはしない
-- rating 付きの評価（＝これまで通りの使い方）はそのまま同期される。rating が無い行の
-- INSERT だけが NOT NULL 制約で失敗し、クライアントは失敗を握りつぶす（localStorage には残る）。
-- つまりこのファイルは「メモだけの馬も同期したい」場合に必要な追加ぶん。
CREATE TABLE evaluations_new (
  horse_id   TEXT    NOT NULL,
  year       INTEGER NOT NULL,
  anon_id    TEXT    NOT NULL,
  -- NULL = A〜Eを付けていない（メモや★だけがある状態）。集計API側は rating が
  -- A〜Eの行しか数えない（src/lib/evaluation-api.ts の summarizeRows が弾く）。
  rating     TEXT    CHECK (rating IS NULL OR rating IN ('A', 'B', 'C', 'D', 'E')),
  memo       TEXT    NOT NULL DEFAULT '',
  favorite   INTEGER NOT NULL DEFAULT 0,
  skip       INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (horse_id, year, anon_id)
);

INSERT INTO evaluations_new (horse_id, year, anon_id, rating, memo, favorite, skip, updated_at)
SELECT horse_id, year, anon_id, rating, memo, favorite, skip, updated_at FROM evaluations;

DROP TABLE evaluations;

ALTER TABLE evaluations_new RENAME TO evaluations;

-- 索引はテーブルと一緒に消えるので張り直す（0001・0002 と同じ定義）。
CREATE INDEX IF NOT EXISTS idx_evaluations_year ON evaluations (year, horse_id, rating);
CREATE INDEX IF NOT EXISTS idx_evaluations_anon ON evaluations (anon_id, year);
