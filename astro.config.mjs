// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import { SITE_URL } from './src/consts.ts';

// https://astro.build/config
export default defineConfig({
  // sitemap と canonical の生成に必要。Cloudflare Workersの本番URLに合わせる（src/consts.ts）
  site: SITE_URL,
  trailingSlash: 'always',
  integrations: [sitemap()],
});
