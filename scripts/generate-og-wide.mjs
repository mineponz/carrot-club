/**
 * OGP画像（1200x630）の組み直しスクリプト（手動ツール）。
 *
 * 本人が用意した正方形のデザイン画像 `scripts/og-source.webp`（1254x1254）から、
 * にんじん・「非公式」スタンプ・見出し文字・アイコン列・注意書きを切り出し、
 * Xのカード比率（1200x630）に並べ直して `public/og.png` を書き出す。
 *
 * ## なぜ切り出して組み直すのか
 * 元画像は正方形で、`twitter:card=summary_large_image` に渡すとXが上下を切る
 * （見出しと注意書きが欠ける）。かといって文字を打ち直すと環境ごとのフォントで
 * 字形が変わるため、**元画像のピクセルをそのまま使って配置だけ変える**方針にしている。
 *
 * ## 座標の直し方
 * `PARTS` の x/y/w/h は元画像(1254x1254)上の切り出し範囲。デザインを差し替えたら
 * ここを測り直す。outW / outH は出力サイズで、指定した方に合わせて等倍で拡大縮小する。
 * 全体の高さが630を超えると下が欠けるので、変更したら必ず出力を目視すること。
 *
 * ## playwright はこのリポジトリの依存に入れない
 * generate-og.mjs と同じ方針。実行する人が用意したものを借りる。
 *   npm i -g playwright && npx playwright install chromium
 *   node scripts/generate-og-wide.mjs
 * ブラウザ本体が手元にある場合は実行ファイルを直接指定できる:
 *   CHROMIUM_EXECUTABLE_PATH=/path/to/chrome node scripts/generate-og-wide.mjs
 *
 * 生成した `public/og-v2.png` はコミットする（ビルド成果物ではなく静的アセットの一部）。
 * 画像サイズを変えたときは BaseLayout.astro の og:image:width / height も直すこと。
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WIDTH = 1200;
const HEIGHT = 630;
/** 元画像の一辺（正方形前提） */
const SRC_SIZE = 1254;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');
const srcPath = join(scriptDir, 'og-source.webp');
// 出力ファイル名。作り替えたら v3, v4 … と上げて BaseLayout.astro の参照も直す
// （SNSは画像URL単位でキャッシュするので、同名のまま差し替えると古い画像が出続ける）
const outPath = join(repoRoot, 'public', 'og-v2.png');

/** 元画像(1254x1254)から切り出す部品。outW / outH のどちらかで拡大率を決める */
const PARTS = {
  carrot: { x: 155, y: 340, w: 190, h: 275, outH: 230 },
  stamp: { x: 795, y: 478, w: 330, h: 134, outH: 44 },
  club: { x: 112, y: 195, w: 380, h: 92, outH: 58 },
  // 右端の「です」と装飾線まで入らないよう幅を550に留める
  tool: { x: 485, y: 155, w: 550, h: 165, outH: 140 },
  icons: { x: 55, y: 700, w: 1145, h: 295, outW: 820 },
  notice: { x: 140, y: 1040, w: 980, h: 130, outW: 340 },
};

const INSTALL_HINT = `
playwright が見つかりませんでした。このリポジトリの依存には入れていないため、別途用意して実行してください。

  npm i -g playwright
  npx playwright install chromium
  node scripts/generate-og-wide.mjs
`;

/** playwright / playwright-core を順に探して chromium を返す。 */
async function loadChromium() {
  const names = ['playwright', 'playwright-core'];
  const tried = [];

  for (const name of names) {
    try {
      const mod = await import(name);
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) return chromium;
      tried.push(`${name}: chromium が見つからない`);
    } catch (error) {
      tried.push(`${name}: ${error.code ?? error.name}`);
    }
  }

  let globalRoot = null;
  try {
    globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  } catch (error) {
    tried.push(`npm root -g の実行に失敗: ${error.message}`);
  }

  if (globalRoot) {
    const require = createRequire(import.meta.url);
    for (const name of names) {
      try {
        const entry = require.resolve(name, { paths: [globalRoot] });
        const mod = await import(pathToFileURL(entry).href);
        const chromium = mod.chromium ?? mod.default?.chromium;
        if (chromium) return chromium;
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

/** 部品1つぶんの div を組み立てる（背景画像を負のオフセットでずらして切り出す） */
function partHtml(name) {
  const p = PARTS[name];
  const scale = p.outW ? p.outW / p.w : p.outH / p.h;
  const px = (v) => `${Math.round(v * scale)}px`;
  return `<div class="crop" style="width:${px(p.w)};height:${px(p.h)};
    background-size:${px(SRC_SIZE)} ${px(SRC_SIZE)};
    background-position:-${px(p.x)} -${px(p.y)}"></div>`;
}

function cardHtml(dataUri) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8" /><style>
    html, body { margin: 0; padding: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
    /* 背景色は元デザインの地色に合わせている */
    .card { position: relative; box-sizing: border-box; width: ${WIDTH}px; height: ${HEIGHT}px;
      background: #faf7ef; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 18px; padding: 28px; }
    /* 元デザインと同じ、内側に少し寄せた細い枠 */
    .frame { position: absolute; inset: 14px; border: 2px solid #2f4634; border-radius: 10px; }
    .hero { display: flex; align-items: center; gap: 36px; }
    .stack { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
    .crop { background-image: url("${dataUri}"); background-repeat: no-repeat; }
  </style></head><body>
    <div class="card">
      <div class="frame"></div>
      <div class="hero">
        ${partHtml('carrot')}
        <div class="stack">
          ${partHtml('stamp')}
          ${partHtml('club')}
          ${partHtml('tool')}
        </div>
      </div>
      ${partHtml('icons')}
      ${partHtml('notice')}
    </div>
  </body></html>`;
}

async function main() {
  if (!existsSync(srcPath)) {
    console.error(`[og] 元画像が見つかりません: ${srcPath}`);
    process.exit(1);
  }

  const chromium = await loadChromium();
  const dataUri = `data:image/webp;base64,${readFileSync(srcPath).toString('base64')}`;

  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
  let browser;
  try {
    browser = await chromium.launch(executablePath ? { executablePath } : {});
  } catch (error) {
    console.error(`[og] chromium の起動に失敗しました: ${error.message}`);
    console.error('[og] `npx playwright install chromium` を実行するか、CHROMIUM_EXECUTABLE_PATH を指定してください。');
    process.exit(1);
  }

  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      // 1 にしておくと出力がちょうど 1200x630 px になる（Xの推奨サイズ）
      deviceScaleFactor: 1,
      colorScheme: 'light',
    });
    page.on('pageerror', (error) => console.error(`[og][page] ${error.message}`));

    await page.setContent(cardHtml(dataUri), { waitUntil: 'load' });
    await page.screenshot({ path: outPath });
    console.log(`[og] 書き出しました: ${outPath} (${WIDTH}x${HEIGHT})`);
  } finally {
    await browser.close();
  }
}

await main();
