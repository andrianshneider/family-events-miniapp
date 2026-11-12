import { it, expect } from "vitest";
import sharp from "sharp";
import { sanitizeImage } from "@/server/storage/media";
it("rejects SVG/HTML, sanitizes a real image", async () => {
  await expect(
    sanitizeImage(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    ),
  ).rejects.toThrow();
  await expect(
    sanitizeImage(Buffer.from("<html>unsafe</html>")),
  ).rejects.toThrow();
  const png = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  const out = await sanitizeImage(png);
  expect(out.mimeType).toBe("image/webp");
  expect(out.width).toBe(4);
  expect((await sharp(out.bytes).metadata()).exif).toBeUndefined();
});

import { thumbnail } from "@/server/storage/thumbnails";
it("creates smaller, bounded WebP thumbnails without metadata", async () => {
  const { randomBytes } = await import("node:crypto");
  const source = await sharp(randomBytes(1200 * 800 * 3), {
    raw: { width: 1200, height: 800, channels: 3 },
  })
    .webp({ quality: 85 })
    .toBuffer();
  const result = await thumbnail(source),
    meta = await sharp(result).metadata();
  expect(meta.width).toBeLessThanOrEqual(640);
  expect(meta.height).toBeLessThanOrEqual(384);
  expect(meta.format).toBe("webp");
  expect(meta.exif).toBeUndefined();
  expect(result.length).toBeLessThan(source.length / 3);
});
