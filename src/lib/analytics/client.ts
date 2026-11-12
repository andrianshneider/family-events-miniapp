"use client";
import { useEffect, useRef } from "react";
import { standalone } from "../pwa";
import { isTelegramLaunch } from "../telegram-launch";
import type { EventName } from "./contract";
export type Locator = { kind: "public" | "management"; id: string };
let permitted = false,
  currentPath = "",
  navigationId = "";
const emitted = new Set<string>();
export function analyticsPermission(value: boolean) {
  permitted = value;
  if (!value) {
    try {
      sessionStorage.removeItem("fe-analytics-auth-attempt");
    } catch {}
  }
  window.dispatchEvent(new Event("fe-analytics-consent"));
}
export function clientPlatform() {
  return isTelegramLaunch(window)
    ? "telegram"
    : standalone(window)
      ? "pwa"
      : "web";
}
export function navigation() {
  if (currentPath !== window.location.pathname || !navigationId) {
    currentPath = window.location.pathname;
    navigationId = crypto.randomUUID();
  }
  return navigationId;
}
export async function capture(
  name: EventName,
  properties: Record<string, unknown>,
  locator?: Locator,
  id = crypto.randomUUID(),
) {
  if (!permitted || document.visibilityState !== "visible") return false;
  const occurredAt = new Date().toISOString();
  try {
    const response = await fetch("/api/analytics/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locator, platform: clientPlatform() }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404 && name === "operation_failed" && locator)
      return capture(name, properties, undefined, id);
    if (!response.ok) return false;
    const context = (await response.json()).data;
    if (!context.consent) return false;
    const props = {
      ...properties,
      ...(context.eventId ? { event_id: context.eventId } : {}),
      ...(name === "event_viewed"
        ? { actor_relation: context.actorRelation }
        : {}),
    };
    const result = await fetch("/api/analytics/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        id,
        occurredAt,
        platform: clientPlatform(),
        locator,
        properties: props,
      }),
      cache: "no-store",
      keepalive: true,
      signal: AbortSignal.timeout(5000),
    });
    return result.ok;
  } catch {
    return false;
  }
}
export function useAnalyticsView(
  name: "event_viewed" | "wishlist_viewed",
  locator: Locator,
  props: Record<string, unknown>,
  ready = true,
  preview = false,
) {
  const ref = useRef<HTMLElement | null>(null);
  const key = JSON.stringify([locator, props]);
  useEffect(() => {
    if (!ready) return;
    const parsedKey = JSON.parse(key);
    const nav = navigation(),
      dedup = `${nav}:${name}:${JSON.stringify([parsedKey[0], parsedKey[1].surface ?? parsedKey[1].view_mode])}`;
    let timer: ReturnType<typeof setTimeout> | undefined,
      inFlight = false,
      visible = !preview;
    const attempt = () => {
      if (
        !visible ||
        document.visibilityState !== "visible" ||
        emitted.has(dedup) ||
        inFlight
      )
        return;
      inFlight = true;
      void capture(
        name,
        { ...JSON.parse(key)[1], navigation_id: nav },
        JSON.parse(key)[0],
      )
        .then((ok) => {
          if (ok) emitted.add(dedup);
        })
        .finally(() => {
          inFlight = false;
        });
    };
    const restore = () => {
      if (preview) {
        clearTimeout(timer);
        if (visible && document.visibilityState === "visible")
          timer = setTimeout(attempt, 1000);
      } else attempt();
    };
    let observer: IntersectionObserver | undefined;
    if (preview && ref.current) {
      observer = new IntersectionObserver(
        (entries) => {
          visible = entries[0].intersectionRatio >= 0.5;
          restore();
        },
        { threshold: [0, 0.5] },
      );
      observer.observe(ref.current);
    } else restore();
    window.addEventListener("fe-analytics-consent", restore);
    document.addEventListener("visibilitychange", restore);
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener("fe-analytics-consent", restore);
      document.removeEventListener("visibilitychange", restore);
    };
  }, [name, key, ready, preview]);
  return ref;
}
export function telemetryHeaders(attempt?: string, form?: string) {
  return {
    "x-fe-platform": clientPlatform(),
    ...(attempt ? { "x-fe-attempt": attempt } : {}),
    ...(form ? { "x-fe-form": form } : {}),
  };
}
export function failure(
  operation:
    | "authentication"
    | "event_create"
    | "event_view"
    | "invitation_copy"
    | "rsvp_save"
    | "wishlist_view"
    | "gift_reserve",
  attempt: string,
  locator?: Locator,
  error?: unknown,
) {
  const timeout = error instanceof Error && /Timeout|Abort/.test(error.name);
  const raw =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  const allowed = [
    "VALIDATION_ERROR",
    "GIFT_ALREADY_RESERVED",
    "RSVP_VERSION_CONFLICT",
    "UNAUTHENTICATED",
    "EVENT_UNAVAILABLE",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
  ];
  const code = allowed.includes(raw)
    ? raw
    : timeout
      ? "TIMEOUT"
      : operation === "invitation_copy"
        ? "COPY_FAILED"
        : "NETWORK_ERROR";
  const key = `failure:${attempt}:${code}`;
  if (emitted.has(key) || !permitted) return;
  emitted.add(key);
  void capture(
    "operation_failed",
    {
      operation,
      attempt_id: attempt,
      error_code: code,
      outcome:
        allowed.includes(raw) || operation === "invitation_copy"
          ? "failed"
          : "unknown",
    },
    locator,
  );
}

