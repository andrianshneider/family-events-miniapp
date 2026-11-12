import { afterEach, expect, it, vi } from "vitest";
import { prepareCoverImage } from "@/lib/prepare-cover-image";
afterEach(() => vi.unstubAllGlobals());
function browser(
  width: number,
  height: number,
  output: Blob | null = new Blob(["jpeg"], { type: "image/jpeg" }),
) {
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ fillStyle: "", fillRect: vi.fn(), drawImage }),
    toBlob: (callback: (blob: Blob | null) => void) => callback(output),
  };
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = width;
      naturalHeight = height;
      onload?: () => void;
      set src(value: string) {
        if (value) this.onload?.();
      }
    },
  );
  vi.stubGlobal("document", { createElement: () => canvas });
  return { canvas, drawImage };
}
it("reduces the reported iPhone photo to a bounded canvas and uploads JPEG metadata", async () => {
  const { drawImage, canvas } = browser(6820, 5116);
  const result = await prepareCoverImage(
    new File(["original"], "IMG_7616.jpeg", { type: "image/jpeg" }),
  );
  expect(drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 2560, 1920]);
  expect(result.type).toBe("image/jpeg");
  expect(result.size).toBeLessThan(10485760);
  expect(canvas.width).toBe(0);
});
it("preserves an acceptable original without recompression", async () => {
  const { drawImage } = browser(1200, 800);
  const file = new File(["png"], "photo.png", { type: "image/png" });
  expect(await prepareCoverImage(file)).toBe(file);
  expect(drawImage).not.toHaveBeenCalled();
});
it("also compresses files over the byte limit and reports encoding failures", async () => {
  browser(1200, 800);
  const file = new File([new Uint8Array(10485761)], "large.png", {
    type: "image/png",
  });
  expect((await prepareCoverImage(file)).size).toBeLessThan(10485760);
  browser(6820, 5116, null);
  await expect(prepareCoverImage(file)).rejects.toThrow(
    "Не удалось уменьшить фото",
  );
});
it("rejects unsupported files before decoding", async () => {
  await expect(
    prepareCoverImage(new File(["x"], "photo.heic", { type: "image/heic" })),
  ).rejects.toThrow("Выберите JPG");
});
