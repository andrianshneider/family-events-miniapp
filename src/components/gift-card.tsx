"use client";
import { wishlistText } from "@/lib/wishlist-copy";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { giftPrice, type Gift } from "@/lib/wishlist";
export function GiftImage({ gift }: { gift: Gift }) {
  const [failed, setFailed] = useState<string | null>(null),
    [retry, setRetry] = useState(0);
  return (
    <div className="gift-picture">
      {gift.imageUrl && failed !== gift.imageUrl ? (
        <Image
          key={`${gift.imageUrl}:${retry}`}
          unoptimized
          src={gift.imageUrl}
          width={480}
          height={640}
          alt={wishlistText("Фото подарка «{0}»", [gift.title])}
          onError={() => setFailed(gift.imageUrl)}
        />
      ) : (
        <>
          <span aria-hidden="true">🎁</span>
          {gift.imageUrl && (
            <button
              className="text-button"
              onClick={() => {
                setFailed(null);
                setRetry(retry + 1);
              }}
            >
              {wishlistText("Повторить загрузку фото")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
export function GiftCard({
  gift,
  publicId,
  actions,
  showName = false,
}: {
  gift: Gift;
  publicId?: string;
  actions?: React.ReactNode;
  showName?: boolean;
}) {
  return (
    <article className="gift-card">
      <GiftImage gift={gift} />
      <div className="gift-body">
        <h2>
          {publicId ? (
            <Link
              href={`/e/${publicId}/wishlist/${gift.id}`}
              aria-label={wishlistText("Детали подарка: {0}", [gift.title])}
            >
              {gift.title}
            </Link>
          ) : (
            gift.title
          )}
        </h2>
        {giftPrice(gift) && <p className="gift-price">{giftPrice(gift)}</p>}
        <p className="gift-status">
          {gift.reserved
            ? wishlistText("✓ Уже выбран")
            : wishlistText("Свободен")}
        </p>
        {showName && gift.reserverDisplayName && (
          <p>
            {wishlistText("Выбрал(а): ")}
            {gift.reserverDisplayName}
          </p>
        )}
        {!publicId && gift.comment && (
          <p className="gift-comment">{gift.comment}</p>
        )}
        {gift.externalUrl && (
          <a
            className="text-button"
            href={gift.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {wishlistText("Посмотреть подарок ")}
            <span className="hint">{wishlistText("(новая вкладка)")}</span>
          </a>
        )}
        {actions}
      </div>
    </article>
  );
}
