/**
 * 記事以外のOGP画像（サイトの新デザイン版）を生成する手動ツール。
 *   public/og-v4.png              … サイト共通の既定（og-card-v3.html）
 *   public/og-horse-detail-v3.png … 馬詳細ページ用（og-card-horse-detail.html）
 * にんじんは各HTMLの body の has-carrot で出している（外すとにんじん無し版。2026-10-21 本人の判断でにんじん付きを採用）。
 * 作り替えたらファイル名を変えること（SNSのキャッシュ対策。BaseLayout.astro のコメント参照）。
 * playwright は依存に入れず、PLAYWRIGHT_PATH（既定は fnm のグローバル）から借りる。
 * Googleフォント（Noto Sans JP）を読むのでネット接続が要る。
 *   node scripts/generate-og-v3.mjs
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PW = process.env.PLAYWRIGHT_PATH ?? '/Users/mineral/.local/share/fnm/node-versions/v24.19.0/installation/lib/node_modules/playwright/index.mjs';
const { chromium } = (await import(pathToFileURL(PW).href)).default ?? (await import(pathToFileURL(PW).href));
const dir = dirname(fileURLToPath(import.meta.url));
const pub = join(dir, '..', 'public');
const jobs = [
  { html: 'og-card-v3.html', out: join(pub, 'og-v4.png') },
  { html: 'og-card-horse-detail.html', out: join(pub, 'og-horse-detail-v3.png') },
];
const browser = await chromium.launch();
try {
  const shoot = async (html, out) => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, colorScheme: 'light' });
    page.on('pageerror', (e) => console.error('[og][page]', e.message));
    await page.goto(pathToFileURL(join(dir, html)).href, { waitUntil: 'networkidle' });
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
    await shoot(j.html, j.out);
  }
} finally { await browser.close(); }
