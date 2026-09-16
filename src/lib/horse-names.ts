/**
 * 読み物記事「キャロ募集馬の馬名傾向」用のデータ整形。
 *
 * 素材は `analysis/data/carrot-horse-names.json`（`scripts/convert-horse-names.mjs` が
 * `carrot-horse-names.tsv` から変換）。キャロ公式「馬名一覧」の1994〜2024年産2085頭ぶんで、
 * 記事の対象範囲は本人指定の2016〜2024年産（`loadHorseNames({ fromBirthYear: 2016,
 * toBirthYear: 2024 })`）。
 *
 * `analysis-data.ts` と同じ理由（`import.meta.url` はビルド後にバンドル先チャンクの場所を
 * 指してしまう）でJSONはViteのJSON importで読む。`node --test` から検証できるよう
 * `with { type: 'json' }` を付けている（付けないとNode単体実行時に
 * `ERR_IMPORT_ATTRIBUTE_MISSING` になる。Viteのビルドはこの構文も解決できる）。
 */
import horseNamesJson from '../../analysis/data/carrot-horse-names.json' with { type: 'json' };
import { damNameFromRecruitName, normalizeDamName } from './horse-meta.ts';
import type { RecruitWithResult } from './analysis-data.ts';

export interface RawHorseName {
  /** 生年（西暦）。募集馬名「◯◯の2024」の末尾と同じ。 */
  birthYear: number;
  /** クラブの募集番号（募集を取り下げた馬・生年内での通し番号）。 */
  no: string;
  clubId: string;
  /** 募集時の仮の名前（例: "ピンクアリエスの2024"）。 */
  recruitName: string;
  /** 登録された馬名（カタカナ）。 */
  name: string;
  nameAlpha: string;
  /** 公式表記の言語国（表記ゆれあり。正規化前）。空文字のこともある。 */
  language: string;
  /** 馬名の意味・由来（公式表記のまま）。 */
  meaning: string;
}

export interface HorseNamesFile {
  fetchedAt: string;
  source: string;
  horses: RawHorseName[];
}

/**
 * 由来の4区分。判定は `originOf()`。
 * - dam: 母（母名・母系・牝系・母父名など）だけが由来
 * - sire: 父だけが由来
 * - both: 両方が由来
 * - other: 母・父どちらの名前にも由来しない（願い文・その他）
 */
export type Origin = 'dam' | 'both' | 'sire' | 'other';

/**
 * 母方由来のキーワード。「母父名」（母父＝母系側の情報なので母方に数える）を含む。
 * 「母(、|より連想|から連想)」は「母、母母名より連想」のように「母」が単独で連想元に
 * 挙がっているケースを拾う。
 */
const DAM_ORIGIN_RE =
  /母名|母母名|母父名|母系|牝系|母の(生産国|故郷|母国|母)|母馬の生産国|両親|母(、|より連想|から連想)/;

/**
 * 父方由来のキーワード。判定前に文中の「母父名」を取り除いてから当てる
 * （「父名、母父名より連想」の「母父名」を父方に誤って数えないため。この前処理は
 * `DAM_ORIGIN_RE` にも同じ文字列で適用するので、"母父名"単独では母方にも当たらなくなる
 * ―― 実データ・下記テストケースいずれも「父名／母名／両親」等の明示語が別途あるので、
 * 前処理後もそちらで正しく判定できる）。
 */
const SIRE_ORIGIN_RE = /父名|父系|両親|父の出身/;

/** 「母父名」を取り除いた文字列に対して母方・父方それぞれの判定を行う。 */
export function originOf(meaning: string): Origin {
  const cleaned = meaning.replace(/母父名/g, '');
  const dam = DAM_ORIGIN_RE.test(cleaned);
  const sire = SIRE_ORIGIN_RE.test(cleaned);
  if (dam && sire) return 'both';
  if (dam) return 'dam';
  if (sire) return 'sire';
  return 'other';
}

/**
 * 言語表記のゆれを正規化する。
 * - 希語／古代ギリシャ語 → ギリシャ語
 * - 葡語 → ポルトガル語 ／ 蘭語 → オランダ語 ／ ペルシャ語 → ペルシア語 ／ 西国 → 西語
 * - 「、」「＋」で複数言語が並ぶものは「複数」に寄せる（元の組み合わせを言語別集計に
 *   混ぜると实際の言語比率が歪むため）
 * - 空文字は null（言語国の記載が無い馬）
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  希語: 'ギリシャ語',
  古代ギリシャ語: 'ギリシャ語',
  葡語: 'ポルトガル語',
  蘭語: 'オランダ語',
  ペルシャ語: 'ペルシア語',
  西国: '西語',
  愛語: 'アイルランド語',
  露語: 'ロシア語',
};

export function normalizeLanguage(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (trimmed.includes('、') || trimmed.includes('＋')) return '複数';
  return LANGUAGE_ALIASES[trimmed] ?? trimmed;
}

/**
 * 馬名の文字数。JRAの数え方と同じく、長音「ー」・小書き文字（ャ・ッ等）も1字と数える
 * （＝単純な文字列長）。サロゲートペアを跨ぐ文字が混ざっても数え間違えないよう
 * コードポイント単位で数える。
 */
