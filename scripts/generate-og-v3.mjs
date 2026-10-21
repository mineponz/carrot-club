/**
 * 記事以外のOGP画像（サイトの新デザイン版）を生成する手動ツール。
 *   public/og-v3.png              … サイト共通の既定（og-card-v3.html）
 *   public/og-horse-detail-v2.png … 馬詳細ページ用（og-card-horse-detail.html）
 * 作り替えたらファイル名を変えること（SNSのキャッシュ対策。BaseLayout.astro のコメント参照）。
 * playwright は依存に入れず、PLAYWRIGHT_PATH（既定は fnm のグローバル）から借りる。
 * Googleフォント（Noto Sans JP）を読むのでネット接続が要る。
 *   node scripts/generate-og-v3.mjs            # 本番2枚
 *   ALT_DIR=/path node scripts/generate-og-v3.mjs  # にんじん付きの比較案も ALT_DIR に出す
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PW = process.env.PLAYWRIGHT_PATH ?? '/Users/mineral/.local/share/fnm/node-versions/v24.19.0/installation/lib/node_modules/playwright/index.mjs';
const { chromium } = (await import(pathToFileURL(PW).href)).default ?? (await import(pathToFileURL(PW).href));
const dir = dirname(fileURLToPath(import.meta.url));
const pub = join(dir, '..', 'public');
const jobs = [
  { html: 'og-card-v3.html', out: join(pub, 'og-v3.png'), alt: 'og-v3-carrot.png' },
  { html: 'og-card-horse-detail.html', out: join(pub, 'og-horse-detail-v2.png'), alt: 'og-horse-detail-v2-carrot.png' },
];
const browser = await chromium.launch();
try {
  const shoot = async (html, carrot, out) => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, colorScheme: 'light' });
    page.on('pageerror', (e) => console.error('[og][page]', e.message));
    await page.goto(pathToFileURL(join(dir, html)).href, { waitUntil: 'networkidle' });
    if (carrot) await page.evaluate(() => document.body.classList.add('has-carrot'));
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await page.waitForFunction(() => ['500', '700', '900'].every((w) => [...document.fonts].some((f) => f.family.includes('Noto Sans JP') && f.weight === w && f.status === 'loaded')), null, { timeout: 15000 }).catch(() => {});
    const ok = await page.evaluate(() => ['500', '700', '900'].every((w) => [...document.fonts].some((f) => f.family.includes('Noto Sans JP') && f.weight === w && f.status === 'loaded')));
    if (!ok) throw new Error('Noto Sans JP が読み込めていません（ネット接続を確認）');
    const o = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
    if (o.w > 1200 || o.h > 630) console.warn('[og] 警告: はみ出し', o);
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
    console.log('[og] wrote', out);
    await page.close();
  };
  for (const j of jobs) {
    await shoot(j.html, false, j.out);
    if (process.env.ALT_DIR) { mkdirSync(process.env.ALT_DIR, { recursive: true }); await shoot(j.html, true, join(process.env.ALT_DIR, j.alt)); }
  }
} finally { await browser.close(); }
