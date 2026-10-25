/**
 * netkeibaの「主な勝鞍」欄（race-results.jsonの`gradeWins`）は、HTMLコメントに隠れた
 * 2つ目以降の勝鞍がtitle属性の引用符崩れ（`title=XXX""`のように開き引用符が無い）で
 * 正規表現から漏れることがある（2026-10-23発見。例: フォーヴィスム「兵庫ゴールドトロフィ
 * (JpnIII)」が通算成績上は重賞勝ちなのに`gradeWins`が空だった）。
 * この関数は`/horse/result/<id>/`のキャッシュ済み全戦績テーブルを直接スキャンし、
 * 着順1着かつレース名にGI/GII/GIII/JpnI/JpnII/JpnIII表記（ローマ数字、成績テーブル側の
 * 表記）を含む行を全て集める。`gradeWins`より完全。
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const JRA_TRACKS = ['札幌', '函館', '福島', '新潟', '東京', '中山', '中京', '京都', '阪神', '小倉'];
export const NAR_TRACKS = ['名古屋', '大井', '園田', '川崎', '高知', '佐賀', '笠松', '船橋', '盛岡', '水沢', '浦和', '金沢', '門別', '姫路'];

export function classifyTrack(track) {
  if (JRA_TRACKS.some((t) => track.includes(t))) return 'JRA';
  if (NAR_TRACKS.some((t) => track.includes(t))) return 'NAR';
  return '海外';
}

const GRADE_ROMAN_RE = /\((GI{1,3}|JpnI{1,3})\)/;

function cacheHtml(root, url) {
  const hash = createHash('sha1').update(url).digest('hex');
  const p = join(root, '.cache', 'netkeiba', `${hash}.html`);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

/** キャッシュ済み成績ページから、そのホースの重賞勝ち（完全版）を返す。キャッシュ無しはnull。 */
export function fullGradeWins(root, netkeibaUrl) {
  const idM = netkeibaUrl.match(/horse\/([0-9a-z]+)/);
  if (!idM) return null;
  const html = cacheHtml(root, `https://db.netkeiba.com/horse/result/${idM[1]}/`);
  if (!html) return null;
  const tbodyM = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbodyM) return [];
  const trs = tbodyM[1].split('<tr>').slice(1).map((s) => '<tr>' + s);
  const graded = [];
  for (const tr of trs) {
    const tds = [];
    const re = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let m;
    while ((m = re.exec(tr))) tds.push(m[1]);
    if (tds.length < 12) continue;
    const track = tds[1].replace(/<[^>]+>/g, '').trim();
    const dateM = tds[0].match(/(\d{4})\/(\d{2})\/(\d{2})/);
    const raceNameM = tds[4].match(/title="([^"]+)"/);
    const raceName = raceNameM ? raceNameM[1] : '';
    const rankText = tds[11].replace(/<[^>]+>/g, '').trim();
    const rank = /^\d+$/.test(rankText) ? Number(rankText) : null;
    if (rank === 1 && GRADE_ROMAN_RE.test(raceName)) {
      graded.push({
        raceName,
        track,
        date: dateM ? `${dateM[1]}-${dateM[2]}-${dateM[3]}` : null,
        cls: classifyTrack(track),
      });
    }
  }
  return graded;
}
