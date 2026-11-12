import "server-only";
import sharp from "sharp";
import { AppError } from "../errors";
import { fetchProductResource } from "./safe-fetch";
import { parseProduct } from "./metadata";
export async function importProduct(url: string) {
  const deadline = Date.now() + 18000;
  let page;
  try {
    page = await fetchProductResource(url, "html", deadline);
  } catch {
    throw new AppError(
      422,
      "PRODUCT_UNAVAILABLE",
      "Не удалось получить данные по ссылке. Магазин может ограничивать доступ. Заполните поля вручную или попробуйте другую ссылку.",
    );
  }
  const { imageUrl, ...fields } = parseProduct(page.bytes, page.url);
  let image: { data: string; mimeType: "image/webp" } | null = null;
  if (imageUrl)
    try {
      const source = await fetchProductResource(imageUrl, "image", deadline);
      const decoder = sharp(source.bytes, {
        limitInputPixels: 20000000,
        animated: false,
      });
      const info = await decoder.metadata();
      if (
        !["jpeg", "png", "webp"].includes(info.format ?? "") ||
        (info.pages ?? 1) > 1
      )
        throw Error("Unsupported image");
      const bytes = await decoder
        .rotate()
        .resize({
          width: 1600,
          height: 1600,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toBuffer();
      if (bytes.length > 2 * 1024 * 1024) throw Error("Image too large");
      image = { data: bytes.toString("base64"), mimeType: "image/webp" };
    } catch {
      /* Partial results remain useful; the old photo stays untouched. */
    }
  if (!fields.title && !fields.amount && !image)
    throw new AppError(
      422,
      "PRODUCT_METADATA_MISSING",
      "На странице не найдены данные товара. Заполните подарок вручную.",
    );
  return { ...fields, image };
}
