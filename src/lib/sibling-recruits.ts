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
 * 突き合わせは2通り。どちらか一方でも当たれば兄姉として扱う。
 * 1. **母のnetkeiba個体ページID**が一致（＝同じ母の産駒）。確実な方法。年によって母のURLが
 *    無いこともある（2021〜2023年は元スプレッドシートに母の列が無い。2017〜2020年は
 *    クラブ公式サイトの測尺一覧に母の列自体が無いためnetkeiba検索で別途特定しており、
 *    345/348頭は埋まっているが3頭は未特定=null）。
 * 2. **`Horse.sibling`（代表的な兄姉の実名）が過去募集馬の実名と一致**。1でカバーできない
 *    年（母のURLが無い馬）を拾える。競走馬名は登録上ユニークなので同名の別馬は入らない。
 *
 * 「兄姉」なので対象は募集年がその馬より前の馬に限る（同年・後年の馬は同じ母から生まれえない）。
 */
import type { RecruitWithResult } from './analysis-data.ts';

export interface SiblingRecruit {
  recruitYear: number;
  /** その年の募集番号 */
  no: string;
  /** 表示名（競走馬登録後の実名。未登録なら募集時の名前） */
  name: string;
  netkeibaUrl: string | null;
  /** 募集時の測尺。取れていない年度・馬は null */
  height: number | null;
  chestGirth: number | null;
  caretGirth: number | null;
  weight: number | null;
  starts: number | null;
  wins: number | null;
  /** 中央+地方の獲得賞金合計（万円）。成績が取れていなければ null */
  totalPrizeManYen: number | null;
  /** どちらの手がかりで兄姉と判定したか（母一致が確実。名前一致は代表兄姉のみ） */
  matchedBy: 'dam' | 'name';
}

/** netkeibaの個体ページURLから馬ID部分を取り出す。外国産の繁殖牝馬は `000a01294d` のような英数字。 */
export function netkeibaHorseId(url: string | null | undefined): string | null {
  const m = (url ?? '').match(/\/horse\/([0-9a-zA-Z]+)/);
  return m ? m[1] : null;
}

function toSibling(recruit: RecruitWithResult, matchedBy: 'dam' | 'name'): SiblingRecruit {
  return {
    recruitYear: recruit.recruitYear,
    no: recruit.no,
    name: recruit.displayName,
    netkeibaUrl: recruit.netkeibaUrl,
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

/** 兄姉の手がかり。`Horse` そのものではなく必要な2列だけ受け取る。 */
export interface SiblingLookupKey {
  /** その馬の母のnetkeiba個体ページURL（無い年度は空文字） */
  damUrl: string;
  /** 代表的な兄姉の実名（無ければ空文字） */
  sibling: string;
}

/**
 * 過去募集馬のうち、その馬の兄姉にあたるものを募集年の新しい順に返す。
 * 同じ馬が母一致と名前一致の両方で当たった場合は母一致（確実なほう）を残す。
 */
export function findSiblingRecruits(
  horse: SiblingLookupKey,
  recruitYear: number,
  pool: readonly RecruitWithResult[]
): SiblingRecruit[] {
  const damId = netkeibaHorseId(horse.damUrl);
  const siblingName = horse.sibling.trim();
  const found = new Map<string, SiblingRecruit>();

  for (const recruit of pool) {
    if (recruit.recruitYear >= recruitYear) continue;
    const key = `${recruit.recruitYear}-${recruit.no}`;
    const sameDam = damId != null && netkeibaHorseId(recruit.damUrl) === damId;
    if (sameDam) {
      found.set(key, toSibling(recruit, 'dam'));
      continue;
    }
    if (siblingName !== '' && recruit.realName === siblingName && !found.has(key)) {
      found.set(key, toSibling(recruit, 'name'));
    }
  }

  return [...found.values()].sort(
    (a, b) => b.recruitYear - a.recruitYear || Number(a.no) - Number(b.no)
  );
}

/** 「12戦2勝」。未出走は「未出走」、成績が取れていなければ null（行に出さない）。 */
export function formatSiblingRecord(sibling: SiblingRecruit): string | null {
  if (sibling.starts == null || sibling.wins == null) return null;
  if (sibling.starts === 0) return '未出走';
  return `${sibling.starts}戦${sibling.wins}勝`;
}

/** 募集時の測尺を「体高155cm / 胸囲178cm / 管囲20.5cm / 馬体重460kg」の形にする。 */
export function formatSiblingMeasurements(sibling: SiblingRecruit): string {
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
export function siblingDetailHref(sibling: SiblingRecruit): string | null {
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
