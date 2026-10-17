import { it, expect, vi } from "vitest";
import { measured, timed } from "@/server/performance";
it("isolates stage timings across concurrent requests and emits only numeric values", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const [a, b] = await Promise.all([
    measured(async () => {
      await timed("session", async () => Promise.resolve());
      return "a";
    }),
    measured(async () => {
      await timed("storage_sign", async () => Promise.resolve());
      return "b";
    }),
  ]);
  expect(a.serverTiming).toContain("session;dur=");
  expect(a.serverTiming).not.toContain("storage_sign");
  expect(b.serverTiming).toContain("storage_sign;dur=");
  expect(b.serverTiming).not.toContain("session");
  expect(a.value).toBe("a");
  vi.restoreAllMocks();
});
