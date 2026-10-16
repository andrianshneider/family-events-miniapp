"use client";
import {
  failure,
  telemetryHeaders,
  startAuthenticationAttempt,
  useAuthenticationFailure,
} from "@/lib/analytics/client";
import { InstallHelp } from "./install-help";
import Script from "next/script";
import { useEffect, useState } from "react";
import { isTelegramLaunch } from "@/lib/telegram-launch";
type TelegramWindow = Window & {
  Telegram?: {
    WebApp?: {
      initData?: string;
      ready(): void;
      expand(): void;
      close(): void;
    };
  };
};
export function LoginScreen({
  initialError = "",
  returnTo = "/events",
}: {
  initialError?: string;
  returnTo?: string;
}) {
  useAuthenticationFailure(!!initialError);
  const [pending, setPending] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState(initialError);
  const [restart, setRestart] = useState(false);
  const [miniLaunch, setMiniLaunch] = useState(false);
  useEffect(() => {
    // This is only SDK loading detection; identity is always established by the server.
    const mini = isTelegramLaunch(window);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMiniLaunch(mini);
    const sdkTimeout = window.setTimeout(() => setSdkReady(true), 15000);
    const restore = async () => {
      if (document.visibilityState !== "visible") return;
      setPending(false);
      try {
        const response = await fetch("/api/v1/me", {
          cache: "no-store",
          credentials: "same-origin",
          signal: AbortSignal.timeout(10000),
        });
        if (response.ok) window.location.replace(returnTo);
      } catch {
        // A failed connectivity check must leave the login action available.
      }
    };
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) void restore();
    };
    document.addEventListener("visibilitychange", restore);
    window.addEventListener("pageshow", show);
    return () => {
      window.clearTimeout(sdkTimeout);
      document.removeEventListener("visibilitychange", restore);
      window.removeEventListener("pageshow", show);
    };
  }, [returnTo]);
  async function signIn() {
    setPending(true);
    setError("");
    setRestart(false);
    const app = (window as TelegramWindow).Telegram?.WebApp;
    if (!app?.initData) {
      setPending(false);
      setError(
        "Не удалось загрузить данные Telegram. Закройте Mini App и снова откройте его через бота.",
      );
      setRestart(true);
      return;
    }
    try {
      const response = await fetch("/api/auth/telegram/mini-app", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...telemetryHeaders() },
        body: JSON.stringify({ initData: app.initData }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok) {
        if (
          ["INVALID_TELEGRAM_DATA", "TELEGRAM_DATA_REPLAYED"].includes(
            result.error?.code,
          )
        ) {
          setRestart(true);
          throw Error(
            "Данные входа устарели. Закройте Mini App и снова откройте его через бота Telegram.",
          );
        }
        throw Error(
          result.error?.message ?? "Не удалось войти. Повторите попытку.",
        );
      }
      window.location.replace(returnTo);
    } catch (e) {
      failure("authentication", crypto.randomUUID(), undefined, e);
      setError(e instanceof Error ? e.message : "Не удалось войти.");
      setPending(false);
    }
  }
  return (
    <main className="shell login">
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="afterInteractive"
        onError={() => setSdkReady(true)}
        onReady={() => {
          const app = (window as TelegramWindow).Telegram?.WebApp;
          app?.ready();
          app?.expand();
          setMiniLaunch(isTelegramLaunch(window));
          setSdkReady(true);
        }}
      />
      <div className="brand">
        <span aria-hidden="true">♡</span> Family Events
      </div>
      <h1>Соберите близких вместе</h1>
      <p className="muted">
        Планируйте семейные праздники и встречи. Войдите через Telegram, чтобы
        открыть свои события.
      </p>
      <a
        className="primary"
        href={
          "/api/auth/telegram/start?returnTo=" + encodeURIComponent(returnTo)
        }
        aria-disabled={pending || (miniLaunch && !sdkReady)}
        onClick={(event) => {
          const mini = isTelegramLaunch(window);
          if (pending || (mini && !sdkReady)) {
            event.preventDefault();
            return;
          }
          if (!mini) startAuthenticationAttempt();
          if (mini) {
            event.preventDefault();
            void signIn();
          }
        }}
      >
        {pending ? "Входим…" : "Войти через Telegram"}
      </a>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {restart && (
        <button
          className="secondary"
          onClick={() => (window as TelegramWindow).Telegram?.WebApp?.close()}
        >
          Закрыть Mini App
        </button>
      )}
      <p className="small muted">Ваши события доступны только вам.</p>
      <InstallHelp />
    </main>
  );
}
