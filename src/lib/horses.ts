/**
 * 募集馬の客観データ型と、ソート・フィルタの純粋関数。
 *
 * `Horse` に入るのは公表されている客観情報のみ（血統・測尺・厩舎など）。個人の評価・メモ・
 * 見送り判定を**保存する**のは `evaluations.ts`（ユーザーごとのlocalStorage）側の責務で、
 * このファイルは `localStorage` にも `EvaluationMap` にも触れない。
 *
 * 例外は「自分が付けた評価での絞り込み」（`HorseFilter.ratings`）だけ。これも呼び出し側が
 * 作った「馬ID→評価」の対応表（`ratingByHorseId`）を受け取るだけに留めている。
 * `Horse` 自体に評価を持たせると、全端末共通の客観データと端末ごとの状態の境界が崩れる。
 */
import type { Rating } from './evaluations.ts';

export type Sex = '牡' | '牝' | 'セ';

export interface Horse {
  /** クラブの募集番号（一覧での通し番号） */
  id: string;
  name: string;
  sex: Sex;
  /** netkeibaの馬個体ページ */
  netkeibaUrl: string;
  /**
   * 母馬自身のnetkeiba個体ページ（母の産駒成績を追うのに使う）。
   * 母馬IDを取得していない年度（2025年募集ぶん）は空文字で、その場合はリンクを出さない。
   */
  damUrl: string;
  sire: string;
  broodmareSire: string;
  /** 母齢（出産時点の母の年齢） */
  damAge: number;
  /** 産次（母がその仔を何番目に産んだか。1=初仔） */
  damParity: number;
  /** ISO 8601形式 (YYYY-MM-DD) */
  birthDate: string;
  stable: string;
  /** 一口価格（万円） */
  pricePerShare: number;
  /** 体高 (cm) */
  height: number;
  /** 胸囲 (cm) */
  chestGirth: number;
  /** 管囲 (cm) */
  caretGirth: number;
  /** 馬体重 (kg) */
  weight: number;
  /** 兄弟情報（代表的な兄姉の馬名。無い場合は空文字） */
  sibling: string;
  /** 母優先。その母（繁殖牝馬）に出資している会員に優先枠がある馬（クラブ側の制度上の区分） */
  damPriority: boolean;
  /** 手術・既往歴の記載（無い場合は空文字。複数行になりうる） */
  surgery: string;
  /** X（旧Twitter）の検索URL */
  xSearchUrl: string;
}

export type SortKey =
  | 'id'
  | 'name'
  | 'sex'
  | 'sire'
  | 'broodmareSire'
  | 'damAge'
  | 'damParity'
  | 'birthDate'
  | 'stable'
  | 'pricePerShare'
  | 'height'
  | 'chestGirth'
  | 'caretGirth'
  | 'weight';

export type SortDirection = 'asc' | 'desc';

/**
 * 指定したキーで昇順/降順にソートする。元の配列は変更しない。
 * 数値キーは引き算で、文字列キーは `localeCompare`（日本語の並び順を尊重）で比較する。
 * `id` は文字列だが実体は番号なので、数値として比較する。
 */
