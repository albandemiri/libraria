// Rasterises an SVG read from stdin to a JPEG written to stdout.
//
// This runs in its own process on purpose: the cover module switches sharp's SVG loader off
// for the whole server process, and the demo covers must not weaken that. The SVG holds
// only paths (no text, no font references), so no system font is needed either.
const sharp = require('sharp');

const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', async () => {
  try {
    const jpeg = await sharp(Buffer.concat(chunks)).jpeg({ quality: 90 }).toBuffer();
    process.stdout.write(jpeg);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
});