export function resetClientAnalytics() {
  emitted.clear();
  currentPath = "";
  navigationId = "";
  try {
    sessionStorage.removeItem("fe-analytics-entry");
    sessionStorage.removeItem("fe-analytics-auth-attempt");
  } catch {}
}
export function useAnalyticsError(
  operation: "event_view" | "wishlist_view",
  visible: boolean,
  locator?: Locator,
) {
  const key = JSON.stringify(locator);
  useEffect(() => {
    if (!visible) return;
    const attempt = crypto.randomUUID();
    const send = () =>
      failure(operation, attempt, key ? JSON.parse(key) : undefined, {
        code: "EVENT_UNAVAILABLE",
      });
    send();
    window.addEventListener("fe-analytics-consent", send);
    return () => window.removeEventListener("fe-analytics-consent", send);
  }, [operation, visible, key]);
}
export function startAuthenticationAttempt() {
  if (!permitted) return;
  try {
    sessionStorage.setItem(
      "fe-analytics-auth-attempt",
      JSON.stringify({ id: crypto.randomUUID(), reported: false }),
    );
  } catch {}
}
export function useAuthenticationFailure(visible: boolean) {
  useEffect(() => {
    if (!visible) return;
    const send = () => {
      if (!permitted || document.visibilityState !== "visible") return;
      let saved: { id: string; reported: boolean };
      try {
        saved = JSON.parse(
          sessionStorage.getItem("fe-analytics-auth-attempt") ?? "null",
        );
        if (!saved?.id || saved.reported) return;
      } catch {
        return;
      }
      void capture(
        "operation_failed",
        {
          operation: "authentication",
          attempt_id: saved.id,
          error_code: "UNAUTHENTICATED",
          outcome: "failed",
        },
        undefined,
        saved.id,
      ).then((ok) => {
        if (ok)
          try {
            sessionStorage.setItem(
              "fe-analytics-auth-attempt",
              JSON.stringify({ ...saved, reported: true }),
            );
          } catch {}
      });
    };
    send();
    window.addEventListener("fe-analytics-consent", send);
    document.addEventListener("visibilitychange", send);
    return () => {
      window.removeEventListener("fe-analytics-consent", send);
      document.removeEventListener("visibilitychange", send);
    };
  }, [visible]);
}
