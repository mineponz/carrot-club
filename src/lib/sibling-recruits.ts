/**
 * 募集馬の「キャロットにいる兄姉」＝過去にキャロットクラブで募集された同じ母の産駒を探す。
 *
 * 個別ページで、その兄姉の**募集時の測尺**と**現在の成績（n戦n勝・獲得賞金）**を出すために使う。
 * 兄姉が同じクラブにいれば、同じ物差し（クラブ発表の測尺）で「この馬の測尺がどう出るか」を
 * 過去の実績と突き合わせられる。他所の馬にはこの比較ができないので、ここでの対象は
 * `analysis/data/recruits.json`（対象年は増減しうるためコード側では決め打ちしない。
 * 2026-08-23時点は2017〜2025年募集）に載っている馬だけ。
 *
 * データの読み込み（JSON import）は `analysis-data.ts` に任せ、この関数は渡された配列だけを見る
 * 純粋関数にしている（`node --test` で検証できるようにするため）。
 *
 * 突き合わせは3通り。どれか1つでも当たれば兄姉として扱う。
 * 1. **母のnetkeiba個体ページID**が一致（＝同じ母の産駒）。確実な方法。年によって母のURLが
 *    無いこともある（2021〜2023年は元スプレッドシートに母の列が無い。2017〜2020年は
 *    クラブ公式サイトの測尺一覧に母の列自体が無いためnetkeiba検索で別途特定しており、
 *    345/348頭は埋まっているが3頭は未特定=null）。
 * 2. **母馬名が一致**。1でカバーできない2021〜2023年募集（281頭）を拾うための道。母の列が
 *    無い年でも募集名が「<母馬名>の<生年>」なので母馬名だけは復元でき、繁殖牝馬名は
 *    重複しないよう登録される（同名の外国産には「Ⅱ」が付く）ので実質一意に当たる。
 *    ただし**両方に母のURLがあってそれが違う場合は名前が同じでも兄姉にしない**
 *    ―― URLで別の母だと分かっているものを名前で拾い直さないため。
 * 3. **`Horse.sibling`（代表的な兄姉の実名）が過去募集馬の実名と一致**。1・2で母を特定できない
 *    馬でも代表兄姉1頭だけは拾える。競走馬名は登録上ユニークなので同名の別馬は入らない。
 *
 * 2を足す前は、2021〜2023年募集の兄姉が `Horse.sibling` に載っている1頭を除いて全部抜けていた
 * （例: No.72サンブルエミューズの25にラヴェル（2021年募集）が出てこない・2026-08-23の指摘）。
 *
 * 「兄姉」なので対象は募集年がその馬より前の馬に限る（同年・後年の馬は同じ母から生まれえない）。
 *
 * 個別ページではこの兄姉に**その馬自身**を加えた1つの表にする（`buildMeasurementRows()`）。
 * 兄姉の数字だけ並べても大小の判断に上の定義リストとの往復が要るため。父を列に持つのは、
 * 同じ母の産駒同士の違いが父に出るから。2017〜2020年募集分はクラブ公式の測尺一覧に父の
 * 列が無く、当初はnullのままだったが、2026-08-23にnetkeibaの血統表ページから追加取得して
 * 345/348頭で埋めた（残り3頭はnetkeiba個体ページ自体を特定できていない馬）。
 */
import type { RecruitWithResult } from './analysis-data.ts';
import { damNameFromRecruitName } from './horse-meta.ts';

export interface SiblingRecruit {
  recruitYear: number;
  /** その年の募集番号 */
  no: string;
  /** 表示名（競走馬登録後の実名。未登録なら募集時の名前） */
  name: string;
  netkeibaUrl: string | null;
  /** 父（同じ母の産駒なので、兄姉との違いはここに出る）。取れていない年度・馬は null */
  sire: string | null;
  sex: string | null;
  /** ISO 8601形式 (YYYY-MM-DD)。取れていない馬は null */
  birthDate: string | null;
  /** 募集時の測尺。取れていない年度・馬は null */
  height: number | null;
  chestGirth: number | null;
  caretGirth: number | null;
  weight: number | null;
  starts: number | null;
  wins: number | null;
  /** 中央+地方の獲得賞金合計（万円）。成績が取れていなければ null */
  totalPrizeManYen: number | null;
  /**
   * どの手がかりで兄姉と判定したか。`dam`（母のURL一致）が一番確実で、`damName`（母馬名一致）が次点、
   * `name` は `Horse.sibling` に載っている代表兄姉1頭のみ。
   */
  matchedBy: 'dam' | 'damName' | 'name';
}

