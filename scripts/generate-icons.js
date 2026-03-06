const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const publicDir = path.join(__dirname, '..', 'client', 'public');

function createSVG(size) {
  return Buffer.from([
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 512 512">',
    '  <rect width="512" height="512" rx="64" fill="#0284c7"/>',
    '  <text x="256" y="340" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" font-size="280" fill="white">GM</text>',
    '</svg>'
  ].join('\n'));
}

async function generate() {
  const sizes = [
    { name: 'pwa-192x192.png', size: 192 },
    { name: 'pwa-512x512.png', size: 512 },
    { name: 'apple-touch-icon.png', size: 180 },
    { name: 'favicon.ico', size: 32 },
  ];

  for (const { name, size } of sizes) {
    const svg = createSVG(size);
    await sharp(svg).resize(size, size).png().toFile(path.join(publicDir, name));
    console.log('Created: ' + name + ' (' + size + 'x' + size + ')');
  }
  console.log('Done - PNG icons created');
}

generate().catch(console.error);
