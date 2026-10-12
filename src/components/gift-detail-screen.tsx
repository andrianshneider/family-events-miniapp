"use client";
import { wishlistText } from "@/lib/wishlist-copy";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Gift } from "@/lib/wishlist";
import { giftPrice } from "@/lib/wishlist";
import { wishlistApi, WishlistError } from "@/lib/wishlist-client";
import { GiftImage } from "./gift-card";
import { TelegramBack } from "./telegram-back";
export function GiftDetailScreen({
  publicId,
  giftId,
  initial,
}: {
  publicId: string;
  giftId: string;
  initial: Gift | null;
}) {
  const router = useRouter();
  const [gift, setGift] = useState(initial),
    [pending, setPending] = useState(false),
    [error, setError] = useState(
      initial ? "" : wishlistText("Не удалось загрузить подарок."),
    ),
    [unavailable, setUnavailable] = useState(false),
    [offline, setOffline] = useState(false);
  const flight = useRef(false);
  const load = useCallback(async () => {
    if (flight.current || !navigator.onLine) return;
    flight.current = true;
    setPending(true);
    try {
      setGift(
        await wishlistApi<Gift>(
          `/api/v1/public/events/${publicId}/gifts/${giftId}`,
          { credentials: "omit" },
        ),
      );
      setError("");
    } catch (e) {
      if (e instanceof WishlistError && e.status === 404) {
        setGift(null);
        setUnavailable(true);
      } else
        setError(
          wishlistText("Не удалось обновить подарок. Повторите попытку."),
        );
    } finally {
      flight.current = false;
      setPending(false);
    }
  }, [giftId, publicId]);
  useEffect(() => {
    const network = () => setOffline(!navigator.onLine);
    network();
    const restore = () => {
      if (document.visibilityState === "visible") void load();
    };
    const show = (e: PageTransitionEvent) => {
      if (e.persisted) restore();
    };
    if (!initial) restore();
    document.addEventListener("visibilitychange", restore);
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    window.addEventListener("online", restore);
    window.addEventListener("pageshow", show);
    const t = setInterval(restore, 30000);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", restore);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
      window.removeEventListener("online", restore);
      window.removeEventListener("pageshow", show);
    };
  }, [load, initial]);
  return (
    <main className="shell event-shell gift-detail-shell">
      <TelegramBack onBack={() => router.push(`/e/${publicId}/wishlist`)} />
      <header className="top">
        <div className="brand">
          <span aria-hidden="true">♡</span>Family Events
        </div>
      </header>
      <Link className="text-button back" href={`/e/${publicId}/wishlist`}>
        {wishlistText("← К wishlist")}
      </Link>
      {offline && (
        <p className="notice">
          {wishlistText("Нет соединения. Показаны ранее загруженные сведения.")}
        </p>
      )}
      {error && (
        <div role="alert" className="error">
          <p>{error}</p>
          <button
            className="secondary"
            disabled={offline || pending}
            onClick={load}
          >
            {wishlistText("Попробовать снова")}
          </button>
        </div>
      )}
      {pending && <p role="status">{wishlistText("Обновляем подарок…")}</p>}
      {unavailable ? (
        <>
          <h1>{wishlistText("Подарок недоступен")}</h1>
          <p>{wishlistText("Он был удалён или событие больше недоступно.")}</p>
          <Link
            href={`/e/${publicId}/wishlist`}
            className="secondary route-link"
          >
            {wishlistText("Посмотреть другие подарки")}
          </Link>
        </>
      ) : (
        gift && (
          <article className="panel gift-detail">
            <GiftImage gift={gift} />
            <div>
              <h1>{gift.title}</h1>
              {giftPrice(gift) && (
                <p className="gift-price">{giftPrice(gift)}</p>
              )}
              <p>
                {gift.reserved
                  ? wishlistText("✓ Уже выбран")
                  : wishlistText("Свободен")}
              </p>
              {gift.comment && <p className="gift-comment">{gift.comment}</p>}
              {gift.externalUrl && (
                <a
                  className="primary"
                  href={gift.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {wishlistText("Посмотреть подарок (новая вкладка)")}
                </a>
              )}
            </div>
          </article>
        )
      )}
    </main>
  );
}
