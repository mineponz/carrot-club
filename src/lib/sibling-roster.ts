/**
 * 個別ページの「きょうだい」表を組む。
 *
 * 元は `sibling-recruits.ts` の「キャロットにいる兄姉」だけの表だったが、本人の要望
 * （2026-08-30）で**キャロット以外のきょうだい**（サンデー・シルク・個人馬主など）も
 * 同じ1つの表に並べるようにした。母の産駒ロスターは
 * `analysis/data/dam-siblings.json`（`scripts/build-dam-siblings.mjs`）にあり、
 * 記事「母がサンデーレーシング出身の募集馬は走っているのか」用に作ったものを再利用している。
 *
 * ★測尺（体高・胸囲・管囲・馬体重）が入るのは**キャロット募集馬だけ**。クラブが募集時に
 * 公表する数字で、他クラブ・個人馬主の馬には公表が無いため取りようがない。表では「—」になる。
 * この非対称は読み手に説明が要るので、`HorseDetail.astro` 側で必ず注記を出すこと。
 *
 * 弟妹（本馬より後に生まれた産駒）も出す（本人指定・2026-08-30）。netkeibaの産駒一覧と
 * 同じく生年の新しい順に並べる。
 *
 * このモジュールは JSON を import しない純関数の集まり（`sibling-recruits.ts` と同じ方針）。
 * データは呼び出し側（`HorseDetail.astro`）から配列で渡す。`node --test` で検証するため。
 */
import type { ClubLabel } from './dam-siblings.ts';
import { CLUB_JP } from './dam-siblings.ts';
import {
  netkeibaHorseId,
  SELF_ROW_NAME,
  type SelfMeasurement,
  type SiblingRecruit,
} from './sibling-recruits.ts';

/** `dam-siblings.json` の産駒のうち、この表が見る列だけ。 */
export interface RosterFoal {
  /** 生年（産駒一覧の年度列）。誕生日が取れていない馬でも必ずある。 */
  year: number;
  horseId: string | null;
  url: string | null;
  name: string | null;
  sex: string | null;
  sire: string | null;
  /** ISO 8601 (YYYY-MM-DD)。個体ページから取れなかった馬は null。 */
  birthDate: string | null;
  club: ClubLabel;
  /** netkeibaの馬主欄そのまま。クラブ名を判定しきれなかった行の表示に使う。 */
  ownerRaw: string | null;
  isCarrotRecruit: boolean;
  recruitYear: number | null;
  starts: number | null;
  wins: number | null;
  totalPrizeManYen: number | null;
}

/**
 * 募集時の測尺の供給元。キャロット募集馬にだけ存在する。
 * 2017〜2025年募集は `analysis/data/recruits.json`、2026年募集は `src/data/horses2026.ts` と
 * 出どころが分かれているので、呼び出し側で両方をこの形に均してから渡す。
 */
export interface RosterMeasurement {
  netkeibaUrl: string | null;
  recruitYear: number;
  no: string;
  /** 競走馬登録後の実名（未登録なら null）。産駒一覧側の名前より優先する。 */
  name: string | null;
  height: number | null;
  chestGirth: number | null;
  caretGirth: number | null;
  weight: number | null;
}

/** 表の1行。 */
export interface SiblingRow {
  name: string;
  netkeibaUrl: string | null;
  sire: string | null;
  sex: string | null;
  birthDate: string | null;
  /** 並べ替えと、誕生日が取れていない馬の年表示に使う。 */
  birthYear: number;
  height: number | null;
  chestGirth: number | null;
  caretGirth: number | null;
  weight: number | null;
  starts: number | null;
  wins: number | null;
  totalPrizeManYen: number | null;
  club: ClubLabel;
  /** netkeibaの馬主欄そのまま（`formatSiblingOwner()` のフォールバック用）。 */
  ownerRaw: string | null;
  /** キャロットで募集された年（それ以外・年不明は null）。 */
  recruitYear: number | null;
  /** キャロットの募集番号（それ以外・不明は null）。 */
  no: string | null;
  /** その馬自身の行か（強調し、賞金の比較対象からも外す）。 */
  isSelf: boolean;
}

/** 表のなかでその馬自身の行に出す名前（`sibling-recruits.ts` と同じ理由で固定語）。 */
export { SELF_ROW_NAME };

