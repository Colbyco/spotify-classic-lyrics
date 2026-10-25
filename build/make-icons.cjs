const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const icons = require('png2icons');
(async () => {
  const root = path.join(__dirname, '..');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="228" fill="#1c1a21"/><rect x="207" y="238" width="57" height="548" rx="28" fill="#b7a0e6"/><path d="M356 304H754M356 512H675M356 720H730" stroke="#f1edf7" stroke-width="65" stroke-linecap="round"/></svg>';
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  await fs.writeFile(path.join(root, 'src', 'icon.png'), await sharp(png).resize(256).toBuffer());
  await fs.writeFile(path.join(__dirname, 'icon.ico'), icons.createICO(png, icons.BICUBIC2, 0, false, true));
  await fs.writeFile(path.join(__dirname, 'icon.icns'), icons.createICNS(png, icons.BICUBIC2, 0));
  const tray = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M5 5V27M12 8H27M12 16H24M12 24H26" stroke="white" stroke-width="3" stroke-linecap="round"/></svg>';
  await fs.writeFile(path.join(root, 'src', 'tray.png'), await sharp(Buffer.from(tray)).png().toBuffer());
})().catch(error => { console.error(error); process.exitCode = 1; });
