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
type AnalyticsContext = {
  data: { reset?: boolean; consent?: boolean; choice?: string };
};
let loadingContext: Promise<AnalyticsContext> | null = null;
function loadContext() {
  // Share an in-flight bootstrap across navigation/Strict Mode, so a fresh
  // browser receives one anonymous identity before any client captures start.
  return (loadingContext ??= fetch("/api/analytics/context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform: clientPlatform() }),
    cache: "no-store",
  })
    .then((response) => {
      if (!response.ok) throw Error("Analytics context unavailable");
      return response.json() as Promise<AnalyticsContext>;
    })
    .finally(() => {
      loadingContext = null;
    }));
}
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
    let current = true;
    void loadContext()
      .then(({ data }) => {
        if (!current) return;
        if (data.reset) resetClientAnalytics();
        analyticsPermission(data.consent === true);
        setConsent(data.choice === "denied" ? false : data.consent === true);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
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
  if (!enabled || consent === null) return children;
  return (
    <>
      {children}
      <aside className="analytics-settings" aria-label="Настройки аналитики">
        <details>
          <summary>Настройки аналитики</summary>
          <p>
            Аналитика {consent ? "включена" : "выключена"}. Имена, тексты,
            адреса и записи экрана не отправляются.
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void choose(!consent)}
          >
            {consent ? "Отключить аналитику" : "Включить аналитику"}
          </button>
          {error && <p role="alert">{error}</p>}
        </details>
      </aside>
    </>
  );
}