export function nameLength(name: string): number {
  return [...name].length;
}

/**
 * 募集馬名「◯◯の2024」から母馬名を取り出す（正規化込み）。`horse-meta.ts` の
 * `damNameFromRecruitName` をそのまま使う ―― Ⅱ/II の表記ゆれ吸収（`normalizeDamName`）も
 * 同じロジックで揃えるため。形式に合わない（＝募集名でない）場合は null。
 */
export function damNameOfHorseName(recruitName: string): string | null {
  return damNameFromRecruitName(recruitName);
}

export interface HorseNameEntry extends RawHorseName {
  origin: Origin;
  /** 正規化後の言語（`normalizeLanguage(language)`）。 */
  languageNormalized: string | null;
  /** `nameLength(name)`。 */
  length: number;
  /** 募集馬名から復元した母馬名（正規化済み）。復元できなければ null。 */
  damName: string | null;
  /**
   * 母がキャロ所属馬（＝馬名一覧の全年度のどこかに馬名として載っている）なら、その馬の
   * 正規化後言語。母がキャロ所属馬でない／言語国の記載が無い場合は null。
   */
  damLanguage: string | null;
}

const file = horseNamesJson as unknown as HorseNamesFile;

/** データ取得時点（画面の「データについて」に出す）。 */
export const HORSE_NAMES_FETCHED_AT: string = file.fetchedAt;
/** 出所URL。 */
export const HORSE_NAMES_SOURCE: string = file.source;

let allEntriesCache: HorseNameEntry[] | null = null;

/**
 * 馬名一覧（全年度・1994〜2024年産）から「馬名（正規化）→ 正規化後言語」の索引を作る。
 * `damLanguage` の判定に使う ―― 母がキャロ所属馬なら、母自身の行がこの索引に載っている。
 */
function buildLanguageByName(): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of file.horses) {
    const lang = normalizeLanguage(h.language);
    if (lang) map.set(normalizeDamName(h.name), lang);
  }
  return map;
}

function buildAllEntries(): HorseNameEntry[] {
  if (allEntriesCache) return allEntriesCache;
  const languageByName = buildLanguageByName();
  allEntriesCache = file.horses.map((h) => {
    const damName = damNameOfHorseName(h.recruitName);
    return {
      ...h,
      origin: originOf(h.meaning),
      languageNormalized: normalizeLanguage(h.language),
      length: nameLength(h.name),
      damName,
      damLanguage: damName ? (languageByName.get(damName) ?? null) : null,
    };
  });
  return allEntriesCache;
}

/**
 * 生年の範囲（両端含む）で絞った馬名エントリ一覧。記事の対象は2016〜2024年産
 * （`loadHorseNames({ fromBirthYear: 2016, toBirthYear: 2024 })`）。
 */
export function loadHorseNames(opts: { fromBirthYear: number; toBirthYear: number }): HorseNameEntry[] {
  return buildAllEntries().filter(
    (e) => e.birthYear >= opts.fromBirthYear && e.birthYear <= opts.toBirthYear
  );
}

/**
 * 馬名一覧の1頭を `recruits.json`（`loadRecruitsWithResults()`）の馬と結合する。
 * 突き合わせキーは「母名（正規化）＋生年（recruitYear-1＝募集馬の生年）」。
 *
 * `sibling-recruits.ts` / `dam-siblings.ts` と同じ方針で、JSONの読み込みは呼び出し側に任せ
 * ここは配列を受け取る純関数にしている（`node --test` で検証できるようにするため）。
 * 呼び出し側は `joinRecruit(entry, loadRecruitsWithResults())` のように渡す。
 *
 * 一致しない馬（公式馬名一覧838頭とrecruits.json818頭の間で名寄せできない分）は null。
 * 2016〜2024年産での一致数・不一致頭数はデータ更新で変わるためテストで固定値にしない。
 */
/**
 * 母馬名の「外)」「外）」（外国産馬の接頭辞）を落とす。`recruits.json` 側には
 * 「外)ザガールインザットソング」のように**半角括弧つき**で入っている母がいる一方、
 * 馬名一覧の募集馬名にはこの接頭辞が無いため、これを吸収しないと結合できない
 * （2026-09-16、セレナズヴォイス1頭がこれで取りこぼされていた）。
 */
export function stripImportPrefix(name: string): string {
  return name.replace(/^外[)）]\s*/, '');
}

export function joinRecruit(
  horseName: Pick<HorseNameEntry, 'damName' | 'birthYear'>,
  recruits: readonly RecruitWithResult[]
): RecruitWithResult | null {
  if (!horseName.damName) return null;
  const wanted = stripImportPrefix(horseName.damName);
  for (const r of recruits) {
    if (r.damName && stripImportPrefix(r.damName) === wanted && r.recruitYear - 1 === horseName.birthYear) {
      return r;
    }
  }
  return null;
}
