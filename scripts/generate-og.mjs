/**
 * OGP画像生成スクリプト（年に数回しか動かさない手動ツール）。
 *
 * `scripts/og-card.html` を Playwright の chromium で開き、1200x630 のスクリーンショットを
 * `public/og.png` に書き出す。
 *
 * ## playwright はこのリポジトリの依存に入れない
 * 画像を作り直すのは募集頭数やサイト名が変わったときだけで、本番ビルドには一切関係しない。
 * そのために 300MB 級のブラウザ依存を package.json に常駐させたくないので、
 * **実行する人が別途用意した playwright を借りて動かす**方針にしている。
 * このスクリプトは以下の順に playwright を探し、見つからなければ手順を出して終了する。
 *   1. 通常の import（このリポジトリに一時的に入れた場合 / NODE_PATH 指定）
 *   2. `npm root -g` 配下（グローバルインストール）
 *
 * ## 実行コマンド例
 * グローバルに入れる場合（推奨。リポジトリを汚さない）:
 *   npm i -g playwright
 *   npx playwright install chromium
 *   node scripts/generate-og.mjs
 *
 * 一時的にこのリポジトリへ入れる場合（終わったら必ず消す。package.json をコミットしない）:
 *   npm i -D --no-save playwright && npx playwright install chromium
 *   node scripts/generate-og.mjs
 *
 * 任意の場所の playwright を使う場合:
 *   NODE_PATH=/path/to/node_modules node scripts/generate-og.mjs
 *
 * 生成した `public/og.png` はコミットする（ビルド成果物ではなく静的アセットの一部）。
 * 併せて BaseLayout.astro の og:image / twitter:image と twitter:card=summary_large_image を確認すること。
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WIDTH = 1200;
const HEIGHT = 630;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const htmlPath = join(scriptDir, 'og-card.html');
const outDir = join(repoRoot, 'public');
const outPath = join(outDir, 'og.png');

const INSTALL_HINT = `
playwright が見つかりませんでした。このリポジトリの依存には入れていないため、別途用意して実行してください。

  npm i -g playwright
  npx playwright install chromium
  node scripts/generate-og.mjs

（一時的にこのリポジトリへ入れる場合は \`npm i -D --no-save playwright\` を使い、package.json を書き換えないこと）
`;

/** playwright / playwright-core を順に探して chromium を返す。 */
async function loadChromium() {
  const names = ['playwright', 'playwright-core'];
  const tried = [];

  for (const name of names) {
    try {
      const mod = await import(name);
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) {
        console.log(`[og] playwright を読み込みました: ${name}`);
        return chromium;
      }
      tried.push(`${name}: chromium が見つからない`);
    } catch (error) {
      tried.push(`${name}: ${error.code ?? error.name}`);
    }
  }

  // グローバルインストールを探す。`npm root -g` はグローバルの node_modules パスを返す。
  let globalRoot = null;
  try {
    globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  } catch (error) {
    tried.push(`npm root -g の実行に失敗: ${error.message}`);
  }

  if (globalRoot) {
    console.log(`[og] グローバルの node_modules を探索: ${globalRoot}`);
    const require = createRequire(import.meta.url);
    for (const name of names) {
      try {
        // playwright は CJS なので require 解決 → ファイルURL として import する
        const entry = require.resolve(name, { paths: [globalRoot] });
        const mod = await import(pathToFileURL(entry).href);
        const chromium = mod.chromium ?? mod.default?.chromium;
        if (chromium) {
          console.log(`[og] playwright を読み込みました: ${entry}`);
          return chromium;
        }
        tried.push(`${entry}: chromium が見つからない`);
      } catch (error) {
        tried.push(`${globalRoot}/${name}: ${error.code ?? error.name}`);
      }
    }
  }

  console.error('[og] 読み込みに失敗した候補:');
  for (const line of tried) console.error(`  - ${line}`);
  console.error(INSTALL_HINT);
  process.exit(1);
}

async function main() {
  if (!existsSync(htmlPath)) {
    console.error(`[og] 元HTMLが見つかりません: ${htmlPath}`);
    process.exit(1);
  }

  const chromium = await loadChromium();

  console.log(`[og] 元HTML: ${htmlPath}`);
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    console.error(`[og] chromium の起動に失敗しました: ${error.message}`);
    console.error('[og] ブラウザ本体が未取得の可能性があります。`npx playwright install chromium` を実行してください。');
    process.exit(1);
  }

  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      // 1 にしておくと出力がちょうど 1200x630 px になる（Xの推奨サイズ）
      deviceScaleFactor: 1,
      colorScheme: 'light',
    });

    // コンソールエラーは握り潰さずそのまま出す
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error(`[og][page] ${msg.text()}`);
    });
    page.on('pageerror', (error) => console.error(`[og][page] ${error.message}`));

    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    // FontFaceSet はそのまま返すとシリアライズできないので boolean に落とす
    await page.evaluate(() => document.fonts.ready.then(() => true));

    // 文字が枠からはみ出していないか（フォント差で行数が増えると起きる）を検知する
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    if (overflow.scrollWidth > WIDTH || overflow.scrollHeight > HEIGHT) {
      console.warn(
        `[og] 警告: 内容が ${WIDTH}x${HEIGHT} を超えています ` +
          `(${overflow.scrollWidth}x${overflow.scrollHeight})。端が切れます。og-card.html の文字サイズを見直してください。`,
      );
    }

    mkdirSync(outDir, { recursive: true });
    await page.screenshot({
      path: outPath,
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    });

    const bytes = statSync(outPath).size;
    console.log(`[og] 書き出しました: ${outPath} (${WIDTH}x${HEIGHT}, ${(bytes / 1024).toFixed(1)} KB)`);
  } finally {
    await browser.close();
  }
}

await main();
