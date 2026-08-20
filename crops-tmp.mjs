import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const uri = 'data:image/png;base64,' + readFileSync('./public/og.png').toString('base64');
const S = 1254;
const crops = {
  'stamp 非公式': { x: 800, y: 480, w: 310, h: 130 },
  'キャロットクラブ': { x: 110, y: 190, w: 390, h: 100 },
  '出資馬検討ツール': { x: 480, y: 155, w: 620, h: 165 },
  'にんじん': { x: 155, y: 340, w: 190, h: 275 },
};
const rows = Object.entries(crops).map(([name, c]) => `
  <div class="row"><span class="lbl">${name} (${c.x},${c.y} ${c.w}x${c.h})</span>
  <div class="crop" style="width:${c.w}px;height:${c.h}px;background-position:${-c.x}px ${-c.y}px"></div></div>`).join('');
const html = `<!doctype html><meta charset="utf-8"><style>
 body{margin:0;background:#fff;font:14px monospace;width:900px}
 .row{padding:8px;border-bottom:1px solid #ccc}
 .lbl{display:block;margin-bottom:4px;color:#333}
 .crop{background-image:url("${uri}");background-size:${S}px ${S}px;background-repeat:no-repeat;outline:1px solid red}
</style>${rows}`;
writeFileSync('./crops-tmp.html', html);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
await page.goto('file://' + process.cwd() + '/crops-tmp.html');
await page.screenshot({ path: process.argv[2], fullPage: true });
await browser.close();
