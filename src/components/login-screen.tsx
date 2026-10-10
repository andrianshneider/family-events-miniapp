"use client";
import Script from "next/script";
import { useState } from "react";
type TelegramWindow = Window & {
  Telegram?: { WebApp?: { initData?: string; ready(): void; expand(): void } };
};
export function LoginScreen() {
  const [pending, setPending] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState("");
  async function signIn() {
    setPending(true);
    setError("");
    const app = (window as TelegramWindow).Telegram?.WebApp;
    if (!app?.initData) {
      window.location.assign(
        new URL(
          "/api/auth/telegram/start?returnTo=/events",
          window.location.origin,
        ).href,
      );
      return;
    }
    try {
      const response = await fetch("/api/auth/telegram/mini-app", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: app.initData }),
      });
      const result = await response.json();
      if (!response.ok)
        throw Error(
          result.error?.message ?? "Не удалось войти. Повторите попытку.",
        );
      window.location.replace("/events");
    } catch (e) {
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
      <button
        className="primary"
        onClick={signIn}
        disabled={pending || !sdkReady}
      >
        {pending ? "Входим…" : "Войти через Telegram"}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p className="small muted">Ваши события доступны только вам.</p>
    </main>
  );
}
