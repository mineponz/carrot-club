import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryVoteRows, sortEntryVoteRows, type EntryVoteRow } from './entry-votes.ts';
import type { EntryVoteSnapshot } from '../data/entryVotes2026.ts';
import type { Horse } from './horses.ts';

function makeHorse(overrides: Partial<Horse> & Pick<Horse, 'id'>): Horse {
  return {
    name: `テスト号${overrides.id}`,
    sex: '牡',
    netkeibaUrl: 'https://example.com/',
    sire: 'テストサイアー',
    broodmareSire: 'テスト母父',
    damAge: 8,
    damParity: 3,
    birthDate: '2024-03-01',
    stable: 'テスト厩舎',
    pricePerShare: 20,
    height: 158,
    chestGirth: 178,
    caretGirth: 20,
    weight: 440,
    sibling: '',
    damPriority: false,
    surgery: '',
    xSearchUrl: 'https://x.com/search',
    damUrl: '',
    ...overrides,
  };
}

const snapshots: EntryVoteSnapshot[] = [
  {
    asOf: '9/3',
    label: '第1回中間発表',
    byId: {
      '1': { total: 420, topPriority: 100, damPriority: 58 },
      '2': { total: 300, topPriority: null, damPriority: null },
    },
  },
  {
    asOf: '9/4',
    label: '第2回中間発表',
    byId: { '1': { total: 510, topPriority: 110, damPriority: 60 } },
  },
];

test('entryVoteRows: cells は snapshots と同じ長さ・同じ順、未発表回は null', () => {
  const horses = [makeHorse({ id: '1' }), makeHorse({ id: '2' }), makeHorse({ id: '3' })];
  const rows = entryVoteRows(horses, snapshots);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].cells, [
    { total: 420, topPriority: 100, damPriority: 58 },
    { total: 510, topPriority: 110, damPriority: 60 },
  ]);
  assert.deepEqual(rows[1].cells, [{ total: 300, topPriority: null, damPriority: null }, null]);
  assert.deepEqual(rows[2].cells, [null, null]);
});

test('entryVoteRows: latestTotal は末尾から遡って最初に見つかった total', () => {
  const horses = [makeHorse({ id: '1' }), makeHorse({ id: '2' }), makeHorse({ id: '3' })];
  const rows = entryVoteRows(horses, snapshots);
  assert.equal(rows[0].latestTotal, 510); // 2回目に掲載
  assert.equal(rows[1].latestTotal, 300); // 1回目のみ掲載
  assert.equal(rows[2].latestTotal, null); // 全回未発表
});

test('entryVoteRows: 空発表（全 byId が空）なら全行 cells が null・latestTotal も null', () => {
  const empty: EntryVoteSnapshot[] = [
    { asOf: '9/3', label: '第1回中間発表', byId: {} },
    { asOf: '9/4', label: '第2回中間発表', byId: {} },
  ];
  const horses = [makeHorse({ id: '1' }), makeHorse({ id: '2' })];
  const rows = entryVoteRows(horses, empty);
  for (const row of rows) {
    assert.deepEqual(row.cells, [null, null]);
    assert.equal(row.latestTotal, null);
  }
});

const rows: EntryVoteRow[] = [
  {
    id: '2',
    name: 'いろは号',
    sire: 'キズナ',
    sex: '牝',
    cells: [
      { total: 300, topPriority: null, damPriority: null },
      { total: 280, topPriority: null, damPriority: null },
    ],
    latestTotal: 280,
  },
  {
    id: '1',
    name: 'あお号',
    sire: 'イクイノックス',
    sex: '牡',
    cells: [
      { total: 420, topPriority: 100, damPriority: 58 },
      { total: 510, topPriority: 110, damPriority: 60 },
    ],
    latestTotal: 510,
  },
  {
    id: '10',
    name: 'うめ号',
    sire: 'エピファネイア',
    sex: '牡',
    cells: [null, null],
    latestTotal: null,
  },
];

