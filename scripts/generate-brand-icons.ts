import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
const source = "assets/brand/meetmallow-approved.png";
const background = { r: 255, g: 106, b: 0, alpha: 1 };
for (const size of [180, 192, 512]) {
  const bytes = await sharp(source).resize(size, size).png().toBuffer();
  await writeFile(`public/icons/meetmallow-${size}.png`, bytes);
  // Existing installations/bookmarks may still use the old paths.
  await writeFile(`public/icons/icon-${size}.png`, bytes);
}
const mark = await sharp(source).resize(360, 360).png().toBuffer();
const overlay = await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([{ input: mark, left: 76, top: 76 }])
  .png()
  .toBuffer();
const clipped = await sharp(overlay)
  .composite([
    {
      input: Buffer.from(
        '<svg width="512" height="512"><defs><radialGradient id="fade"><stop offset="80%" stop-color="white"/><stop offset="100%" stop-color="white" stop-opacity="0"/></radialGradient></defs><circle cx="256" cy="256" r="200" fill="url(#fade)"/></svg>',
      ),
      blend: "dest-in",
    },
  ])
  .png()
  .toBuffer();
const maskable = await sharp({
  create: { width: 512, height: 512, channels: 4, background },
})
  .composite([{ input: clipped }])
  .png()
  .toBuffer();
await writeFile("public/icons/meetmallow-maskable-512.png", maskable);
await writeFile("public/icons/icon-maskable-512.png", maskable);
// Inline mark remains available offline without caching any user data or extra network requests.
const inline = (await readFile("public/icons/meetmallow-180.png")).toString(
  "base64",
);
const file = "public/offline.html";
const html = await readFile(file, "utf8");
await writeFile(
  file,
  html.replace(
    /<strong(?: class="offline-brand")?>.*?<\/strong>/s,
    `<strong class="offline-brand"><img src="data:image/png;base64,${inline}" width="48" height="48" alt="" />Meetmallow</strong>`,
  ),
);
console.info("Generated approved Meetmallow app, Apple and maskable icons.");