/** netkeiba個体ページURLをキーにした測尺の引き表。 */
export function indexMeasurements(
  entries: readonly RosterMeasurement[]
): Map<string, RosterMeasurement> {
  const map = new Map<string, RosterMeasurement>();
  for (const e of entries) {
    const id = netkeibaHorseId(e.netkeibaUrl);
    if (id) map.set(id, e);
  }
  return map;
}

/** 生年月日から生年を取る（取れていなければ産駒一覧の年度をそのまま使う）。 */
function birthYearOf(birthDate: string | null, fallback: number): number {
  const m = (birthDate ?? '').match(/^(\d{4})/);
  return m ? Number(m[1]) : fallback;
}

export interface RosterInput {
  /** 本馬（測尺と募集番号）。 */
  self: SelfMeasurement;
  /** 本馬の募集年。 */
  selfRecruitYear: number;
  /** 母の産駒ロスター（`dam-siblings.json`）。母を特定できなければ空配列。 */
  foals: readonly RosterFoal[];
  /**
   * `findSiblingRecruits()` が拾ったキャロットの兄姉。産駒ロスター側で母を突き合わせられない
   * 馬（母のURLが無い年度など）を取りこぼさないために合流させる。
   */
  carrotSiblings: readonly SiblingRecruit[];
  /** 募集時の測尺の引き表（`indexMeasurements()`）。 */
  measurements: ReadonlyMap<string, RosterMeasurement>;
}

/**
 * 本馬＋全きょうだいの行を生年の新しい順に返す。
 *
 * 重複排除はnetkeiba馬IDが最優先。IDが無い行（産駒一覧にリンクが無い当歳など）は馬名で見る。
 * 本馬は産駒ロスターにも載っているので、必ずIDで除いてから自前の行を足す
 * （ロスター側の行には測尺が無く、そのまま出すと本馬の測尺が「—」になってしまう）。
 */
