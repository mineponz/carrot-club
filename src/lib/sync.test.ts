import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVALUATIONS_RESTORED_EVENT,
  maskAnonId,
  normalizeAnonIdInput,
  restoreResultMessage,
  uploadResultMessage,
} from './sync.ts';
import { isValidAnonId } from './evaluation-api.ts';

const ID = '2f8a1c3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';

test('normalizeAnonIdInput: コピペで混ざる空白・改行・引用符・大文字を落とす', () => {
  for (const raw of [` ${ID} `, `\n${ID}\n`, `「${ID}」`, `"${ID}"`, ID.toUpperCase(), '2f8a1c3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b　']) {
    assert.equal(normalizeAnonIdInput(raw), ID, `整形できていない: ${JSON.stringify(raw)}`);
    // 整形した結果はそのままサーバーの検証を通る
    assert.equal(isValidAnonId(normalizeAnonIdInput(raw)), true);
  }
});

test('normalizeAnonIdInput: 別物のIDを勝手に有効化しない', () => {
  assert.equal(isValidAnonId(normalizeAnonIdInput('member-12345')), false);
  assert.equal(isValidAnonId(normalizeAnonIdInput('')), false);
});

test('maskAnonId: 先頭と末尾だけ残し、そのままでは使えない形にする', () => {
  const masked = maskAnonId(ID);
  assert.equal(masked.startsWith('2f8a1c3e'), true);
  assert.equal(masked.endsWith('4a5b'), true);
  // 伏せ字が本物として通ってしまうと「隠したつもりで使える」ことになる
  assert.equal(isValidAnonId(masked), false);
  assert.equal(masked.includes('4b5d'), false);
});

test('maskAnonId: 不正なIDは何も出さない', () => {
  assert.equal(maskAnonId('not-a-uuid'), '');
  assert.equal(maskAnonId(''), '');
});

test('uploadResultMessage: 0件・成功・一部失敗・全滅で言うことを変える', () => {
  assert.match(uploadResultMessage(0, 0), /まだ評価が入っていません/);
  assert.match(uploadResultMessage(12, 0), /12頭/);
  assert.match(uploadResultMessage(0, 3), /失敗/);
  assert.match(uploadResultMessage(10, 2), /2頭/);
});

test('restoreResultMessage: 0件は失敗ではなく「まだ預けられていない」と伝える', () => {
  assert.match(restoreResultMessage(0), /預けられていません/);
  assert.match(restoreResultMessage(5), /5頭/);
});

test('EVALUATIONS_RESTORED_EVENT: 他のイベント名とぶつからないよう接頭辞を付ける', () => {
  assert.equal(EVALUATIONS_RESTORED_EVENT.startsWith('carrot-club:'), true);
});
