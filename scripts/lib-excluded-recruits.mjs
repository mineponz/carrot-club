/**
 * 勝ち上がり率の記事・デビュー時期の記事で共有する「分母から外す募集馬」の定義。
 * build-win-up-rate.mjs と build-debut-timing.mjs が同じ母集団（721頭）になるよう、ここ1か所に置く。
 */

/** 募集中止とみなして分母から外す馬（本人判断・2026-10-23。公式ページは価格欄が空で0戦・馬名なし）。 */
export const EXCLUDED_RECRUITS = [{ recruitYear: 2023, no: '31', reason: '募集中止とみなす（公式ページの価格欄が空・0戦）' }];
export const isExcluded = (r) => EXCLUDED_RECRUITS.some((e) => e.recruitYear === r.recruitYear && e.no === String(r.no));
