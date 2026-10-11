import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { OrganizerPrincipal } from "@/types/principal";
import { transaction, db } from "../db/client";
import { AppError } from "../errors";
import { thumbnail, thumbnailPath } from "./thumbnails";
import { storage, mediaBucket } from "./client";
export const MAX_BYTES = 10485760,
  MAX_PIXELS = 20000000;
export async function sanitizeImage(bytes: Buffer) {
  if (bytes.length < 1 || bytes.length > MAX_BYTES)
    throw new AppError(
      422,
      "INVALID_IMAGE_SIZE",
      "Максимальный размер — 10 MiB.",
    );
  try {
    const image = sharp(bytes, {
      limitInputPixels: MAX_PIXELS,
      animated: false,
    });
    const info = await image.metadata();
    if (
      !["jpeg", "png", "webp"].includes(info.format ?? "") ||
      !info.width ||
      !info.height ||
      info.width * info.height > MAX_PIXELS ||
      (info.pages ?? 1) > 1
    )
      throw new Error("invalid");
    // Default sharp output strips EXIF and other metadata. Never fetch external image URLs.
    const output = await image
      .rotate()
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    if (output.data.length > MAX_BYTES) throw new Error("too large");
    return {
      bytes: output.data,
      width: output.info.width,
      height: output.info.height,
      mimeType: "image/webp",
    };
  } catch {
    throw new AppError(
      422,
      "INVALID_IMAGE",
      "Выберите статичное JPG, PNG или WebP до 20 мегапикселей.",
    );
  }
}
export async function prepareUpload(
  principal: OrganizerPrincipal,
  mime: string,
  size: number,
) {
  const id = randomUUID(),
    path = `pending/${principal.userId}/${id}/${randomUUID()}`;
  // Dimensions are placeholders until content inspection; pending can never be attached.
  await db()`INSERT INTO app.media_assets(id,owner_user_id,storage_path,mime_type,byte_size,width,height,state) VALUES(${id},${principal.userId},${path},${mime},${size},1,1,'pending')`;
  const { data, error } = await storage()
    .from(mediaBucket())
    .createSignedUploadUrl(path, { upsert: false });
  if (error || !data)
    throw new AppError(
      503,
      "UPLOAD_UNAVAILABLE",
      "Не удалось подготовить загрузку.",
    );
  return {
    assetId: id,
    path: data.path,
    token: data.token,
    signedUrl: data.signedUrl,
  };
}
export async function completeUpload(
  principal: OrganizerPrincipal,
  assetId: string,
) {
  return transaction(async (tx) => {
    const [asset] =
      await tx`SELECT * FROM app.media_assets WHERE id=${assetId} AND owner_user_id=${principal.userId} AND state<>'deleted' FOR UPDATE`;
    if (!asset)
      throw new AppError(404, "MEDIA_UNAVAILABLE", "Изображение недоступно.");
    if (asset.state === "ready") return { assetId };
    const { data, error } = await storage()
      .from(mediaBucket())
      .download(asset.storage_path);
    if (error || !data)
      throw new AppError(422, "UPLOAD_INCOMPLETE", "Загрузка не завершена.");
    const sanitized = await sanitizeImage(
      Buffer.from(await data.arrayBuffer()),
    );
    const path = `ready/${principal.userId}/${assetId}/${randomUUID()}.webp`;
    const result = await storage()
      .from(mediaBucket())
      .upload(path, sanitized.bytes, {
        contentType: "image/webp",
        upsert: false,
      });
    if (result.error)
      throw new AppError(
        503,
        "UPLOAD_UNAVAILABLE",
        "Не удалось сохранить изображение.",
      );
    const thumbPath = thumbnailPath(path);
    const thumbResult = await storage()
      .from(mediaBucket())
      .upload(thumbPath, await thumbnail(sanitized.bytes), {
        contentType: "image/webp",
        upsert: false,
      });
    if (thumbResult.error) {
      await storage().from(mediaBucket()).remove([path, thumbPath]);
      throw new AppError(
        503,
        "UPLOAD_UNAVAILABLE",
        "Не удалось сохранить миниатюру.",
      );
    }
    try {
      await tx`UPDATE app.media_assets SET storage_path=${path},mime_type='image/webp',byte_size=${sanitized.bytes.length},width=${sanitized.width},height=${sanitized.height},state='ready' WHERE id=${assetId}`;
    } catch (e) {
      await storage().from(mediaBucket()).remove([path, thumbPath]);
      throw e;
    }
    await storage().from(mediaBucket()).remove([asset.storage_path]);
    return { assetId };
  });
}
export async function eventCover(publicId: string) {
  const [asset] =
    await db()`SELECT m.storage_path FROM app.events e JOIN app.media_assets m ON m.id=e.cover_asset_id WHERE e.public_id=${publicId} AND e.deleted_at IS NULL AND m.owner_user_id=e.organizer_id AND m.state='ready'`;
  if (!asset)
    throw new AppError(404, "MEDIA_UNAVAILABLE", "Изображение недоступно.");
  const { data, error } = await storage()
    .from(mediaBucket())
    .download(asset.storage_path);
  if (error || !data)
    throw new AppError(404, "MEDIA_UNAVAILABLE", "Изображение недоступно.");
  return data;
}
