/**
 * 個別ページ（`/horses/{id}/`）のtitle・descriptionを馬ごとに機械生成する。
 *
 * 個別ページは1頭あたりのデータ量が少なく、雛形をそのまま並べると
 * 「ほぼ同じ内容のページが187枚」＝重複コンテンツとして扱われかねない。
 * 馬名・血統・測尺など**その馬にしかない値**を必ず文言に混ぜて、ページごとに一意にする。
 */
import type { Horse } from './horses.ts';

/**
 * 母馬名を突き合わせるための正規化。
 * 外国産の繁殖牝馬に付く「Ⅱ」は、年度によって全角ローマ数字（`アンフィトリテⅡの21` の募集名）と
 * 半角2文字（2022年募集の母名列 `アンフィトリテII`）が混在するので NFKC で寄せる。
 * **数字の後ろを削るような加工はしない** ―― 「アンフィトリテ」と「アンフィトリテⅡ」は別の繁殖牝馬で、
 * ここを潰すと別の母の産駒を兄姉として並べてしまう。
 */
export function normalizeDamName(name: string): string {
  return name.normalize('NFKC').trim();
}

/**
 * 募集馬名「<母馬名>の<生年>」から母馬名を取り出す。形式に合わなければ null。
 * （2026年募集は「〜の25」、2025年募集は「〜の2024」。外国産馬には「外）」が頭に付く）
 *
 * null を返す口があるのは、`sibling-recruits.ts` が**過去の募集馬**にもこれを掛けるため。
 * 2017〜2020年募集ぶんは `name` が競走馬の実名（例: `ナミュール`）なので、後ろを削る作りだと
 * 実名がそのまま母馬名として返ってしまい、同名の繁殖牝馬と誤って結び付く。
 */
export function damNameFromRecruitName(name: string): string | null {
  const m = name.match(/^(?:外）)?(.+)の\d{2,4}$/);
  return m ? normalizeDamName(m[1]) : null;
}

/**
 * 募集馬名から母馬名を取り出す。`Horse` に母馬名の列が無いのでここから復元している。
 * 表示用なので、命名が想定と違っても文言が空にならないよう「外）」だけ落として返す。
 */
export function damNameOf(horse: Horse): string {
  return damNameFromRecruitName(horse.name) ?? horse.name.replace(/^外）/, '');
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

/**
 * クラブ公式サイトが持つ馬体写真のURL。
 *
 * `https://carrotclub.net/upfile/<code>/bd-<code>.jpg` の `<code>` は「生年下2桁＋募集番号
 * （3桁ゼロ埋め）」（例: 2025年生まれの募集番号1なら `25001`）。募集番号ではなく生年を使うのは、
 * 2026年募集馬の名前が「〜の25」＝2025年生まれだから（2026-08-26、`carrotclub.net`への実アクセスで
 * 1〜94番全頭の200応答を確認して確定）。2025年募集以前は生年の表記が異なり未検証なので、
 * 呼び出し側で2026年募集にだけ絞って使うこと。
 */
export function horsePhotoUrl(horse: Horse): string {
  const birthYearYY = horse.birthDate.slice(2, 4);
  const code = `${birthYearYY}${horse.id.padStart(3, '0')}`;
  return `https://carrotclub.net/upfile/${code}/bd-${code}.jpg`;
}

/**
 * Google検索のURL。個別ページの「この馬を調べる」から、募集馬名でそのまま検索できるように
 * するためのもの（本人の要望・2026-08-31）。netkeiba・Xだけでは、クラブの公式ページや個人
 * ブログの見立てなど「どこにあるか分からない情報」に辿り着けないため。
 *
 * 検索語は募集馬名をそのまま使う（例:「ハープスターの25」。本人指定）。「キャロット」等を
 * 足して絞り込まないこと ―― 募集馬名は十分に珍しく、余計な語を足すと逆に取りこぼす。
 *
 * `Horse.xSearchUrl` のように生成済みURLをデータ側に持たせないのは、クエリを変えたくなった
 * ときに全頭ぶんのデータを作り直さずに済ませるため（`src/data/` は客観データだけに保つ）。
 * 検索語はエンコードして渡す ―― 馬名には「Ⅱ」のようにURLで意味を持ちうる文字が入る。
 */
export function googleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
