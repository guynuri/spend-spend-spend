// Renders app icons from assets/icon.svg (PLAN §4.1). Run: npm run gen:icons
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('assets/icon.svg');
mkdirSync('public/icons', { recursive: true });
const out = [
  ['public/icons/icon-192.png', 192, 0],
  ['public/icons/icon-512.png', 512, 0],
  ['public/icons/apple-touch-icon.png', 180, 0],
  // maskable: content inside the 80 % safe zone
  ['public/icons/maskable-512.png', 512, 0.12],
];
for (const [file, size, pad] of out) {
  const inner = Math.round(size * (1 - 2 * pad));
  const img = await sharp(svg).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: '#2268d8' } })
    .composite([{ input: img, gravity: 'center' }])
    .png()
    .toFile(file);
  console.log('wrote', file);
}
writeFileSync('public/favicon.svg', svg);
