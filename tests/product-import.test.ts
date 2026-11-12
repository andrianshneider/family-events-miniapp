import { expect, it, vi, afterEach } from "vitest";
import sharp from "sharp";
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/product/safe-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/product/safe-fetch")>()),
  fetchProductResource: fetchMock,
}));
import { importProduct } from "@/server/product/import";
afterEach(() => vi.resetAllMocks());
const page = {
  url: "https://shop.example/item",
  bytes: Buffer.from(
    '<h1>Gift</h1><meta property="og:image" content="/photo.png">',
  ),
};
it("decodes and bounds a real image, removes metadata and returns no remote photo URL", async () => {
  const png = await sharp({
    create: { width: 2000, height: 1000, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  fetchMock.mockResolvedValueOnce(page).mockResolvedValueOnce({ bytes: png });
  const result = await importProduct("https://shop.example/item");
  const info = await sharp(
    Buffer.from(result.image!.data, "base64"),
  ).metadata();
  expect(info.format).toBe("webp");
  expect(info.width).toBe(1600);
  expect(info.exif).toBeUndefined();
  expect(result).not.toHaveProperty("imageUrl");
});
it("keeps partial metadata when an image is blocked, invalid or unavailable", async () => {
  fetchMock
    .mockResolvedValueOnce(page)
    .mockResolvedValueOnce({ bytes: Buffer.from("<svg></svg>") });
  expect(await importProduct("https://shop.example/item")).toMatchObject({
    title: "Gift",
    image: null,
    amount: null,
  });
});
it("returns a readable error for inaccessible pages or missing product data", async () => {
  fetchMock.mockRejectedValueOnce(Error("private network"));
  await expect(
    importProduct("https://shop.example/item"),
  ).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
  fetchMock.mockResolvedValueOnce({
    url: "https://shop.example",
    bytes: Buffer.from("<p>Blocked</p>"),
  });
  await expect(
    importProduct("https://shop.example/item"),
  ).rejects.toMatchObject({ code: "PRODUCT_METADATA_MISSING" });
});