export function sortHorses(horses: Horse[], key: SortKey, direction: SortDirection = 'asc'): Horse[] {
  const sorted = [...horses].sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    let cmp: number;
    if (key === 'id') {
      cmp = Number(va) - Number(vb);
    } else if (typeof va === 'number' && typeof vb === 'number') {
      cmp = va - vb;
    } else {
      cmp = String(va).localeCompare(String(vb), 'ja');
    }
    return direction === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

/**
 * 個別ページで前後の馬をたどるための隣接馬。並びは**募集番号（No.）の昇順**で、
 * 一覧の既定の並び（No.順）と同じ順序で馬を1頭ずつ見ていけるようにするためのもの。
 * 先頭の馬には `prev` が、末尾の馬には `next` が無い（`undefined`）。
 */
export interface HorseNeighbors {
  prev?: Horse;
  next?: Horse;
}

/**
 * No.昇順に並べたときの、指定した馬の前後の馬を返す。
 * 渡す配列の並び順には依存しない（この関数の中で `sortHorses(..., 'id', 'asc')` する）ので、
 * 呼び出し側は「その年度の全頭」をそのまま渡してよい。該当IDが無い場合は両方 `undefined`。
 */
export function findHorseNeighbors(horses: readonly Horse[], horseId: string): HorseNeighbors {
  const sorted = sortHorses([...horses], 'id', 'asc');
  const index = sorted.findIndex((h) => h.id === horseId);
  if (index < 0) return {};
  return { prev: sorted[index - 1], next: sorted[index + 1] };
}

/** 順位を出す測尺の項目。いずれも「大きいほど上位」として扱う（本人合意・2026-08-26）。 */
export type MeasurementKey = 'height' | 'chestGirth' | 'caretGirth' | 'weight';

export interface MeasurementRank {
  /** 1位が最大値。同値は同順位（標準的な競技順位方式） */
  rank: number;
  /** 母集団の頭数（＝同じ募集年の全頭） */
  total: number;
}

/**
 * 同じ募集年の全頭の中で、その値が何位かを返す。
 *
 * **大きい方が1位・同値は同順位**（標準的な競技順位方式）。すなわち「自分より大きい値を持つ
 * 頭数 + 1」で、同値が並んだ次の順位は飛ぶ（1, 2, 2, 4）。測尺は数値が大きいほど
 * 馬格があるという読み方をするので、価格などと違い降順で数える。
 */
export function measurementRank(
  horses: readonly Horse[],
  key: MeasurementKey,
  value: number,
): MeasurementRank {
  const values = horses.map((h) => h[key]);
  return { rank: values.filter((v) => v > value).length + 1, total: values.length };
}

/** 順位の表示形（`（12位/94頭中）`）。値の後ろに足して使う。 */
export function formatMeasurementRank(rank: MeasurementRank): string {
  return `（${rank.rank}位/${rank.total}頭中）`;
}

/**
 * 評価フィルタの選択肢。A〜Eに加えて「まだ何も評価を付けていない」を `'none'` で表す。
 *
 * 未評価を `undefined` や空文字ではなく明示的な値にしているのは、チェックボックスの
 * `value` にそのまま載せられるようにするため（UI側で特別扱いの分岐を増やさない）。
 */
export const UNRATED = 'none';
export type RatingFilterValue = Rating | typeof UNRATED;

/**
 * 母優先での絞り込みの選択肢。UIの `<select>` の `value` にそのまま載せる
 * （「すべて」は値を持たない＝未指定にすることで、他の絞り込みと同じく
 * 「未選択なら条件に数えない」扱いにできる）。
 */
export type DamPriorityFilter = 'has' | 'none';

export interface HorseFilter {
  /** 馬名の部分一致 */
  name?: string;
  /** 父名の部分一致（1頭ぶんの入力欄向け。複数選びたいときは `sires`） */
  sire?: string;
  /**
   * 父名の完全一致（複数選択）。並べた父の**いずれか**に当てはまる馬を残す（OR条件）。
   * 選択肢は `uniqueValues(horses, 'sire')` の値そのものなので、部分一致にはしない
   * （「キズナ」と「キズナ産駒の別種牡馬」のような取り違えを避ける）。
   *
   * **空配列・未指定は「絞り込まない」**（＝全件通す）。`ratings` と同じ約束にしてある。
   * `sire` と併用した場合は両方満たす馬だけが残る（AND）。
   */
  sires?: readonly string[];
  /** 母父名の部分一致 */
  broodmareSire?: string;
  /** 厩舎名の部分一致 */
  stable?: string;
  /** 指定した性別のみ。未指定なら全性別 */
  sex?: Sex;
  /**
   * 性別での絞り込み（複数選択）。並べた性別の**いずれか**に当てはまる馬を残す（OR条件）。
   * 牡と セ をまとめて見たい、という使い方があるので単一の `sex` とは別に持つ。
   * **空配列・未指定は「絞り込まない」**。`sex` と併用した場合は両方満たす馬だけが残る。
   */
  sexes?: readonly Sex[];
  /** 母齢（出産時点の母の年齢）の下限・上限。若い母の初期産駒／高齢の母、で分けて見るためのもの */
  minDamAge?: number;
  maxDamAge?: number;
  minPrice?: number;
  maxPrice?: number;
  minHeight?: number;
  maxHeight?: number;
  /** 管囲 (cm)。0.1cm刻みの小数を取りうる */
  minCaretGirth?: number;
  maxCaretGirth?: number;
  minWeight?: number;
  maxWeight?: number;
  /**
   * 母優先での絞り込み。`'has'` は対象馬だけ、`'none'` は対象外の馬だけを残す。
   * **未指定（＝UIの「すべて」）は絞り込まない**。以前は「母優先のみ」のON/OFFだけだったが、
   * 「母優先が付いていない馬を見たい」（優先枠に取られない馬を探す）という使い方があるため
   * 3値にした（2026-08-23）。
   */
  damPriority?: DamPriorityFilter;
  /** trueなら手術・既往歴の記載がある馬を除外する */
  excludeSurgery?: boolean;
  /**
   * 自分が付けた評価での絞り込み。並べた値の**いずれか**に当てはまる馬を残す（OR条件）。
   * `'none'` を含めると未評価の馬も残す。
   *
   * **空配列・未指定は「絞り込まない」**（＝全件通す）。「どれも選んでいない＝0件」に
   * してしまうと、初期表示で表が空になり後方互換が壊れる。
   */
  ratings?: readonly RatingFilterValue[];
  /**
   * 馬ID→自分が付けた評価。`ratings` を使うときだけ必要で、呼び出し側が
   * `EvaluationMap` から作って渡す（`ratingsByHorseId()`）。
   * ここに無いID・`null` の馬は未評価（`'none'`）として扱う。
   */
  ratingByHorseId?: Readonly<Record<string, Rating | null>>;
}

function includesCaseInsensitive(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** フィルタ条件をすべて満たす馬だけを残す（AND条件）。未指定の条件は無視される。 */
export function filterHorses(horses: Horse[], filter: HorseFilter): Horse[] {
  return horses.filter((h) => {
    if (filter.name && !includesCaseInsensitive(h.name, filter.name)) return false;
    if (filter.sire && !includesCaseInsensitive(h.sire, filter.sire)) return false;
    if (filter.sires && filter.sires.length > 0 && !filter.sires.includes(h.sire)) return false;
    if (filter.broodmareSire && !includesCaseInsensitive(h.broodmareSire, filter.broodmareSire)) return false;
    if (filter.stable && !includesCaseInsensitive(h.stable, filter.stable)) return false;
    if (filter.sex && h.sex !== filter.sex) return false;
    if (filter.sexes && filter.sexes.length > 0 && !filter.sexes.includes(h.sex)) return false;
    if (filter.minDamAge !== undefined && h.damAge < filter.minDamAge) return false;
    if (filter.maxDamAge !== undefined && h.damAge > filter.maxDamAge) return false;
    if (filter.minPrice !== undefined && h.pricePerShare < filter.minPrice) return false;
    if (filter.maxPrice !== undefined && h.pricePerShare > filter.maxPrice) return false;
    if (filter.minHeight !== undefined && h.height < filter.minHeight) return false;
    if (filter.maxHeight !== undefined && h.height > filter.maxHeight) return false;
    if (filter.minCaretGirth !== undefined && h.caretGirth < filter.minCaretGirth) return false;
    if (filter.maxCaretGirth !== undefined && h.caretGirth > filter.maxCaretGirth) return false;
    if (filter.minWeight !== undefined && h.weight < filter.minWeight) return false;
    if (filter.maxWeight !== undefined && h.weight > filter.maxWeight) return false;
    if (filter.damPriority === 'has' && !h.damPriority) return false;
    if (filter.damPriority === 'none' && h.damPriority) return false;
    if (filter.excludeSurgery && h.surgery !== '') return false;
    if (filter.ratings && filter.ratings.length > 0) {
      const rating = filter.ratingByHorseId?.[h.id] ?? null;
      if (!filter.ratings.includes(rating ?? UNRATED)) return false;
    }
    return true;
  });
}

/** フィルタUIの選択肢を作るために、指定キーの値を重複なく昇順で返す。 */
export function uniqueValues(horses: Horse[], key: 'sire' | 'broodmareSire' | 'stable'): string[] {
  return [...new Set(horses.map((h) => h[key]).filter((v) => v !== ''))].sort((a, b) =>
    a.localeCompare(b, 'ja'),
  );
}

/**
 * 選択肢ごとの頭数。父を複数選ぶチェックリストに「その父が何頭いるか」を添えるために使う
 * （37種類も並ぶので、0頭に近い父を選んで一覧が空になる、という迷い方を減らす）。
 */
export function valueCounts(
  horses: Horse[],
  key: 'sire' | 'broodmareSire' | 'stable',
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const horse of horses) {
    const value = horse[key];
    if (value === '') continue;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

/** 性別の並び順。データに出てこない性別のチェックボックスは出さないので、順序だけここで決める。 */
const SEX_ORDER: readonly Sex[] = ['牡', '牝', 'セ'];

/**
 * その年に実在する性別だけを、牡→牝→セ の順で返す。
 * セが1頭もいない年に「セ」のチェックを出すと、押しても0頭になるだけの死んだUIになるため
 * （手術・既往の絞り込みをデータがある年だけ出しているのと同じ考え方）。
 */
export function uniqueSexes(horses: Horse[]): Sex[] {
  const present = new Set(horses.map((h) => h.sex));
  return SEX_ORDER.filter((sex) => present.has(sex));
}
