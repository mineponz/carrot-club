import { test } from 'node:test';
import assert from 'node:assert/strict';
import { damNameOf, formatBirthDateLong, horseDetailDescription, horseDetailTitle } from './horse-meta.ts';
import type { Horse } from './horses.ts';

const horse: Horse = {
  id: '1',
  name: 'ブランノワールの25',
  sex: '牡',
  netkeibaUrl: 'https://db.netkeiba.com/horse/2025107257/',
  damUrl: 'https://db.netkeiba.com/horse/2016104839/',
  sire: 'イクイノックス',
  broodmareSire: 'ロードカナロア',
  damAge: 9,
  birthDate: '2025-04-30',
  stable: '武井亮',
  pricePerShare: 20,
  height: 147,
  chestGirth: 169,
  caretGirth: 20.6,
  weight: 420,
  sibling: 'ブランヴァンダイク',
  damPriority: false,
  surgery: '右飛節OCD除去手術（2026/5/26）',
  xSearchUrl: 'https://x.com/search?q=ブランノワール&src=typed_query',
};

test('damNameOf: 「〜の25」から母馬名を取り出す', () => {
  assert.equal(damNameOf(horse), 'ブランノワール');
});

test('damNameOf: 2025年募集の「〜の2024」表記にも対応する', () => {
  assert.equal(damNameOf({ ...horse, name: 'ピンクアリエスの2024' }), 'ピンクアリエス');
});

test('damNameOf: 外国産馬の「外）」接頭辞を落とす', () => {
  assert.equal(damNameOf({ ...horse, name: '外）ビディデュークの25' }), 'ビディデューク');
});

test('formatBirthDateLong: ISO日付を読み下し表記にする', () => {
  assert.equal(formatBirthDateLong('2025-04-30'), '2025年4月30日');
});

test('horseDetailTitle: 馬名と血統を含む（ページごとに一意になる要素）', () => {
  const title = horseDetailTitle(horse);
  assert.match(title, /ブランノワールの25/);
  assert.match(title, /父イクイノックス/);
  assert.match(title, /母ブランノワール/);
  assert.match(title, /母父ロードカナロア/);
});

test('horseDetailDescription: 募集年・番号・測尺などその馬固有の値を含む', () => {
  const description = horseDetailDescription(horse, 2026);
  assert.match(description, /2026年募集馬/);
  assert.match(description, /募集番号1/);
  assert.match(description, /母齢9/);
  assert.match(description, /一口20万円/);
  assert.match(description, /馬体重420kg/);
  assert.match(description, /兄姉にブランヴァンダイク/);
  assert.match(description, /手術・既往の記載あり/);
});

test('horseDetailDescription: 兄姉・母優先・手術が無ければその文は出さない', () => {
  const description = horseDetailDescription(
    { ...horse, sibling: '', damPriority: false, surgery: '' },
    2026,
  );
  assert.ok(!description.includes('兄姉に'));
  assert.ok(!description.includes('母優先の対象馬'));
  assert.ok(!description.includes('手術・既往の記載あり'));
});

test('horseDetailDescription: 別の馬なら別の文言になる（重複コンテンツ対策）', () => {
  const other: Horse = { ...horse, id: '2', name: 'カリプソⅡの25', sire: 'キズナ', weight: 468 };
  assert.notEqual(horseDetailDescription(horse, 2026), horseDetailDescription(other, 2026));
  assert.notEqual(horseDetailTitle(horse), horseDetailTitle(other));
});
