import { iosDevice, standalone, type InstallPrompt } from "./pwa";
import { isTelegramLaunch } from "./telegram-launch";
import { pwaText } from "./pwa-copy";
export type InstallState = {
  available: boolean;
  kind: "telegram" | "browser" | "ios" | null;
  installing: boolean;
  message: string;
  instructions: "ios" | "browser" | null;
};
type HomeStatus = "unsupported" | "unknown" | "added" | "missed";
type TelegramHome = {
  isVersionAtLeast?(version: string): boolean;
  checkHomeScreenStatus?(callback: (status: HomeStatus) => void): void;
  addToHomeScreen?(): void;
  onEvent?(
    name: string,
    handler: (data?: { status?: HomeStatus; error?: string }) => void,
  ): void;
  offEvent?(
    name: string,
    handler: (data?: { status?: HomeStatus; error?: string }) => void,
  ): void;
};
export const initialInstallState: InstallState = {
  available: false,
  kind: null,
  installing: false,
  message: "",
  instructions: null,
};
/** One lifecycle shared by all install surfaces; no persisted guesses about installation. */
export function homeInstall(
  browser: Window,
  publish: (state: InstallState) => void,
) {
  let state = { ...initialInstallState },
    disposed = false,
    installed = false,
    prompt: InstallPrompt | null = null,
    supportedBrowser = false;
  let attempt = 0;
  let knownStatus: HomeStatus | undefined;
  let telegram: TelegramHome | undefined;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined,
    checkTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners: [
    string,
    (data?: { status?: HomeStatus; error?: string }) => void,
  ][] = [];
  const update = (patch: Partial<InstallState>) => {
    if (!disposed) {
      state = { ...state, ...patch };
      publish(state);
    }
  };
  const stopPending = () => {
    clearTimeout(pendingTimer);
    pendingTimer = undefined;
  };
  const confirmed = () => {
    attempt++;
    installed = true;
    prompt = null;
    stopPending();
    clearTimeout(checkTimer);
    update({
      available: false,
      installing: false,
      message: "",
      instructions: null,
    });
  };
  const failed = (data?: { error?: string }) => {
    if (installed) return;
    attempt++;
    stopPending();
    update({
      installing: false,
      message:
        data?.error === "cancelled" || data?.error === "canceled"
          ? pwaText("cancelled")
          : pwaText("unconfirmed"),
    });
  };
  const status = (value: HomeStatus) => {
    if (!["unsupported", "unknown", "added", "missed"].includes(value)) return;
    knownStatus = value;
    clearTimeout(checkTimer);
    if (installed || disposed) return;
    if (value === "added") {
      confirmed();
      return;
    }
    if (value === "unsupported") {
      stopPending();
      update({
        kind: "telegram",
        available: false,
        installing: false,
        instructions: null,
      });
      return;
    }
    if (value === "unknown" || value === "missed")
      update({ kind: "telegram", available: true });
  };
  const check = () => {
    if (!telegram?.checkHomeScreenStatus || installed) return;
    clearTimeout(checkTimer);
    checkTimer = setTimeout(() => {
      if (knownStatus !== "unsupported")
        update({ kind: "telegram", available: true });
    }, 2000);
    try {
      telegram.checkHomeScreenStatus(status);
    } catch {
      clearTimeout(checkTimer);
      update({ available: false });
    }
  };
  const attachTelegram = () => {
    const api = (browser as Window & { Telegram?: { WebApp?: TelegramHome } })
      .Telegram?.WebApp;
    if (
      !api?.checkHomeScreenStatus ||
      !api.addToHomeScreen ||
      !api.onEvent ||
      !api.offEvent ||
      api.isVersionAtLeast?.("8.0") === false
    ) {
      update({ kind: "telegram", available: false });
      return;
    }
    if (telegram !== api) {
      telegram = api;
      listeners.push(
        ["homeScreenAdded", confirmed],
        ["homeScreenFailed", failed],
        [
          "homeScreenChecked",
          (data) => {
            if (data?.status) status(data.status);
          },
        ],
      );
      for (const [name, fn] of listeners) api.onEvent(name, fn);
    }
    check();
  };
  const sync = () => {
    if (installed || standalone(browser)) {
      confirmed();
      return;
    }
    if (isTelegramLaunch(browser)) {
      prompt = null;
      attachTelegram();
    } else {
      const ios = iosDevice(browser.navigator);
      update({
        kind: prompt ? "browser" : ios ? "ios" : "browser",
        available: ios || supportedBrowser,
      });
    }
  };
  const before = (event: Event) => {
    if (installed || standalone(browser) || isTelegramLaunch(browser)) return;
    event.preventDefault();
    prompt = event as InstallPrompt;
    supportedBrowser = true;
    sync();
  };
  const restore = () => {
    if (browser.document.visibilityState === "visible") sync();
  };
  const media = browser.matchMedia("(display-mode: standalone)");
  browser.addEventListener("beforeinstallprompt", before);
  browser.addEventListener("appinstalled", confirmed);
  browser.addEventListener("pageshow", restore);
  browser.document.addEventListener("visibilitychange", restore);
  media.addEventListener("change", sync);
  sync();
  // SDK can arrive after hydration. Stop polling once attached or after 15 seconds.
  const started = Date.now();
  const sdkTimer = setInterval(() => {
    if (telegram || Date.now() - started > 15000) {
      clearInterval(sdkTimer);
      return;
    }
    if (isTelegramLaunch(browser)) sync();
  }, 250);
  function install() {
    if (disposed || installed || !state.available || state.installing) return;
    if (standalone(browser)) {
      confirmed();
      return;
    }
    update({ message: "" });
    if (state.kind === "ios") {
      update({ instructions: "ios" });
      return;
    }
    if (state.kind === "browser" && !prompt) {
      update({
        instructions: iosDevice(browser.navigator) ? "ios" : "browser",
      });
      return;
    }
    update({ installing: true });
    const request = ++attempt;
    pendingTimer = setTimeout(() => {
      if (!installed && request === attempt) {
        attempt++;
        update({ installing: false, message: pwaText("unconfirmed") });
      }
    }, 10000);
    try {
      if (state.kind === "telegram") {
        // Native action must stay in the click's activation frame, without awaiting a status request.
        telegram!.addToHomeScreen!();
      } else {
        const current = prompt!;
        prompt = null;
        void Promise.resolve(current.prompt())
          .then(() => current.userChoice)
          .then((choice) => {
            if (disposed || installed || request !== attempt) return;
            if (choice.outcome === "dismissed") {
              stopPending();
              update({ installing: false, message: pwaText("cancelled") });
            }
            // Acceptance is not installation proof: wait for appinstalled/display-mode.
          })
          .catch(() => {
            if (!installed && request === attempt) {
              stopPending();
              update({ installing: false, message: pwaText("failed") });
            }
          });
      }
    } catch {
      stopPending();
      update({ installing: false, message: pwaText("failed") });
    }
  }
  return {
    install,
    closeInstructions: () => update({ instructions: null }),
    dispose() {
      if (disposed) return;
      disposed = true;
      stopPending();
      clearTimeout(checkTimer);
      clearInterval(sdkTimer);
      browser.removeEventListener("beforeinstallprompt", before);
      browser.removeEventListener("appinstalled", confirmed);
      browser.removeEventListener("pageshow", restore);
      browser.document.removeEventListener("visibilitychange", restore);
      media.removeEventListener("change", sync);
      for (const [name, fn] of listeners) telegram?.offEvent?.(name, fn);
    },
  };
}