test('sortEntryVoteRows: latestTotal 降順（初期表示）。null は末尾', () => {
  const desc = sortEntryVoteRows(rows, 'latestTotal', 'desc');
  assert.deepEqual(desc.map((r) => r.id), ['1', '2', '10']);
});

test('sortEntryVoteRows: latestTotal 昇順でも null は末尾', () => {
  const asc = sortEntryVoteRows(rows, 'latestTotal', 'asc');
  assert.deepEqual(asc.map((r) => r.id), ['2', '1', '10']);
});

test('sortEntryVoteRows: total:${i} でその回の全体票数で並べ替え', () => {
  const byRound0Desc = sortEntryVoteRows(rows, 'total:0', 'desc');
  assert.deepEqual(byRound0Desc.map((r) => r.id), ['1', '2', '10']);
  const byRound1Asc = sortEntryVoteRows(rows, 'total:1', 'asc');
  assert.deepEqual(byRound1Asc.map((r) => r.id), ['2', '1', '10']);
});

test('sortEntryVoteRows: top:${i} でその回の最優先枠票数で並べ替え', () => {
  // round0: id=1 topPriority=100, id=2 は null（→末尾）
  const byRound0Desc = sortEntryVoteRows(rows, 'top:0', 'desc');
  assert.deepEqual(byRound0Desc.map((r) => r.id), ['1', '2', '10']);
  // round1: id=1 topPriority=110 のみ実値。id=2・id=10 は null（→末尾、元の相対順を維持）
  const byRound1Asc = sortEntryVoteRows(rows, 'top:1', 'asc');
  assert.deepEqual(byRound1Asc.map((r) => r.id), ['1', '2', '10']);
});

test('sortEntryVoteRows: その回の最優先が未発表（topPriority が null）の行は末尾', () => {
  const partial: EntryVoteRow[] = [
    { id: '1', name: 'a', sire: 'x', sex: '牡', cells: [{ total: 100, topPriority: 50, damPriority: null }], latestTotal: 100 },
    { id: '2', name: 'b', sire: 'y', sex: '牡', cells: [{ total: 200, topPriority: null, damPriority: null }], latestTotal: 200 },
  ];
  assert.deepEqual(sortEntryVoteRows(partial, 'top:0', 'asc').map((r) => r.id), ['1', '2']);
  assert.deepEqual(sortEntryVoteRows(partial, 'top:0', 'desc').map((r) => r.id), ['1', '2']);
});

test('sortEntryVoteRows: その回が未発表（cells[i] が null）の行は末尾', () => {
  const partial: EntryVoteRow[] = [
    { id: '1', name: 'a', sire: 'x', sex: '牡', cells: [{ total: 100, topPriority: null, damPriority: null }], latestTotal: 100 },
    { id: '2', name: 'b', sire: 'y', sex: '牡', cells: [null], latestTotal: null },
  ];
  assert.deepEqual(sortEntryVoteRows(partial, 'total:0', 'asc').map((r) => r.id), ['1', '2']);
  assert.deepEqual(sortEntryVoteRows(partial, 'total:0', 'desc').map((r) => r.id), ['1', '2']);
});

test('sortEntryVoteRows: id は数値比較（文字列比較なら 10 < 2 になる）', () => {
  const asc = sortEntryVoteRows(rows, 'id', 'asc');
  assert.deepEqual(asc.map((r) => r.id), ['1', '2', '10']);
});

test('sortEntryVoteRows: 馬名は日本語の並び順で比較する', () => {
  const asc = sortEntryVoteRows(rows, 'name', 'asc');
  assert.deepEqual(asc.map((r) => r.name), ['あお号', 'いろは号', 'うめ号']);
});

test('sortEntryVoteRows: 父も日本語の並び順で比較する', () => {
  const asc = sortEntryVoteRows(rows, 'sire', 'asc');
  assert.deepEqual(asc.map((r) => r.sire), ['イクイノックス', 'エピファネイア', 'キズナ']);
});

test('sortEntryVoteRows: 元の配列を変更しない', () => {
  const copy = [...rows];
  sortEntryVoteRows(rows, 'latestTotal', 'desc');
  assert.deepEqual(rows, copy);
});
