// Renders public/icon.svg into the PNG sizes the PWA manifest needs (uses Playwright's Chromium).
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const svg = fs.readFileSync(path.join(__dirname, '..', 'public', 'icon.svg'), 'utf8');
const dataUri = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');

(async () => {
  const browser = await chromium.launch();
  const jobs = [
    ['icon-192.png', 192, 1],
    ['icon-512.png', 512, 1],
    ['apple-touch-icon.png', 180, 1],
    ['icon-maskable-512.png', 512, 0.72], // keep the artwork inside the maskable safe zone
  ];
  for (const [name, size, scale] of jobs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<body style="margin:0;background:#0b1417;display:grid;place-items:center;width:${size}px;height:${size}px">` +
        `<img src="${dataUri}" style="width:${Math.round(size * scale)}px;height:${Math.round(size * scale)}px"></body>`,
    );
    await page.screenshot({ path: path.join(__dirname, '..', 'public', name) });
    await page.close();
  }
  await browser.close();
  console.log('icons written to public/');
})();