export function buildSiblingRoster(input: RosterInput): SiblingRow[] {
  const { self, selfRecruitYear, foals, carrotSiblings, measurements } = input;
  const selfId = netkeibaHorseId(self.netkeibaUrl);
  const rows: SiblingRow[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  const remember = (id: string | null, name: string | null) => {
    if (id) seenIds.add(id);
    if (name) seenNames.add(name);
  };
  const alreadyHave = (id: string | null, name: string | null) =>
    (id != null && seenIds.has(id)) || (id == null && name != null && seenNames.has(name));

  // 本馬。ロスター側の同じ馬は下のループで弾く。
  rows.push({
    name: SELF_ROW_NAME,
    netkeibaUrl: self.netkeibaUrl || null,
    sire: self.sire || null,
    sex: self.sex || null,
    birthDate: self.birthDate || null,
    birthYear: birthYearOf(self.birthDate, selfRecruitYear - 1),
    height: self.height,
    chestGirth: self.chestGirth,
    caretGirth: self.caretGirth,
    weight: self.weight,
    starts: null,
    wins: null,
    totalPrizeManYen: null,
    club: 'carrot',
    ownerRaw: null,
    recruitYear: selfRecruitYear,
    no: self.id,
    isSelf: true,
  });
  remember(selfId, null);

  for (const foal of foals) {
    if (foal.horseId != null && foal.horseId === selfId) continue;
    if (alreadyHave(foal.horseId, foal.name)) continue;
    const m = foal.horseId ? measurements.get(foal.horseId) : undefined;
    rows.push({
      // 実名が付いていれば募集名（「〇〇の25」）よりそちらを出す
      name: m?.name || foal.name || '（未登録）',
      netkeibaUrl: foal.url,
      sire: foal.sire,
      sex: foal.sex,
      birthDate: foal.birthDate,
      birthYear: birthYearOf(foal.birthDate, foal.year),
      height: m?.height ?? null,
      chestGirth: m?.chestGirth ?? null,
      caretGirth: m?.caretGirth ?? null,
      weight: m?.weight ?? null,
      starts: foal.starts,
      wins: foal.wins,
      totalPrizeManYen: foal.starts == null && foal.wins == null ? null : foal.totalPrizeManYen,
      club: foal.club,
      ownerRaw: foal.ownerRaw,
      recruitYear: foal.recruitYear ?? m?.recruitYear ?? null,
      no: foal.isCarrotRecruit ? (m?.no ?? null) : null,
      isSelf: false,
    });
    remember(foal.horseId, m?.name || foal.name);
  }

  // 産駒ロスターに出てこなかったキャロットの兄姉を足す（母のURLが無い年度の救済）
  for (const sibling of carrotSiblings) {
    const id = netkeibaHorseId(sibling.netkeibaUrl);
    if (id != null && id === selfId) continue;
    if (alreadyHave(id, sibling.name)) continue;
    rows.push({
      name: sibling.name,
      netkeibaUrl: sibling.netkeibaUrl,
      sire: sibling.sire,
      sex: sibling.sex,
      birthDate: sibling.birthDate,
      birthYear: birthYearOf(sibling.birthDate, sibling.recruitYear - 1),
      height: sibling.height,
      chestGirth: sibling.chestGirth,
      caretGirth: sibling.caretGirth,
      weight: sibling.weight,
      starts: sibling.starts,
      wins: sibling.wins,
      totalPrizeManYen: sibling.totalPrizeManYen,
      club: 'carrot',
      ownerRaw: null,
      recruitYear: sibling.recruitYear,
      no: sibling.no,
      isSelf: false,
    });
    remember(id, sibling.name);
  }

  // 生年の新しい順。同年（実際には起きないが双子等の保険）は名前で安定させる。
  return rows.sort(
    (a, b) =>
      b.birthYear - a.birthYear ||
      (b.birthDate ?? '').localeCompare(a.birthDate ?? '') ||
      a.name.localeCompare(b.name)
  );
}

/**
 * 「所属」列の表示。キャロット募集馬は募集年と番号まで出す（サイト内の他のページと突き合わせ
 * られるように）。馬主が分からない馬（外国調教馬・早世した産駒など）は「—」。
 *
 * クラブ名は記事より短い呼び方にする（`CLUB_SHORT_JP`）。この表は11列あって横に長く、
 * PC幅でも「サンデーレーシング」を書くと最後の列が画面からはみ出して横スクロールが要る。
 *
 * `club-other` / `club-unknown` は**馬主欄の名前をそのまま出す**。記事側の集計では
 * 「他クラブ」「クラブ（名義変更）」で足りるが、1頭ずつ見るこの表では中身が分からず
 * かえって誤解を招く（例: 馬主欄が「シルク」の馬が「クラブ（名義変更）」になる。
 * `classifyClub()` が拾えていないだけで、実体は東京ホースレーシングやライオンレースホース等の
 * 実在のクラブ）。個人馬主は名前を出さず「個人馬主」のままにする。
 */
export const CLUB_SHORT_JP: Partial<Record<ClubLabel, string>> = {
  sunday: 'サンデー',
  silk: 'シルク',
  'shadai-rh': '社台RH',
  g1: 'G1',
  'tokyo-tc': '東京TC',
  'club-unknown': 'クラブ',
};

export function formatSiblingOwner(
  row: Pick<SiblingRow, 'club' | 'ownerRaw' | 'recruitYear' | 'no'>
): string {
  const label = CLUB_SHORT_JP[row.club] ?? CLUB_JP[row.club] ?? '—';
  if (row.club === 'club-other' || row.club === 'club-unknown') {
    return row.ownerRaw?.trim() || label;
  }
  if (row.club !== 'carrot') return label;
  if (row.recruitYear == null) return label;
  const yy = String(row.recruitYear % 100).padStart(2, '0');
  return row.no ? `${label}${yy} No.${row.no}` : `${label}${yy}`;
}

/** 測尺が1つでも入っている行があるか（＝表に測尺の注記を出す意味があるか）。 */
export function hasAnyMeasurement(rows: readonly SiblingRow[]): boolean {
  return rows.some(
    (r) => r.height != null || r.chestGirth != null || r.caretGirth != null || r.weight != null
  );
}

/** キャロット以外のきょうだい（測尺が空欄になる行）がいるか。 */
export function hasNonCarrotSibling(rows: readonly SiblingRow[]): boolean {
  return rows.some((r) => !r.isSelf && r.club !== 'carrot');
}
