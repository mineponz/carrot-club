/**
 * 出資馬のデータ（`analysis/data/my-horses.json` の素性 ＋ `my-horse-races.json` の成績）を
 * 1つに束ねて `/my-horses/*` から使う。
 *
 * ## ファンド在籍中かどうかが軸になる
 * 地方に移籍した馬（ヴィントシュティレ・レイジングウェイブ）はファンド解散後も走り続けるが、
 * その賞金は出資者に還元されない。回収率も出走一覧も**在籍中と解散後を分けて**扱う。
 * ただし「地方＝解散後」ではない（ロックターミガンは栗東所属のまま交流重賞を走っている）ので、
 * 判定は取得スクリプト側の `inFund` / `transferredToNar` に任せる。
 */
import myHorsesJson from '../../analysis/data/my-horses.json';
import myRacesJson from '../../analysis/data/my-horse-races.json';
import photosJson from '../../analysis/data/my-horse-photos.json';

export type HorseStatus = 'active' | 'retired' | 'transferred';

/**
 * クラブの馬ページ・画像で使われるコード（生年下2桁＋募集番号3桁）。
 *
 * ## 写真は募集年を過ぎると差し替わる
 * 募集中は馬体写真 `bd-<code>.jpg` が置かれるが、募集年が終わると消えて顔写真
 * `kao_<code>.jpg` に入れ替わる（2026-09-09に実URLで確認。25072はbd-のみ200、
 * 24072はkao_のみ200）。さらに古い馬はどちらも404になる。
 * したがって**出資済みの馬に募集時の馬体写真は使えない**。読み込み失敗時に消える形で貼ること。
 */
export function clubFacePhotoUrl(clubId: string): string {
  return `https://carrotclub.net/upfile/${clubId}/kao_${clubId}.jpg`;
}

/**
 * 募集時（1歳夏の測尺時）の馬体写真。`photo_all.asp?id=<clubId>&ct=1` のバックナンバーに
 * 最古の1枚として残っており、**募集年を過ぎた馬でも消えない**（`bd-<code>.jpg` の直リンクは
 * 募集年しか生きないが、こちらは生きている。2026-09-09に9頭すべてで確認）。
 *
 * ファイル名は年ごとに規則が違って計算できないので `my-horse-photos.json` に実名を持つ。
 * 原寸は400KB前後あるため、一覧のように何枚も並べる場所では `thumb` を使う。
 */
export function recruitPhotoUrl(clubId: string, file: string, thumb = false): string {
  return `https://carrotclub.net/upfile/${clubId}/${thumb ? 'mob/' : ''}${file}`;
}

export interface RecruitPhoto {
  clubId: string;
  file: string;
  date: string;
  place: string;
}

export function loadRecruitPhotos(): Record<string, RecruitPhoto> {
  return (photosJson as { photos: Record<string, RecruitPhoto> }).photos;
}

/** 自分で撮った写真。`scripts/import-my-photos.mjs` が `public/my-horses/<slug>/` へ入れる。 */
export interface OwnPhoto {
  file: string;
  /** 出力後の寸法。`<img width height>` に出して読み込み前の高さを確保する。 */
  width: number | null;
  height: number | null;
  /** レース日。ファイル名ではなく成績データ側の日付（ファイル名は誤りうる）。 */
  date: string;
  raceName: string | null;
  grade: string | null;
  venue: string | null;
  finish: number | string | null;
}

export function loadOwnPhotos(): Record<string, OwnPhoto[]> {
  return (photosJson as { own?: Record<string, OwnPhoto[]> }).own ?? {};
}

export function ownPhotoUrl(slug: string, file: string): string {
  return `/my-horses/${slug}/${file}`;
}

export interface MyRace {
  raceId: string | null;
  date: string | null;
  venue: string | null;
  raceNumber: number | null;
  course: string | null;
  raceName: string | null;
  grade: string | null;
  finish: number | string | null;
  popularity: number | null;
  jockey: string | null;
  carriedWeight: number | null;
  /** ファンド在籍中の1走か。false は解散後（移籍先での走り）。 */
  inFund: boolean;
}

export interface MyHorse {
  name: string;
  slug: string;
  horseId: string;
  recruitYear: number;
  no: string;
  sex: string;
  sire: string | null;
  weight: number | null;
  trainer: string | null;
  offeringTotalManYen: number | null;
  /** 口数が実データに無い年度は400口で近似している。 */
  shareCountEstimated?: boolean;
  /** 通常募集ではなく追加募集の馬。1歳夏の測尺で並べる物差しが当てはまらない。 */
  supplementary: boolean;
  /**
   * 追加募集馬の測尺（体高・胸囲・管囲）。カタログではなくクラブの近況の初回コメントに載る。
   * 通常募集の1歳8月ではなく**2歳春**の計測なので、`measuredAt` とセットで扱い、
   * 通常募集の測尺と同じ物差しで比べない。
   */
  height?: number;
  chestGirth?: number;
  caretGirth?: number;
  measuredAt?: string;
  status: HorseStatus;
  /** 命名権を行使して名前を付けた馬。`/about/` の所有馬リストで注記する。 */
  namedByOwner?: boolean;
  /** クラブ側のコード（生年下2桁＋募集番号3桁）。写真URLに使う。 */
  clubId: string;
  /** 引退日／ファンド解散の時期。 */
  fundEndedAt: string | null;
  retiredReason: string | null;
  record: string | null;
  mainWins: string | null;
  chuoPrizeManYen: number;
  chihoPrizeManYen: number;
  totalPrizeManYen: number;
  /** 在籍中に稼いだぶん。回収率の分子。 */
  ownerPrizeManYen: number;
  recoveryRatePct: number | null;
  transferredToNar: boolean;
  narDebutDate: string | null;
  races: MyRace[];
}

const races = (myRacesJson as { results: Record<string, unknown>[] }).results;

export const MY_HORSES_FETCHED_AT: string = (myRacesJson as { fetchedAt: string }).fetchedAt;

export function loadMyHorses(): MyHorse[] {
  const byName = new Map(races.map((r) => [r.name as string, r]));
  return (myHorsesJson as Record<string, unknown>[]).map((h) => ({
    ...(h as object),
    ...(byName.get(h.name as string) as object),
  })) as MyHorse[];
}

export const STATUS_LABEL: Record<HorseStatus, string> = {
  active: '現役',
  retired: '引退',
  transferred: '地方移籍',
};

/**
 * 在籍中の全出走を新しい順に。表に馬名を出すため馬の情報も添える。
 * 解散後（移籍先）の走りは出資者と関係が切れているので**含めない**。
 */
export function inFundRaces(horses: MyHorse[]): { horse: MyHorse; race: MyRace }[] {
  return horses
    .flatMap((h) => h.races.map((race) => ({ horse: h, race })))
    .filter((r) => r.race.date && r.race.inFund)
    .sort((a, b) => (a.race.date! < b.race.date! ? 1 : -1));
}

export function summarize(horses: MyHorse[]) {
  const inFund = horses.flatMap((h) => h.races.filter((r) => r.inFund));
  const wins = inFund.filter((r) => r.finish === 1).length;
  const offering = horses.reduce((s, h) => s + (h.offeringTotalManYen ?? 0), 0);
  const prize = horses.reduce((s, h) => s + h.ownerPrizeManYen, 0);
  return {
    horses: horses.length,
    active: horses.filter((h) => h.status === 'active').length,
    starts: inFund.length,
    wins,
    offering,
    prize,
    recoveryPct: offering ? Math.round((1000 * prize) / offering) / 10 : null,
  };
}
