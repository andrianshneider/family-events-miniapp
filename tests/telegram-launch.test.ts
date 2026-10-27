import { it, expect } from "vitest";
import { isTelegramLaunch } from "@/lib/telegram-launch";

it("keeps Mini App login after navigation removes the original URL hash", () => {
  let cached: string | null = null;
  const browser = {
    location: { hash: "#tgWebAppData=signed-launch" },
    sessionStorage: { getItem: () => cached },
  };
  expect(isTelegramLaunch(browser)).toBe(true);
  // The official SDK saves these launch parameters; our code only reads a routing hint.
  cached = JSON.stringify({ tgWebAppData: "signed-launch" });
  browser.location.hash = "";
  expect(isTelegramLaunch(browser)).toBe(true);
});

it("keeps ordinary Safari on Web login without requiring the SDK", () => {
  const browser = {
    location: { hash: "" },
    sessionStorage: { getItem: () => null },
  };
  expect(isTelegramLaunch(browser)).toBe(false);
  expect(
    isTelegramLaunch({ ...browser, Telegram: { WebApp: { initData: "" } } }),
  ).toBe(false);
});

it("recognizes live SDK data or a native bridge before SDK initialization", () => {
  const browser = {
    location: { hash: "" },
    sessionStorage: { getItem: () => null },
  };
  expect(
    isTelegramLaunch({
      ...browser,
      Telegram: { WebApp: { initData: "launch" } },
    }),
  ).toBe(true);
  expect(
    isTelegramLaunch({ ...browser, TelegramWebviewProxy: { postEvent() {} } }),
  ).toBe(true);
  expect(isTelegramLaunch({ ...browser, external: { notify() {} } })).toBe(
    true,
  );
});

it("handles blocked or malformed SDK session storage without crashing", () => {
  for (const cached of [
    "not-json",
    "null",
    "{}",
    '{"tgWebAppData":123}',
    '{"tgWebAppData":""}',
  ]) {
    expect(
      isTelegramLaunch({
        location: { hash: "" },
        sessionStorage: { getItem: () => cached },
      }),
    ).toBe(false);
  }
  expect(
    isTelegramLaunch({
      location: { hash: "" },
      sessionStorage: {
        getItem: () => {
          throw Error("blocked");
        },
      },
    }),
  ).toBe(false);
});
