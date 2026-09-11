/**
 * 1.5次募集（1次募集で満口にならなかった馬）の判定用の純粋関数。
 *
 * データの実体は `analysis/data/first-offering-leftovers.json`
 * （年度→1.5次募集対象になった募集番号一覧＋出所URL。出所はクラブ会員向けニュース
 * 「◯年度第1次募集最終集計結果」）。JSON importはVite（`.astro`側）でしか型付きで解決できず
 * （`analysis-data.ts` と同じ制約）、`node --test` では `with { type: 'json' }` が無いと読めない。
 * そこでこのファイルはJSONを直接importせず、**呼び出し側がJSONを渡す**純関数だけを置く
 * （`dam-siblings.ts` / `sibling-recruits.ts` と同じ形）。これで `node --test` から検証できる。
 */

export interface LeftoverYearEntry {
  count: number;
  nos: string[];
}

export interface FirstOfferingLeftoversFile {
  asOf: string;
  sourceByYear: Record<string, string>;
  byYear: Record<string, LeftoverYearEntry>;
}

/** データが対象にしている募集年度（昇順）。 */
export function leftoverYears(file: FirstOfferingLeftoversFile): number[] {
  return Object.keys(file.byYear)
    .map(Number)
    .sort((a, b) => a - b);
}

/** その年度の1.5次募集対象馬の募集番号一覧（募集番号順ではなく発表順のまま）。 */
export function leftoverNosOf(file: FirstOfferingLeftoversFile, recruitYear: number): string[] {
  return file.byYear[String(recruitYear)]?.nos ?? [];
}

/** その年度の1.5次募集対象頭数。 */
export function leftoverCountOf(file: FirstOfferingLeftoversFile, recruitYear: number): number {
  return file.byYear[String(recruitYear)]?.count ?? 0;
}

/** その年度の出所URL（クラブ会員向けニュース）。無ければnull。 */
export function leftoverSourceUrlOf(
  file: FirstOfferingLeftoversFile,
  recruitYear: number
): string | null {
  return file.sourceByYear[String(recruitYear)] ?? null;
}

/** 指定の募集年度・募集番号が1.5次募集対象（＝1次募集で満口にならなかった）か。 */
export function isLeftover(
  file: FirstOfferingLeftoversFile,
  recruitYear: number,
  no: string
): boolean {
  return leftoverNosOf(file, recruitYear).includes(no);
}

export interface LeftoverValidationError {
  year: number;
  message: string;
}

/**
 * JSONの整合性を検算する。
 * - `count` と `nos.length` が一致するか（手入力の転記ミス検知）。
 * - `nos` の各募集番号が、その年度の実在する募集番号一覧（`knownNosByYear`）に含まれるか
 *   （クラブ発表後に募集取り下げになった番号がリストに紛れ込んでいないかの検知）。
 *
 * `knownNosByYear` は呼び出し側（`.astro`）が用意する。2022〜2025年度は `recruits.json`、
 * 2026年度は `recruits.json` に無い（2026年募集はまだ載っていない）ため `horses2026.ts` の
 * `id` 一覧を使う。
 */
export function validateLeftoverNos(
  file: FirstOfferingLeftoversFile,
  knownNosByYear: ReadonlyMap<number, ReadonlySet<string>>
): LeftoverValidationError[] {
  const errors: LeftoverValidationError[] = [];
  for (const year of leftoverYears(file)) {
    const entry = file.byYear[String(year)];
    if (entry.count !== entry.nos.length) {
      errors.push({
        year,
        message: `count(${entry.count})とnos.length(${entry.nos.length})が一致しない`,
      });
    }
    const known = knownNosByYear.get(year);
    if (!known) {
      errors.push({ year, message: '既知の募集番号一覧が渡されていない' });
      continue;
    }
    const unknownNos = entry.nos.filter((no) => !known.has(no));
    if (unknownNos.length > 0) {
      errors.push({
        year,
        message: `募集馬に存在しない番号が混入している（募集取り下げ番号の混入の可能性）: ${unknownNos.join(',')}`,
      });
    }
  }
  return errors;
}

/** `validateLeftoverNos` の結果が空でなければ例外を投げる。ビルド時アサーション用。 */
export function assertLeftoverNosValid(
  file: FirstOfferingLeftoversFile,
  knownNosByYear: ReadonlyMap<number, ReadonlySet<string>>
): void {
  const errors = validateLeftoverNos(file, knownNosByYear);
  if (errors.length === 0) return;
  throw new Error(
    'first-offering-leftovers.jsonの整合性チェックに失敗:\n' +
      errors.map((e) => `- ${e.year}年度: ${e.message}`).join('\n')
  );
}
