import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sireLineOf, SIRE_LINES, CLASSIFIED_SIRE_COUNT } from './sire-line.ts';

test('sireLineOf: 主要3父系を引ける', () => {
  assert.equal(sireLineOf('ディープインパクト'), 'サンデー系');
  assert.equal(sireLineOf('ロードカナロア'), 'キングマンボ系');
  assert.equal(sireLineOf('エピファネイア'), 'ロベルト系');
  assert.equal(sireLineOf('モーリス'), 'ロベルト系');
});

test('sireLineOf: 父の父で分類する（産駒名ではなくその馬の父系）', () => {
  // スワーヴリチャードは父ハーツクライなのでサンデー系。名前からは判別できない例。
  assert.equal(sireLineOf('スワーヴリチャード'), 'サンデー系');
  // サートゥルナーリアは父ロードカナロアなのでキングマンボ系。
  assert.equal(sireLineOf('サートゥルナーリア'), 'キングマンボ系');
});

test('sireLineOf: 表に無い父・父不明は「その他」に落とす', () => {
  assert.equal(sireLineOf('ハービンジャー'), 'その他');
  assert.equal(sireLineOf('存在しない種牡馬'), 'その他');
  assert.equal(sireLineOf(null), 'その他');
  assert.equal(sireLineOf(undefined), 'その他');
});

test('SIRE_LINES: 4分類がそろっている', () => {
  assert.deepEqual(SIRE_LINES, ['サンデー系', 'キングマンボ系', 'ロベルト系', 'その他']);
  assert.ok(CLASSIFIED_SIRE_COUNT > 50);
});