/**
 * 測尺の比較表に並べる1行。兄姉だけでなく**その馬自身**も同じ形にして先頭に置く。
 * 兄姉の数字だけ並べても「この馬はそれと比べて大きいのか小さいのか」を別の場所（上の定義リスト）と
 * 見比べないと分からないため、同じ表・同じ列に入れて目で追えるようにしている。
 */
export interface MeasurementRow {
  recruitYear: number;
  no: string;
  name: string;
  netkeibaUrl: string | null;
  sire: string | null;
  sex: string | null;
  birthDate: string | null;
  height: number | null;
  chestGirth: number | null;
  caretGirth: number | null;
  weight: number | null;
  starts: number | null;
  wins: number | null;
  totalPrizeManYen: number | null;
  /** その馬自身の行か（兄姉の行と区別して強調し、賞金の比較対象からも外す） */
  isSelf: boolean;
}

/** 自分の行を作るのに要る値だけ。`Horse` 全体は受け取らない（個人の評価を持ち込まないため）。 */
export interface SelfMeasurement {
  /** クラブの募集番号 */
  id: string;
  netkeibaUrl: string;
  sire: string;
  sex: string;
  birthDate: string;
  height: number;
  chestGirth: number;
  caretGirth: number;
  weight: number;
}

/**
 * 表のなかでその馬自身の行に出す名前。募集名は「〇〇の25」のように母名ぶんだけ長く、
 * 馬名の列が兄姉の実名より横に伸びてしまうので、自身は短い固定語にする（本人希望・2026-08-23）。
 * どの馬のページかは見出し（h1）と本文で分かるため、ここに募集名を再掲する必要はない。
 */
export const SELF_ROW_NAME = '本馬';

/**
 * その馬自身を先頭に、兄姉（募集年の新しい順）を続けた比較表の行を作る。
 * 自身はまだ走っていないので成績・賞金は持たせない（null＝表では「—」）。
 */
export function buildMeasurementRows(
  self: SelfMeasurement,
  recruitYear: number,
  siblings: readonly SiblingRecruit[]
): MeasurementRow[] {
  return [
    {
      recruitYear,
      no: self.id,
      name: SELF_ROW_NAME,
      netkeibaUrl: self.netkeibaUrl || null,
      sire: self.sire,
      sex: self.sex,
      birthDate: self.birthDate,
      height: self.height,
      chestGirth: self.chestGirth,
      caretGirth: self.caretGirth,
      weight: self.weight,
      starts: null,
      wins: null,
      totalPrizeManYen: null,
      isSelf: true,
    },
    ...siblings.map((sibling) => ({
      recruitYear: sibling.recruitYear,
      no: sibling.no,
      name: sibling.name,
      netkeibaUrl: sibling.netkeibaUrl,
      sire: sibling.sire,
      sex: sibling.sex,
      birthDate: sibling.birthDate,
      height: sibling.height,
      chestGirth: sibling.chestGirth,
      caretGirth: sibling.caretGirth,
      weight: sibling.weight,
      starts: sibling.starts,
      wins: sibling.wins,
      totalPrizeManYen: sibling.totalPrizeManYen,
      isSelf: false,
    })),
  ];
}

/** netkeibaの個体ページURLから馬ID部分を取り出す。外国産の繁殖牝馬は `000a01294d` のような英数字。 */
export function netkeibaHorseId(url: string | null | undefined): string | null {
  const m = (url ?? '').match(/\/horse\/([0-9a-zA-Z]+)/);
  return m ? m[1] : null;
}

function toSibling(recruit: RecruitWithResult, matchedBy: SiblingRecruit['matchedBy']): SiblingRecruit {
  return {
    recruitYear: recruit.recruitYear,
    no: recruit.no,
    name: recruit.displayName,
    netkeibaUrl: recruit.netkeibaUrl,
    sire: recruit.sire,
    sex: recruit.sex,
    birthDate: recruit.birthDate,
    height: recruit.height,
    chestGirth: recruit.chestGirth,
    caretGirth: recruit.caretGirth,
    weight: recruit.weight,
    starts: recruit.starts,
    wins: recruit.wins,
    totalPrizeManYen: recruit.starts == null && recruit.wins == null ? null : recruit.totalPrizeManYen,
    matchedBy,
  };
}

