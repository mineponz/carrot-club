// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import { SITE_URL, isNoindexPath } from './src/consts.ts';

// https://astro.build/config
export default defineConfig({
  // sitemap と canonical の生成に必要。Cloudflare Workersの本番URLに合わせる（src/consts.ts）
  site: SITE_URL,
  trailingSlash: 'always',
  integrations: [
    sitemap({
      // filter には完全なURL文字列が渡る。除外は2種類:
      //  - 404・500: @astrojs/sitemap は既定でも status code page を除外するが、
      //    暗黙の挙動に頼ると将来の更新で静かに載りうるので明示しておく。
      //  - isNoindexPath: BaseLayout が noindex を出すページ（馬個別・ツアー後馬体重・募集申込票数）。
      //    sitemap に載せたまま noindex にすると Search Console で矛盾警告が出るため揃える。
      filter: (page) => {
        const { pathname } = new URL(page);
        return !/\/(404|500)\/?$/.test(pathname) && !isNoindexPath(pathname);
      },
    }),
  ],
});
