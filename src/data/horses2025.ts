/**
 * 2025年募集馬の客観データ。
 *
 * ※現状はプレースホルダ（ダミー3頭）。本人からCSV（血統・測尺などの客観列。
 * 個人評価・メモ・消マークは含まない）を受け取り次第、実データに差し替える。
 * 差し替え手順: vault `1-projects/carrot-club/tasks/20260810-build-phase1.md` 手順1参照。
 */
import type { Horse } from '../lib/horses.ts';

export const horses2025: Horse[] = [
  {
    id: '2025-001',
    name: '（ダミー）サンプル号A',
    sire: 'サンプルサイアーA',
    broodmareSire: 'サンプル母父A',
    birthDate: '2024-02-14',
    height: 158,
    chestGirth: 178,
    caretGirth: 19.5,
    weight: 420,
    damAge: 8,
    siblingInfo: '（ダミーデータ）',
  },
  {
    id: '2025-002',
    name: '（ダミー）サンプル号B',
    sire: 'サンプルサイアーB',
    broodmareSire: 'サンプル母父B',
    birthDate: '2024-01-20',
    height: 162,
    chestGirth: 182,
    caretGirth: 20.1,
    weight: 450,
    damAge: 5,
    siblingInfo: '（ダミーデータ）',
  },
  {
    id: '2025-003',
    name: '（ダミー）サンプル号C',
    sire: 'サンプルサイアーA',
    broodmareSire: 'サンプル母父C',
    birthDate: '2024-03-30',
    height: 155,
    chestGirth: 175,
    caretGirth: 19.0,
    weight: 400,
    damAge: 11,
    siblingInfo: '（ダミーデータ）',
  },
];
