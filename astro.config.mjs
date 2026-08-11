// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import { SITE_URL } from './src/consts.ts';

// https://astro.build/config
export default defineConfig({
  // sitemap と canonical の生成に必要。Cloudflare Workersの本番URLに合わせる（src/consts.ts）
  site: SITE_URL,
  trailingSlash: 'always',
  integrations: [
    sitemap({
      // 404・500 はインデックスさせたくない。@astrojs/sitemap は既定でも status code page を
      // 除外するが、暗黙の挙動に頼ると将来の更新で静かに載りうるので明示しておく。
      // filter には完全なURL文字列が渡る。
      filter: (page) => !/\/(404|500)\/?$/.test(new URL(page).pathname),
    }),
  ],
});
