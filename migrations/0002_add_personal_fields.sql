-- 自分の評価を端末間で同期するために、メモ・お気に入り（★）・消フラグの列を足す。
--
-- ## 0001 からの方針変更（何が変わって、何が変わらないか）
-- 0001 では「この3つは列そのものを作らない」ことで他会員への公開を構造的に防いでいた。
-- 今回追加するのは**本人しか読めない置き場**であって、公開範囲は一切広げていない。
--   - 集計API `/api/evaluations/summary` は今まで通り rating を GROUP BY した件数だけを返す。
--     memo / favorite / skip を SELECT する経路はそこに存在しない。
--   - この3列を読むのは `/api/evaluations/mine`（`X-Anon-Id` ヘッダのIDの行だけを返す）のみ。
-- 逆に言うと、匿名IDを知っている人はその人の評価を読める。IDは事実上の合言葉になるので、
-- 画面側で「他人に教えないこと」を明示している（BaseLayout の同期パネル）。
--
-- ## 適用時の注意
-- ALTER TABLE ADD COLUMN なので既存行はそのまま残り、既定値（''／0）が入る。
-- 既存の rating も消えない。DEFAULT を付けているのは、0001 時代のクライアント
-- （rating しか送らない古いJSがキャッシュに残っている場合）が INSERT しても壊れないようにするため。
ALTER TABLE evaluations ADD COLUMN memo TEXT NOT NULL DEFAULT '';
ALTER TABLE evaluations ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE evaluations ADD COLUMN skip INTEGER NOT NULL DEFAULT 0;

-- `/api/evaluations/mine` は (anon_id, year) で1人ぶんを引く。0001 の索引は
-- (year, horse_id, rating) なので anon_id の絞り込みには効かない。
CREATE INDEX IF NOT EXISTS idx_evaluations_anon ON evaluations (anon_id, year);
