"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { iphoneSafari, standalone, type InstallPrompt } from "@/lib/pwa";
import { isTelegramLaunch } from "@/lib/telegram-launch";
const Context = createContext<{
  prompt: InstallPrompt | null;
  ios: boolean;
  hidden: boolean;
  installing: boolean;
  error: string;
  install(): void;
}>({
  prompt: null,
  ios: false,
  hidden: true,
  installing: false,
  error: "",
  install() {},
});
export const usePwa = () => useContext(Context);
export function PwaProvider({ children }: { children: React.ReactNode }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [ios, setIos] = useState(false),
    [hidden, setHidden] = useState(true);
  const [offline, setOffline] = useState(false),
    [installing, setInstalling] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let installed = false,
      registration: ServiceWorkerRegistration | undefined;
    const sync = () => {
      setHidden(installed || standalone(window) || isTelegramLaunch(window));
      setIos(iphoneSafari(navigator));
      setOffline(!navigator.onLine);
    };
    const before = (event: Event) => {
      if (standalone(window) || isTelegramLaunch(window)) return;
      event.preventDefault();
      setPrompt(event as InstallPrompt);
      sync();
    };
    const done = () => {
      installed = true;
      setPrompt(null);
      sync();
    };
    const restore = () => {
      if (document.visibilityState !== "visible") return;
      sync();
      if (navigator.onLine) void registration?.update().catch(() => {});
    };
    const display = window.matchMedia("(display-mode: standalone)");
    sync();
    window.addEventListener("beforeinstallprompt", before);
    window.addEventListener("appinstalled", done);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    window.addEventListener("pageshow", restore);
    document.addEventListener("visibilitychange", restore);
    display.addEventListener("change", sync);
    if ("serviceWorker" in navigator && window.isSecureContext) {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((value) => {
          registration = value;
          return value.update();
        })
        .catch(() => {});
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", before);
      window.removeEventListener("appinstalled", done);
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      window.removeEventListener("pageshow", restore);
      document.removeEventListener("visibilitychange", restore);
      display.removeEventListener("change", sync);
    };
  }, []);
  function install() {
    if (!prompt || installing) return;
    setInstalling(true);
    setError("");
    // Invoke synchronously in the click handler to preserve browser user activation.
    const current = prompt;
    setPrompt(null);
    try {
      void current
        .prompt()
        .then(() => current.userChoice)
        .catch(() => {
          setError(
            "Не удалось открыть установку. Попробуйте через меню браузера.",
          );
        })
        .finally(() => setInstalling(false));
    } catch {
      setError("Не удалось открыть установку. Попробуйте через меню браузера.");
      setInstalling(false);
    }
  }
  return (
    <Context.Provider
      value={{ prompt, ios, hidden, installing, error, install }}
    >
      {offline && (
        <div className="connection-notice" role="status">
          Нет подключения к интернету. Изменения можно сохранить после
          восстановления связи.
        </div>
      )}
      {children}
    </Context.Provider>
  );
}
