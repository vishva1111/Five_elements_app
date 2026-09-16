const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ASSETS = path.join(__dirname, '..', 'assets');
const LOGO = path.join(ASSETS, 'logo.png');

const GREEN_BG = { r: 18, g: 63, b: 36, alpha: 1 }; // #123f24

async function generate() {
  if (!fs.existsSync(LOGO)) {
    console.error('ERROR: Save your logo to assets/logo.png first!');
    process.exit(1);
  }

  const logo = sharp(LOGO);
  const metadata = await logo.metadata();
  console.log(`Logo: ${metadata.width}x${metadata.height}`);

  // 1. icon.png — 1024x1024, green background, logo centered
  const iconSize = 1024;
  const iconLogoSize = Math.round(iconSize * 0.55);
  const iconBuffer = await logo.resize(iconLogoSize, iconLogoSize, { fit: 'contain' }).toBuffer();
  await sharp({
    create: {
      width: iconSize, height: iconSize,
      channels: 4,
      background: GREEN_BG,
    }
  }).composite([{ input: iconBuffer, gravity: 'center' }])
    .png().toFile(path.join(ASSETS, 'icon.png'));
  console.log('✓ icon.png (1024x1024)');

  // 2. adaptive-icon.png — 1024x1024, green bg, logo centered with padding
  const adaptiveLogoSize = Math.round(iconSize * 0.65);
  const adaptiveBuffer = await logo.resize(adaptiveLogoSize, adaptiveLogoSize, { fit: 'contain' }).toBuffer();
  await sharp({
    create: {
      width: iconSize, height: iconSize,
      channels: 4,
      background: GREEN_BG,
    }
  }).composite([{ input: adaptiveBuffer, gravity: 'center' }])
    .png().toFile(path.join(ASSETS, 'adaptive-icon.png'));
  console.log('✓ adaptive-icon.png (1024x1024)');

  // 3. splash-icon.png — 200x200 centered logo on transparent
  const splashLogoSize = 200;
  const splashBuffer = await logo.resize(splashLogoSize, splashLogoSize, { fit: 'contain' }).toBuffer();
  await sharp({
    create: {
      width: splashLogoSize, height: splashLogoSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    }
  }).composite([{ input: splashBuffer, gravity: 'center' }])
    .png().toFile(path.join(ASSETS, 'splash-icon.png'));
  console.log('✓ splash-icon.png (200x200)');

  // 4. favicon.png — 48x48
  await logo.resize(48, 48, { fit: 'contain' })
    .png().toFile(path.join(ASSETS, 'favicon.png'));
  console.log('✓ favicon.png (48x48)');

  console.log('\nAll icons generated!');
}

generate().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
