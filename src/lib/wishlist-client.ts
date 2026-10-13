import { wishlistText } from "@/lib/wishlist-copy";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Wishlist } from "./wishlist";
import { watchEventChanges } from "./event-updates";
export class WishlistError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}
export async function wishlistApi<T>(path: string, init: RequestInit = {}) {
  try {
    const response = await fetch(path, {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      ...init,
    });
    const body = await response.json();
    if (!response.ok)
      throw new WishlistError(
        response.status,
        body.error?.code ?? "UNKNOWN",
        body.error?.message ?? wishlistText("Не удалось выполнить действие."),
        body.error?.fieldErrors,
      );
    return body.data as T;
  } catch (error) {
    if (error instanceof WishlistError) throw error;
    throw Error(
      wishlistText(
        "Не удалось выполнить запрос. Проверьте соединение и повторите попытку.",
      ),
    );
  }
}
export async function organizerMutation<T>(
  path: string,
  method: string,
  body: unknown,
  key: string,
) {
  const csrf = await wishlistApi<{ csrfToken: string }>("/api/auth/csrf");
  return wishlistApi<T>(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrf.csrfToken,
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
  });
}
export function useWishlist(
  key: string,
  owner: boolean,
  initial: Wishlist | null,
  preview = false,
) {
  const [data, setData] = useState(initial),
    [pending, setPending] = useState(!initial),
    [error, setError] = useState(
      initial
        ? ""
        : wishlistText("Не удалось загрузить wishlist. Повторите попытку."),
    ),
    [offline, setOffline] = useState(false),
    [unavailable, setUnavailable] = useState(false);
  const current = useRef(initial),
    flight = useRef(false),
    queued = useRef(false),
    generation = useRef(0);
  const path = `/api/v1/${owner ? "events" : "public/events"}/${key}/wishlist`;
  const clear = useCallback(() => {
    generation.current++;
    current.current = null;
    queued.current = false;
    setData(null);
    setUnavailable(true);
  }, []);
  const load = useCallback(
    async function refresh(more = false) {
      if (flight.current) {
        if (!more) queued.current = true;
        return;
      }
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      flight.current = true;
      // Background refresh keeps the existing list steady; only initial loading
      // and explicit pagination need a visible loading state.
      setPending(more || !current.current);
      const stamp = generation.current;
      const old = current.current,
        cursor = more ? old?.nextCursor : null;
      try {
        const result = await wishlistApi<Wishlist>(
          path +
            `?limit=${preview ? 3 : 20}` +
            (cursor ? "&cursor=" + cursor : ""),
          owner ? {} : { credentials: "omit" },
        );
        if (stamp !== generation.current) return;
        if (more && old && result.revision !== old.revision) {
          queued.current = true;
          return;
        }
        const kept =
          old && old.revision === result.revision
            ? more
              ? {
                  ...result,
                  gifts: [
                    ...old.gifts,
                    ...result.gifts.filter(
                      (g) => !old.gifts.some((o) => o.id === g.id),
                    ),
                  ],
                }
              : {
                  ...result,
                  gifts: old.gifts.map(
                    (g) => result.gifts.find((f) => f.id === g.id) ?? g,
                  ),
                  nextCursor: old.nextCursor,
                }
            : result;
        current.current = kept;
        setData(kept);
        setError("");
      } catch (caught) {
        if (stamp !== generation.current) return;
        if (
          caught instanceof WishlistError &&
          (caught.status === 401 || caught.status === 404)
        ) {
          current.current = null;
          setData(null);
          setUnavailable(true);
          queued.current = false;
          if (owner && caught.status === 401)
            window.location.replace(
              "/login?returnTo=" +
                encodeURIComponent(`/events/${key}/wishlist`),
            );
        } else
          setError(
            caught instanceof Error && caught.name !== "TimeoutError"
              ? caught.message
              : wishlistText(
                  "Не удалось загрузить wishlist. Проверьте соединение и повторите попытку.",
                ),
          );
      } finally {
        flight.current = false;
        setPending(false);
        if (queued.current) {
          queued.current = false;
          queueMicrotask(() => void refresh());
        }
      }
    },
    [key, owner, path, preview],
  );
  useEffect(() => {
    const network = () => setOffline(!navigator.onLine);
    network();
    const restore = () => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void load();
    };
    const show = (e: PageTransitionEvent) => {
      if (e.persisted) restore();
    };
    if (!initial) restore();
    document.addEventListener("visibilitychange", restore);
    window.addEventListener("pageshow", show);
    window.addEventListener("online", network);
    window.addEventListener("online", restore);
    window.addEventListener("offline", network);
    const timer = window.setInterval(restore, owner ? 5000 : 30000),
      stop = watchEventChanges(restore);
    return () => {
      document.removeEventListener("visibilitychange", restore);
      window.removeEventListener("pageshow", show);
      window.removeEventListener("online", network);
      window.removeEventListener("online", restore);
      window.removeEventListener("offline", network);
      window.clearInterval(timer);
      stop();
    };
  }, [initial, load, owner]);
  return { data, pending, error, offline, unavailable, load, clear };
}
