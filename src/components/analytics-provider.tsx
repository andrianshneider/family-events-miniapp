"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  clientPlatform,
  resetClientAnalytics,
  analyticsPermission,
  capture,
  navigation,
} from "@/lib/analytics/client";
export function AnalyticsProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  const [consent, setConsent] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const path = usePathname();
  useEffect(() => {
    if (!enabled) return;
    navigation();
    void fetch("/api/analytics/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: clientPlatform() }),
      cache: "no-store",
    })
      .then((r) => r.json())
      .then(({ data }) => {
        if (data.reset) resetClientAnalytics();
        analyticsPermission(data.consent === true);
        setConsent(
          data.choice === "denied" ? false : data.consent ? true : null,
        );
      })
      .catch(() => {});
  }, [enabled, path]);
  useEffect(() => {
    if (!consent) return;
    const enter = () => {
      if (document.visibilityState !== "visible") return;
      let id: string;
      try {
        const stored = sessionStorage.getItem("fe-analytics-entry");
        const old = stored ? JSON.parse(stored) : null;
        if (old?.until > Date.now()) return;
        id = crypto.randomUUID();
        sessionStorage.setItem(
          "fe-analytics-entry",
          JSON.stringify({ until: Date.now() + 30 * 60000, id }),
        );
      } catch {
        id = crypto.randomUUID();
      }
      void capture(
        "app_entered",
        {
          entry_point: window.location.pathname.includes("/wishlist")
            ? "wishlist"
            : window.location.pathname.endsWith("/notifications")
              ? "notification_settings"
              : window.location.pathname === "/events"
                ? "my_events"
                : window.location.pathname.startsWith("/e/")
                  ? "event"
                  : "unknown",
        },
        undefined,
        id,
      );
    };
    enter();
    document.addEventListener("visibilitychange", enter);
    return () => document.removeEventListener("visibilitychange", enter);
  }, [consent]);
  async function choose(allow: boolean) {
    setBusy(true);
    setError("");
    if (!allow) analyticsPermission(false);
    try {
      const response = await fetch("/api/analytics/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allow }),
        cache: "no-store",
      });
      if (!response.ok) throw Error();
      analyticsPermission(allow);
      setConsent(allow);
      try {
        sessionStorage.removeItem("fe-analytics-entry");
      } catch {}
    } catch {
      setError("Не удалось сохранить выбор. Повторите попытку.");
    } finally {
      setBusy(false);
    }
  }
  if (!enabled) return children;
  return (
    <>
      {children}
      <aside className="analytics-consent" aria-label="Настройки аналитики">
        {consent === null ? (
          <>
            <p>
              Разрешить аналитику использования? Она помогает улучшать Family
              Events. Содержимое событий, ответы и записи экрана не
              отправляются.
            </p>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void choose(false)}
            >
              Не разрешать
            </button>{" "}
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void choose(true)}
            >
              Разрешить
            </button>
          </>
        ) : (
          <details>
            <summary>Аналитика: {consent ? "разрешена" : "выключена"}</summary>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void choose(!consent)}
            >
              {consent ? "Отозвать согласие" : "Разрешить аналитику"}
            </button>
          </details>
        )}
        {error && <p role="alert">{error}</p>}
      </aside>
    </>
  );
}
