import { it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import sharp from "sharp";
import manifest from "@/app/manifest";
import { iphoneSafari, standalone } from "@/lib/pwa";
it("uses stable app identity, scoped routes and real safe-area icons", async () => {
  const app = manifest();
  expect(app).toMatchObject({
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "ru",
  });
  for (const icon of app.icons!) {
    const m = await sharp("public" + icon.src).metadata();
    expect(`${m.width}x${m.height}`).toBe(icon.sizes);
  }
  const safe = app.icons!.find((i) => i.purpose === "maskable")!;
  const { data, info } = await sharp("public" + safe.src)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Maskable content must remain within the central 80% safe circle.
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      if (Math.hypot(x - 255.5, y - 255.5) <= 205) continue;
      const i = (y * info.width + x) * info.channels;
      expect([data[i], data[i + 1], data[i + 2]]).toEqual([126, 80, 197]);
    }
});
it("recognizes installed modes and restricts iPhone instructions to Safari including desktop-UA iPad", () => {
  expect(
    standalone({
      matchMedia: () => ({ matches: false }) as MediaQueryList,
      navigator: { standalone: true } as unknown as Navigator,
    }),
  ).toBe(true);
  expect(
    standalone({
      matchMedia: () => ({ matches: true }) as MediaQueryList,
      navigator: {} as Navigator,
    }),
  ).toBe(true);
  for (const ua of ["iPhone Safari", "iPad Safari"])
    expect(
      iphoneSafari({ userAgent: ua, platform: "iPhone", maxTouchPoints: 5 }),
    ).toBe(true);
  expect(
    iphoneSafari({
      userAgent: "Macintosh Safari",
      platform: "MacIntel",
      maxTouchPoints: 5,
    }),
  ).toBe(true);
  for (const ua of [
    "iPhone Safari CriOS",
    "iPhone Safari FxiOS",
    "iPhone Safari EdgiOS",
    "Android Chrome",
    "Macintosh Safari",
  ])
    expect(
      iphoneSafari({ userAgent: ua, platform: "MacIntel", maxTouchPoints: 0 }),
    ).toBe(false);
});
it("worker caches only the generic offline document and bypasses API, writes, assets and external requests", async () => {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const put = vi.fn(),
    match = vi.fn(async () => new Response("offline")),
    remove = vi.fn();
  const open = vi.fn(async () => ({ put, match }));
  let networkFails = false;
  const fetch = vi.fn(async () => {
    if (networkFails) throw Error("offline");
    return new Response("network");
  });
  runInNewContext(await readFile("public/sw.js", "utf8"), {
    self: {
      location: { origin: "https://app.test" },
      addEventListener: (
        k: string,
        f: (event: Record<string, unknown>) => void,
      ) => handlers.set(k, f),
      skipWaiting: vi.fn(),
      clients: { claim: vi.fn() },
    },
    caches: {
      open,
      keys: async () => ["family-events-offline-old", "another-app"],
      delete: remove,
    },
    fetch,
    URL,
    Response,
  });
  let work!: Promise<unknown>;
  handlers.get("install")!({
    waitUntil: (p: Promise<unknown>) => {
      work = p;
    },
  });
  await work;
  expect(put).toHaveBeenCalledTimes(1);
  expect(put.mock.calls[0][0]).toBe("/offline.html");
  handlers.get("activate")!({
    waitUntil: (p: Promise<unknown>) => {
      work = p;
    },
  });
  await work;
  expect(remove).toHaveBeenCalledExactlyOnceWith("family-events-offline-old");
  const respondWith = vi.fn();
  for (const [method, mode, url] of [
    ["POST", "navigate", "https://app.test/events"],
    [
      "GET",
      "navigate",
      "https://app.test/api/auth/telegram/callback?code=secret",
    ],
    ["GET", "cors", "https://app.test/api/v1/events"],
    ["GET", "cors", "https://app.test/icons/icon-192.png"],
    ["GET", "navigate", "https://else.test/e/id"],
  ])
    handlers.get("fetch")!({ request: { method, mode, url }, respondWith });
  expect(respondWith).not.toHaveBeenCalled();
  const request = {
    method: "GET",
    mode: "navigate",
    url: "https://app.test/e/invitation/wishlist",
  };
  handlers.get("fetch")!({ request, respondWith });
  expect(await (await respondWith.mock.calls[0][0]).text()).toBe("network");
  expect(fetch).toHaveBeenLastCalledWith(request, { cache: "no-store" });
  networkFails = true;
  handlers.get("fetch")!({ request, respondWith });
  expect(await (await respondWith.mock.calls[1][0]).text()).toBe("offline");
  expect(put).toHaveBeenCalledTimes(1);
});
