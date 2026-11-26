import { afterEach, expect, it, vi } from "vitest";
import {
  homeInstall,
  initialInstallState,
  type InstallState,
} from "@/lib/home-install";
import type { InstallPrompt } from "@/lib/pwa";
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
});
function setup({
  tg = false,
  ua = "Chrome",
  mode = false,
  version = true,
  late = false,
  status = "missed",
} = {}) {
  vi.useFakeTimers();
  const browser = new EventTarget() as Window;
  const document = new EventTarget();
  Object.assign(document, { visibilityState: "visible" });
  const media = new EventTarget();
  Object.assign(media, { matches: mode });
  const handlers = new Map<string, (data?: unknown) => void>();
  const sdk = {
    initData: "verified-on-server-only",
    isVersionAtLeast: vi.fn(() => version),
    checkHomeScreenStatus: vi.fn((callback: (s: string) => void) =>
      callback(status),
    ),
    addToHomeScreen: vi.fn(),
    onEvent: vi.fn((name: string, fn: (data?: unknown) => void) =>
      handlers.set(name, fn),
    ),
    offEvent: vi.fn((name: string) => handlers.delete(name)),
  };
  Object.assign(browser, {
    document,
    navigator: { userAgent: ua, platform: "", maxTouchPoints: 0 },
    location: { hash: tg ? "#tgWebAppData=hint" : "" },
    sessionStorage: { getItem: () => null },
    matchMedia: () => media,
    Telegram: tg && !late ? { WebApp: sdk } : undefined,
  });
  let current: InstallState = { ...initialInstallState };
  const updates = vi.fn((value: InstallState) => {
    current = value;
  });
  const controller = homeInstall(browser, updates);
  cleanups.push(controller.dispose);
  return {
    browser,
    document,
    media,
    sdk,
    handlers,
    controller,
    updates,
    state: () => current,
  };
}
function prompt(
  browser: Window,
  outcome: "accepted" | "dismissed" = "dismissed",
  choice?: Promise<{ outcome: "accepted" | "dismissed" }>,
) {
  const event = new Event("beforeinstallprompt", {
    cancelable: true,
  }) as InstallPrompt;
  event.prompt = vi.fn(async () => {});
  event.userChoice = choice ?? Promise.resolve({ outcome });
  browser.dispatchEvent(event);
  return event;
}
it.each(["unknown", "missed"])(
  "Telegram %s is available, invokes native API on click and only explicit added proves installation",
  (status) => {
    const t = setup({ tg: true, status });
    expect(t.sdk.checkHomeScreenStatus).toHaveBeenCalled();
    expect(t.state().available).toBe(true);
    t.controller.install();
    expect(t.sdk.addToHomeScreen).toHaveBeenCalledTimes(1);
    expect(t.state().installing).toBe(true);
    expect(t.state().available).toBe(true);
    t.handlers.get("homeScreenAdded")!();
    expect(t.state().available).toBe(false);
    t.handlers.get("homeScreenChecked")!({ status: "missed" });
    expect(t.state().available).toBe(false);
  },
);
it.each(["added", "unsupported"])(
  "Telegram %s hides installation",
  (status) => {
    const t = setup({ tg: true, status });
    expect(t.state().available).toBe(false);
    t.controller.install();
    expect(t.sdk.addToHomeScreen).not.toHaveBeenCalled();
  },
);
it("old Telegram and a missing SDK never fall back to iOS browser installation", () => {
  const t = setup({ tg: true, version: false, ua: "iPhone Safari" });
  expect(t.state().available).toBe(false);
});
it("attaches a late SDK and removes all Telegram listeners/timers on teardown", () => {
  const t = setup({ tg: true, late: true });
  expect(t.state().available).toBe(false);
  Object.assign(t.browser, { Telegram: { WebApp: t.sdk } });
  vi.advanceTimersByTime(250);
  expect(t.state().available).toBe(true);
  t.controller.dispose();
  expect(t.sdk.offEvent).toHaveBeenCalledTimes(3);
  const count = t.updates.mock.calls.length;
  vi.advanceTimersByTime(20000);
  expect(t.updates).toHaveBeenCalledTimes(count);
});
it("Telegram failure, cancellation and no system response all allow retries without success claims", () => {
  const t = setup({ tg: true });
  t.controller.install();
  t.handlers.get("homeScreenFailed")!({ error: "cancelled" });
  expect(t.state()).toMatchObject({ available: true, installing: false });
  expect(t.state().message).toContain("отменено");
  t.controller.install();
  vi.advanceTimersByTime(10000);
  expect(t.state()).toMatchObject({ available: true, installing: false });
  expect(t.state().message).toContain("не подтвердила");
  t.controller.install();
  expect(t.sdk.addToHomeScreen).toHaveBeenCalledTimes(3);
});
it("status checks with no callback do not infer installation", () => {
  const t = setup({ tg: true });
  t.sdk.checkHomeScreenStatus.mockImplementation(() => {});
  t.browser.dispatchEvent(new Event("pageshow"));
  vi.advanceTimersByTime(2000);
  expect(t.state().available).toBe(true);
});
it("a browser dismissal consumes only that prompt, keeps a clickable fallback and accepts a new prompt", async () => {
  const t = setup();
  expect(t.state().available).toBe(false);
  const first = prompt(t.browser);
  expect(first.defaultPrevented).toBe(true);
  t.controller.install();
  await vi.advanceTimersByTimeAsync(0);
  expect(t.state()).toMatchObject({ available: true, installing: false });
  t.controller.install();
  expect(t.state().instructions).toBe("browser");
  expect(first.prompt).toHaveBeenCalledTimes(1);
  t.controller.closeInstructions();
  const second = prompt(t.browser);
  t.controller.install();
  expect(second.prompt).toHaveBeenCalledTimes(1);
});
it("accepted choice is not proof: timeout allows retry; appinstalled confirms", async () => {
  const t = setup();
  prompt(t.browser, "accepted");
  t.controller.install();
  await vi.advanceTimersByTimeAsync(0);
  expect(t.state()).toMatchObject({ available: true, installing: true });
  await vi.advanceTimersByTimeAsync(10000);
  expect(t.state()).toMatchObject({ available: true, installing: false });
  t.browser.dispatchEvent(new Event("appinstalled"));
  expect(t.state().available).toBe(false);
});
it("ignores a late result from a timed-out browser attempt during a new attempt", async () => {
  const t = setup();
  let resolve!: (v: { outcome: "dismissed" }) => void;
  prompt(
    t.browser,
    "dismissed",
    new Promise((r) => {
      resolve = r;
    }),
  );
  t.controller.install();
  await vi.advanceTimersByTimeAsync(10000);
  prompt(t.browser, "accepted");
  t.controller.install();
  resolve({ outcome: "dismissed" });
  await vi.advanceTimersByTimeAsync(0);
  expect(t.state().installing).toBe(true);
});
it.each(["iPhone Safari", "iPhone CriOS Safari", "iPad Safari"])(
  "offers manual Safari instructions on %s",
  (ua) => {
    const t = setup({ ua });
    expect(t.state().available).toBe(true);
    t.controller.install();
    expect(t.state().instructions).toBe("ios");
    expect(t.state().installing).toBe(false);
    t.controller.closeInstructions();
    t.controller.install();
    expect(t.state().instructions).toBe("ios");
  },
);
it("standalone hides the action and display-mode changes confirm installation", () => {
  const installed = setup({ mode: true, ua: "iPhone Safari" });
  expect(installed.state().available).toBe(false);
  const t = setup();
  prompt(t.browser);
  Object.assign(t.media, { matches: true });
  t.media.dispatchEvent(new Event("change"));
  expect(t.state().available).toBe(false);
});
it("browser prompt exceptions keep the action usable", async () => {
  const t = setup();
  const e = prompt(t.browser);
  vi.mocked(e.prompt).mockRejectedValue(Error("blocked"));
  t.controller.install();
  await vi.advanceTimersByTimeAsync(0);
  expect(t.state()).toMatchObject({ available: true, installing: false });
  t.controller.install();
  expect(t.state().instructions).toBe("browser");
});

it("prefers a native browser prompt even on iOS, then falls back to Safari instructions after dismissal", async () => {
  const t = setup({ ua: "iPhone Safari" });
  const event = prompt(t.browser);
  expect(t.state().kind).toBe("browser");
  t.controller.install();
  expect(event.prompt).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(0);
  t.controller.install();
  expect(t.state().instructions).toBe("ios");
});
it("does not forget a confirmed unsupported platform when a later status request stays silent", () => {
  const t = setup({ tg: true, status: "unsupported" });
  t.sdk.checkHomeScreenStatus.mockImplementation(() => {});
  t.browser.dispatchEvent(new Event("pageshow"));
  vi.advanceTimersByTime(2000);
  expect(t.state().available).toBe(false);
});
