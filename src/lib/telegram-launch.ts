type LaunchWindow = {
  location: { hash: string };
  Telegram?: { WebApp?: { initData?: string } };
  TelegramWebviewProxy?: unknown;
  external?: unknown;
  sessionStorage: Pick<Storage, "getItem">;
};

// These hints choose the login UI only. Identity always comes from validated SDK initData.
// The official SDK keeps launch parameters in its own session store across page navigation.
export function isTelegramLaunch(browser: LaunchWindow): boolean {
  if (
    browser.Telegram?.WebApp?.initData ||
    new URLSearchParams(browser.location.hash.slice(1)).has("tgWebAppData") ||
    browser.TelegramWebviewProxy ||
    typeof (browser.external as { notify?: unknown } | undefined)?.notify ===
      "function"
  )
    return true;
  try {
    const cached = JSON.parse(
      browser.sessionStorage.getItem("__telegram__initParams") ?? "null",
    );
    return (
      typeof cached?.tgWebAppData === "string" && cached.tgWebAppData.length > 0
    );
  } catch {
    return false;
  }
}
