// Genera los iconos PNG de la PWA a partir de los SVG (usa Playwright)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const pub = path.join(__dirname, '..', 'public');
  const b = await chromium.launch();
  const p = await b.newPage();
  const render = async (svgFile, size, out) => {
    const svg = fs.readFileSync(path.join(pub, svgFile), 'utf8');
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await p.screenshot({ path: path.join(pub, out), omitBackground: true });
  };
  await render('icon.svg', 192, 'icons/icon-192.png');
  await render('icon.svg', 512, 'icons/icon-512.png');
  await render('icon-maskable.svg', 512, 'icons/maskable-512.png');
  await render('icon-maskable.svg', 180, 'icons/apple-touch-icon.png');
  await b.close();
  console.log('iconos generados');
})();
