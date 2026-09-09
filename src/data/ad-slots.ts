/**
 * 忍者AdMaxの枠コード。
 *
 * `AdSlot.astro` のコメントは「設置場所ごとに発行した枠コードを使う」としているが、
 * 実際には `height.astro` / `caret-girth.astro` / `weight.astro` などが同じ5個の定数を
 * それぞれのファイルに書き写している状態だった。出資馬コンテンツ（`/my-horses/*`）を足すにあたり
 * **同じ枠を流用してよい**と判断（本人、2026-09-06）したため、3度目のコピーを作らずここに集約する。
 *
 * 既存の分析記事は各ファイルにローカル定数を持ったままなので、触る機会があればここに寄せる。
 * 枠を新規発行して場所ごとに分けたくなったら、この定数を増やして呼び出し側を差し替える。
 */

/** スマホ用・横長A */
export const AD_SP_WIDE_A = 'f81bbb016a82d6366a0e2f70051b1a0c';
/** スマホ用・横長B */
export const AD_SP_WIDE_B = 'b4b7d55c89d5fc92c564979491a16ad1';
/** スマホ用・レクタングル */
export const AD_SP_RECT = '24e3e1a24f40d88ee1a0ca315c54a7b9';
/** PC用・横長A */
export const AD_PC_WIDE_A = 'f0efb5bd6ae3e164bb584a4dbb846f48';
/** PC用・横長B */
export const AD_PC_WIDE_B = '0a525f6469ec1f40642b4550e53d39cc';
