import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));
vi.mock("node:http", () => ({ request: mocks.request }));
import { fetchProductResource } from "@/server/product/safe-fetch";
afterEach(() => vi.resetAllMocks());
function respond(
  status: number,
  headers: Record<string, string>,
  body = Buffer.from("html"),
) {
  mocks.request.mockImplementationOnce((_url, options, callback) => {
    const req = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: (e: Error) => void;
    };
    const res = new EventEmitter() as EventEmitter & {
      statusCode: number;
      headers: Record<string, string>;
      destroy: () => void;
    };
    Object.assign(res, {
      statusCode: status,
      headers,
      destroy: () => req.emit("close"),
    });
    req.destroy = (error: Error) => {
      req.emit("error", error);
      req.emit("close");
    };
    req.end = () =>
      queueMicrotask(() => {
        callback(res);
        res.emit("data", body);
        res.emit("end");
        req.emit("close");
      });
    return req;
  });
}
it("pins the checked IP while retaining the original HTTPS host and sends no cookies", async () => {
  mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  respond(200, { "content-type": "text/html" });
  expect(
    (
      await fetchProductResource("https://shop.example/item", "html")
    ).bytes.toString(),
  ).toBe("html");
  const [url, options] = mocks.request.mock.calls[0];
  expect(url.hostname).toBe("shop.example");
  expect(options.agent).toBe(false);
  expect(options.headers.Cookie).toBeUndefined();
  const cb = vi.fn();
  options.lookup("shop.example", { all: false }, cb);
  expect(cb).toHaveBeenCalledWith(null, "8.8.8.8", 4);
  const all = vi.fn();
  options.lookup("shop.example", { all: true }, all);
  expect(all).toHaveBeenCalledWith(null, [{ address: "8.8.8.8", family: 4 }]);
});
it("rejects mixed public/private DNS before any connection", async () => {
  mocks.lookup.mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
    { address: "10.0.0.1", family: 4 },
  ]);
  await expect(
    fetchProductResource("https://shop.example", "html"),
  ).rejects.toThrow("Unsafe");
  expect(mocks.request).not.toHaveBeenCalled();
});
it("rechecks redirects and blocks redirects to metadata or private DNS", async () => {
  mocks.lookup.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }]);
  respond(302, { location: "http://169.254.169.254/latest/meta-data" });
  await expect(
    fetchProductResource("https://shop.example", "html"),
  ).rejects.toThrow("Unsafe");
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("rejects an oversized body and a wrong content type", async () => {
  mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  respond(
    200,
    { "content-type": "text/html" },
    Buffer.alloc(2 * 1024 * 1024 + 1),
  );
  await expect(
    fetchProductResource("https://shop.example", "html"),
  ).rejects.toThrow("too large");
  respond(200, { "content-type": "image/svg+xml" });
  await expect(
    fetchProductResource("https://shop.example/image", "image"),
  ).rejects.toThrow("Unsupported");
});
