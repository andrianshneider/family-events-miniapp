const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;

/** Resize locally before requesting a signed upload. Server validation remains authoritative. */
export async function prepareCoverImage(file: File): Promise<File> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    !file.size
  )
    throw Error("Выберите JPG, PNG или WebP.");
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(
          Error("Не удалось прочитать фото. Выберите другое изображение."),
        );
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight)
      throw Error("Не удалось определить размер фото.");
    if (
      image.naturalWidth * image.naturalHeight <= MAX_PIXELS &&
      file.size <= MAX_BYTES
    )
      return file;
    // A bounded canvas also works within mobile Safari's canvas memory limits.
    const scale = Math.min(
      1,
      2560 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.floor(image.naturalHeight * scale));
    try {
      const context = canvas.getContext("2d");
      if (!context)
        throw Error("Не удалось уменьшить фото. Повторите попытку.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) =>
            result
              ? resolve(result)
              : reject(Error("Не удалось уменьшить фото.")),
          "image/jpeg",
          0.85,
        );
      });
      if (!blob.size || blob.size > MAX_BYTES)
        throw Error(
          "Не удалось уменьшить фото до 10 Мб. Выберите другое изображение.",
        );
      return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
        type: "image/jpeg",
        lastModified: file.lastModified,
      });
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    image.src = "";
    URL.revokeObjectURL(url);
  }
}
