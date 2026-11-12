import "server-only";
import sharp from "sharp";
export const thumbnailPath = (path: string) =>
  path.replace(/\.webp$/, ".thumb.webp");
export async function thumbnail(bytes: Buffer) {
  return sharp(bytes, { limitInputPixels: 20000000 })
    .resize({
      width: 640,
      height: 384,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 72 })
    .toBuffer();
}
