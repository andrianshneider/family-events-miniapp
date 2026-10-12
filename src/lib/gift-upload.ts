import { wishlistApi, WishlistError } from "./wishlist-client";
export type GiftUpload = {
  file: File;
  assetId: string;
  signedUrl: string;
  ready: boolean;
};
export async function uploadGiftImage(
  file: File,
  cache: { current: GiftUpload | null },
) {
  const complete = async (assetId: string) => {
    const csrf = await wishlistApi<{ csrfToken: string }>("/api/auth/csrf");
    await wishlistApi(`/api/v1/media/${assetId}/complete`, {
      method: "POST",
      headers: { "x-csrf-token": csrf.csrfToken },
      signal: AbortSignal.timeout(60000),
    });
  };
  if (cache.current?.file === file) {
    if (cache.current.ready) return cache.current.assetId;
    // A lost PUT/complete response may already have committed. Probe the same asset first.
    try {
      await complete(cache.current.assetId);
      cache.current.ready = true;
      return cache.current.assetId;
    } catch (error) {
      if (!(
        error instanceof WishlistError && error.code === "UPLOAD_INCOMPLETE"
      ))
        throw error;
    }
  } else {
    const csrf = await wishlistApi<{ csrfToken: string }>("/api/auth/csrf");
    const prepared = await wishlistApi<{ assetId: string; signedUrl: string }>(
      "/api/v1/media/uploads",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrf.csrfToken,
        },
        body: JSON.stringify({ mimeType: file.type, byteSize: file.size }),
      },
    );
    cache.current = { file, ...prepared, ready: false };
  }
  const p = cache.current;
  const sent = await fetch(p.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type, "x-upsert": "false" },
    body: file,
    signal: AbortSignal.timeout(60000),
  });
  if (!sent.ok && sent.status !== 409)
    throw Error(
      "Не удалось загрузить фото. Прежнее фото сохранено; повторите попытку.",
    );
  await complete(p.assetId);
  p.ready = true;
  return p.assetId;
}
