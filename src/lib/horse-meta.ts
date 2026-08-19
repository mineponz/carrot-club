/**
 * 個別ページ（`/horses/{id}/`）のtitle・descriptionを馬ごとに機械生成する。
 *
 * 個別ページは1頭あたりのデータ量が少なく、雛形をそのまま並べると
 * 「ほぼ同じ内容のページが187枚」＝重複コンテンツとして扱われかねない。
 * 馬名・血統・測尺など**その馬にしかない値**を必ず文言に混ぜて、ページごとに一意にする。
 */
import type { Horse } from './horses.ts';

/**
 * 募集馬名から母馬名を取り出す。
 * クラブの命名は「<母馬名>の<生年>」（2026年募集は「〜の25」、2025年募集は「〜の2024」）で、
 * 外国産馬には「外）」が頭に付く。`Horse` に母馬名の列が無いのでここから復元している。
 */
export function damNameOf(horse: Horse): string {
  return horse.name.replace(/^外）/, '').replace(/の\d{2,4}$/, '');
}

/** 「2026年募集」のように表示する年（`horses2026` の 2026）。 */
export type RecruitYear = 2025 | 2026;

export function horseDetailTitle(horse: Horse): string {
  const dam = damNameOf(horse);
  return `${horse.name}｜父${horse.sire}×母${dam}（母父${horse.broodmareSire}）`;
}

export function horseDetailDescription(horse: Horse, recruitYear: RecruitYear): string {
  const dam = damNameOf(horse);
  const parts = [
    `キャロットクラブ${recruitYear}年募集馬「${horse.name}」（募集番号${horse.id}・${horse.sex}）のデータ。`,
    `父${horse.sire}、母${dam}、母父${horse.broodmareSire}、母齢${horse.damAge}。`,
    `${formatBirthDateLong(horse.birthDate)}生まれ、${horse.stable}、一口${horse.pricePerShare}万円。`,
    `体高${horse.height}cm・胸囲${horse.chestGirth}cm・管囲${horse.caretGirth}cm・馬体重${horse.weight}kg。`,
    horse.sibling ? `兄姉に${horse.sibling}。` : '',
    horse.damPriority ? '母優先の対象馬。' : '',
    horse.surgery ? '手術・既往の記載あり。' : '',
    '評価・メモはブラウザに保存できます（非公式の個人ツール）。',
  ];
  return parts.filter((p) => p !== '').join('');
}

/** 2025-04-30 → 2025年4月30日（description用の読み下し表記） */
export function formatBirthDateLong(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${year}年${Number(month)}月${Number(day)}日`;
}
