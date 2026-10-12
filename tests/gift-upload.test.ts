import { it, expect, vi, afterEach } from "vitest";
import { uploadGiftImage, type GiftUpload } from "@/lib/gift-upload";
afterEach(() => vi.unstubAllGlobals());
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(status >= 400 ? { error: data } : { data }), {
    status,
  });
it("probes the same image after a lost upload response and completes it without another file/asset", async () => {
  const file = new File([new Uint8Array([1, 2])], "photo.png", {
      type: "image/png",
    }),
    cache: { current: GiftUpload | null } = { current: null };
  const calls: string[] = [];
  let lost = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      calls.push(String(path));
      if (path === "/api/auth/csrf") return response({ csrfToken: "test" });
      if (path === "/api/v1/media/uploads")
        return response(
          { assetId: "asset", signedUrl: "https://upload.example.test" },
          201,
        );
      if (path === "https://upload.example.test" && lost) {
        lost = false;
        throw new DOMException("Timeout", "TimeoutError");
      }
      if (path === "/api/v1/media/asset/complete")
        return response({ assetId: "asset" });
      throw Error("Unexpected");
    }),
  );
  await expect(uploadGiftImage(file, cache)).rejects.toThrow();
  expect(await uploadGiftImage(file, cache)).toBe("asset");
  expect(await uploadGiftImage(file, cache)).toBe("asset");
  expect(calls.filter((x) => x === "/api/v1/media/uploads")).toHaveLength(1);
  expect(calls.filter((x) => x === "https://upload.example.test")).toHaveLength(
    1,
  );
});
it("retries an incomplete upload on the same prepared asset and preserves errors for invalid images", async () => {
  const file = new File([new Uint8Array([1])], "photo.png", {
      type: "image/png",
    }),
    cache: { current: GiftUpload | null } = {
      current: {
        file,
        assetId: "asset",
        signedUrl: "https://upload.example.test",
        ready: false,
      },
    };
  let uploads = 0,
    complete = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/auth/csrf") return response({ csrfToken: "test" });
      if (path === "https://upload.example.test") {
        uploads++;
        return new Response(null, { status: 200 });
      }
      if (path === "/api/v1/media/asset/complete") {
        complete++;
        return complete === 1
          ? response({ code: "UPLOAD_INCOMPLETE", message: "Incomplete" }, 422)
          : response({ assetId: "asset" });
      }
      throw Error("Unexpected asset creation");
    }),
  );
  expect(await uploadGiftImage(file, cache)).toBe("asset");
  expect(uploads).toBe(1);
  expect(complete).toBe(2);
  cache.current!.ready = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      path === "/api/auth/csrf"
        ? response({ csrfToken: "test" })
        : response({ code: "INVALID_IMAGE", message: "Invalid" }, 422),
    ),
  );
  await expect(uploadGiftImage(file, cache)).rejects.toMatchObject({
    code: "INVALID_IMAGE",
  });
  expect(cache.current!.ready).toBe(false);
});