/** 兄姉の手がかり。`Horse` そのものではなく必要な3列だけ受け取る。 */
export interface SiblingLookupKey {
  /** 募集馬名（「<母馬名>の<生年>」）。母馬名を復元するのに使う。 */
  name: string;
  /** その馬の母のnetkeiba個体ページURL（無い年度は空文字） */
  damUrl: string;
  /** 代表的な兄姉の実名（無ければ空文字） */
  sibling: string;
}

/**
 * 過去募集馬のうち、その馬の兄姉にあたるものを募集年の新しい順に返す。
 * 1頭につき当たった手がかりは1つだけ記録し、確実な順（母のURL → 母馬名 → 代表兄姉の実名）に採る。
 */
export function findSiblingRecruits(
  horse: SiblingLookupKey,
  recruitYear: number,
  pool: readonly RecruitWithResult[]
): SiblingRecruit[] {
  const damId = netkeibaHorseId(horse.damUrl);
  const damName = damNameFromRecruitName(horse.name);
  const siblingName = horse.sibling.trim();
  const found = new Map<string, SiblingRecruit>();

  /** その過去募集馬を兄姉と言える手がかりを、確実な順に1つだけ返す。 */
  const matchClue = (recruit: RecruitWithResult): SiblingRecruit['matchedBy'] | null => {
    const recruitDamId = netkeibaHorseId(recruit.damUrl);
    if (damId != null && recruitDamId != null) {
      // 両方に母のURLがあるならそれが答え。違うなら別の母なので、母馬名では拾い直さない。
      if (recruitDamId === damId) return 'dam';
    } else if (damName != null && recruit.damName === damName) {
      return 'damName';
    }
    if (siblingName !== '' && recruit.realName === siblingName) return 'name';
    return null;
  };

  for (const recruit of pool) {
    if (recruit.recruitYear >= recruitYear) continue;
    const matchedBy = matchClue(recruit);
    if (matchedBy == null) continue;
    found.set(`${recruit.recruitYear}-${recruit.no}`, toSibling(recruit, matchedBy));
  }

  return [...found.values()].sort(
    (a, b) => b.recruitYear - a.recruitYear || Number(a.no) - Number(b.no)
  );
}

/**
 * 「12戦2勝」。未出走は「未出走」、成績が取れていなければ null（行に出さない）。
 * 兄姉の行（`SiblingRecruit`）とその馬自身も含む表の行（`MeasurementRow`）の両方から呼ぶので、
 * 見る列だけを引数の型にしている。
 */
export function formatSiblingRecord(sibling: Pick<SiblingRecruit, 'starts' | 'wins'>): string | null {
  if (sibling.starts == null || sibling.wins == null) return null;
  if (sibling.starts === 0) return '未出走';
  return `${sibling.starts}戦${sibling.wins}勝`;
}

/** 募集時の測尺を「体高155cm / 胸囲178cm / 管囲20.5cm / 馬体重460kg」の形にする。 */
export function formatSiblingMeasurements(
  sibling: Pick<SiblingRecruit, 'height' | 'chestGirth' | 'caretGirth' | 'weight'>
): string {
  const parts = [
    sibling.height == null ? null : `体高${sibling.height}cm`,
    sibling.chestGirth == null ? null : `胸囲${sibling.chestGirth}cm`,
    sibling.caretGirth == null ? null : `管囲${sibling.caretGirth}cm`,
    sibling.weight == null ? null : `馬体重${sibling.weight}kg`,
  ].filter((p): p is string => p !== null);
  return parts.join(' / ');
}

/**
 * サイト内に個別ページがある年度なら、その兄姉のページのURLを返す。
 * 個別ページを持つのは2025・2026年募集ぶんだけ（2024年以前は分析用データにしか無い）。
 * `trailingSlash: 'always'` なので末尾スラッシュを必ず付ける。
 */
export function siblingDetailHref(sibling: Pick<SiblingRecruit, 'recruitYear' | 'no'>): string | null {
  if (sibling.recruitYear === 2026) return `/horses/${sibling.no}/`;
  if (sibling.recruitYear === 2025) return `/2025/horses/${sibling.no}/`;
  return null;
}

/**
 * 成績の取得時刻（ISO 8601）を「2026年8月」の形にする。
 * 「いつ時点の成績か」を注記に出すためのもので、日までは要らない（賞金は日々変わりうる）。
 */
export function formatResultsAsOf(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})/);
  if (!m) return '';
  return `${Number(m[1])}年${Number(m[2])}月`;
}
