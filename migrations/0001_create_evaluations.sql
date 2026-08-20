-- 会員同士の評価（印）を集計するためのテーブル。
--
-- **保存するのは rating（A〜E）と匿名IDだけ**。メモ・お気に入り・消フラグは
-- 個人的な内容になりうるため列そのものを作らない（列が無ければ、将来うっかり
-- 保存する経路も作れない）。src/lib/evaluations.ts 冒頭の設計方針と対応している。
--
-- anon_id はブラウザの localStorage に持つ UUID で、会員番号など個人を特定できる
-- 情報とは一切紐付けない。
--
-- 主キーを (horse_id, year, anon_id) の複合にしているのは「1人1頭につき1票」を
-- DB側で保証するため。同じ人が評価を付け直したら UPSERT で上書きする
-- （履歴は残さない。誰がいつ何に変えたかを溜めても集計には使わないため）。
--
-- year は募集年。馬IDはクラブの募集番号で年ごとに1から振り直されるので、
-- year が無いと 2025年募集のNo.1 と 2026年募集のNo.1 が同じ馬として集計される。
CREATE TABLE IF NOT EXISTS evaluations (
  horse_id   TEXT    NOT NULL,
  year       INTEGER NOT NULL,
  anon_id    TEXT    NOT NULL,
  rating     TEXT    NOT NULL CHECK (rating IN ('A', 'B', 'C', 'D', 'E')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (horse_id, year, anon_id)
);

-- 集計APIは常に year で絞ってから horse_id・rating で GROUP BY する。
-- 複合主キーの先頭が horse_id なので、year 単独の検索には主キーの索引が効かない。
CREATE INDEX IF NOT EXISTS idx_evaluations_year ON evaluations (year, horse_id, rating);
