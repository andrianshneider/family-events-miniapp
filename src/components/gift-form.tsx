"use client";
import { wishlistText } from "@/lib/wishlist-copy";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { giftInput } from "@/lib/validation";
import type { Gift } from "@/lib/wishlist";
import { uploadGiftImage, type GiftUpload } from "@/lib/gift-upload";
import { organizerMutation, WishlistError } from "@/lib/wishlist-client";
type Fields = ReturnType<typeof giftInput.parse>;
type Attempt = { key: string; body: unknown };
export function GiftForm({
  eventId,
  gift,
  onClose,
  onSaved,
  onAuth,
  onBusy,
  onUncertain,
}: {
  eventId: string;
  gift: Gift | null;
  onClose: () => void;
  onSaved: () => void;
  onAuth: () => void;
  onBusy: (busy: boolean) => void;
  onUncertain: (uncertain: boolean) => void;
}) {
  const [title, setTitle] = useState(gift?.title ?? ""),
    [amount, setAmount] = useState(gift?.amount ?? ""),
    [currency, setCurrency] = useState(gift?.currency ?? "RUB"),
    [url, setUrl] = useState(gift?.externalUrl ?? ""),
    [comment, setComment] = useState(gift?.comment ?? "");
  const [asset, setAsset] = useState<string | null>(gift?.imageAssetId ?? null),
    [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<string | null>(null),
    [pending, setPending] = useState(false),
    [offline, setOffline] = useState(false),
    [error, setError] = useState(""),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [attempt, setAttempt] = useState<Attempt | null>(null),
    [conflict, setConflict] = useState(false);
  const busy = useRef(false),
    form = useRef<HTMLFormElement>(null),
    prepared = useRef<GiftUpload | null>(null);
  useEffect(() => {
    const change = () => setOffline(!navigator.onLine);
    change();
    window.addEventListener("online", change);
    window.addEventListener("offline", change);
    return () => {
      window.removeEventListener("online", change);
      window.removeEventListener("offline", change);
    };
  }, []);
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);
  function choose(next: File | undefined) {
    if (!next) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(next.type) ||
      next.size < 1 ||
      next.size > 10485760
    ) {
      setError(
        wishlistText("Выберите JPG, PNG или WebP до 10 Мб и 20 мегапикселей."),
      );
      return;
    }
    setFile(next);
    setPreview(URL.createObjectURL(next));
    prepared.current = null;
    setError("");
  }
  async function uploadImage() {
    if (!file) return asset;
    const assetId = await uploadGiftImage(file, prepared);
    setAsset(assetId);
    return assetId;
  }
  async function save() {
    if (busy.current || offline || conflict) return;
    let op = attempt,
      sent = false;
    const parsed = giftInput.safeParse({
      title,
      externalUrl: url.trim() || null,
      amount: amount.trim() ? amount.trim().replace(",", ".") : null,
      currency: amount.trim() ? currency : null,
      comment: comment.trim() || null,
      imageAssetId: asset,
    });
    if (!op && !parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues)
        fields[String(issue.path[0])] =
          (
            {
              title: wishlistText("Введите название от 2 до 120 символов."),
              amount: wishlistText(
                "Укажите положительную цену с точностью до копеек.",
              ),
              currency: wishlistText("Выберите валюту."),
              externalUrl: wishlistText(
                "Укажите HTTP/HTTPS ссылку без логина и пароля.",
              ),
              comment: wishlistText("Комментарий — до 300 символов."),
            } as Record<string, string>
          )[String(issue.path[0])] ?? wishlistText("Проверьте поле.");
      setErrors(fields);
      form.current
        ?.querySelector<HTMLElement>(`[name="${Object.keys(fields)[0]}"]`)
        ?.focus();
      return;
    }
    busy.current = true;
    setPending(true);
    onBusy(true);
    setError("");
    setErrors({});
    try {
      if (!op) {
        const fields: Fields = {
          ...parsed.data!,
          imageAssetId: await uploadImage(),
        };
        op = {
          key: crypto.randomUUID(),
          body: gift ? { expectedVersion: gift.version, fields } : fields,
        };
      }
      setAttempt(op);
      onUncertain(true);
      sent = true;
      await organizerMutation(
        `/api/v1/events/${eventId}/gifts${gift ? "/" + gift.id : ""}`,
        gift ? "PATCH" : "POST",
        op.body,
        op.key,
      );
      setAttempt(null);
      onUncertain(false);
      onSaved();
    } catch (caught) {
      if (caught instanceof WishlistError) {
        if (caught.status === 401) {
          onAuth();
          return;
        }
        if (
          [400, 403, 404, 422, 429].includes(caught.status) ||
          caught.code === "VERSION_CONFLICT"
        ) {
          setAttempt(null);
          onUncertain(false);
          sent = false;
        }
        if (caught.code === "VERSION_CONFLICT") setConflict(true);
        if (caught.fields)
          setErrors(
            Object.fromEntries(
              Object.entries(caught.fields).map(([key, values]) => [
                key,
                values.join(" "),
              ]),
            ),
          );
      }
      setError(
        sent
          ? wishlistText(
              "Результат сохранения пока неизвестен. Нажмите «Проверить сохранение», чтобы повторить ту же операцию без дубля.",
            )
          : caught instanceof Error && caught.name !== "TimeoutError"
            ? caught.message
            : wishlistText(
                "Не удалось сохранить подарок. Поля сохранены; повторите попытку.",
              ),
      );
    } finally {
      busy.current = false;
      setPending(false);
      onBusy(false);
    }
  }
  const disabled = pending || Boolean(attempt);
  return (
    <form
      ref={form}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2 id="wishlist-dialog-title">
        {gift
          ? wishlistText("Редактировать подарок")
          : wishlistText("Добавить подарок")}
      </h2>
      {offline && (
        <p className="notice">
          {wishlistText("Нет соединения. Отправка доступна после подключения.")}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {conflict && (
        <p>
          {wishlistText(
            "Закройте форму и откройте подарок заново, чтобы загрузить актуальные значения. Текущие изменения не отправлены.",
          )}
        </p>
      )}
      <fieldset disabled={disabled} className="gift-fields">
        <label className="field">
          {wishlistText("Название")}
          <input
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-invalid={Boolean(errors.title)}
            aria-describedby="gift-title-error"
            autoFocus
          />
          <span className="error" id="gift-title-error">
            {errors.title}
          </span>
        </label>
        <label className="field">
          {wishlistText("Фото")}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => choose(e.target.files?.[0])}
          />
          <span className="hint">
            {wishlistText(
              "JPG/PNG/WebP, до 10 Мб и 20 мегапикселей. Проверим изображение на сервере.",
            )}
          </span>
        </label>
        {(preview || asset) && (
          <div className="gift-form-photo">
            {/* Local selected file only; server URLs are owner protected. */}
            <Image
              unoptimized
              width={480}
              height={640}
              src={preview ?? `/api/v1/media/${asset}`}
              alt={wishlistText("Фото подарка")}
            />
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setFile(null);
                setPreview(null);
                setAsset(null);
                prepared.current = null;
              }}
            >
              {wishlistText("Убрать фото")}
            </button>
          </div>
        )}
        {errors.imageAssetId && (
          <p className="error" role="alert">
            {errors.imageAssetId}
          </p>
        )}
        <label className="field">
          {wishlistText("Ссылка")}
          <input
            name="externalUrl"
            type="text"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-invalid={Boolean(errors.externalUrl)}
            aria-describedby="gift-url-error"
          />
          <span className="error" id="gift-url-error">
            {errors.externalUrl}
          </span>
        </label>
        <div className="gift-money">
          <label className="field">
            {wishlistText("Цена")}
            <input
              name="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={Boolean(errors.amount)}
              aria-describedby="gift-amount-error"
            />
            <span className="error" id="gift-amount-error">
              {errors.amount}
            </span>
          </label>
          <label className="field">
            {wishlistText("Валюта")}
            <select
              name="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as typeof currency)}
            >
              {["RUB", "EUR", "USD"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <span className="error">{errors.currency}</span>
          </label>
        </div>
        <label className="field">
          {wishlistText("Комментарий")}
          <textarea
            name="comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            aria-invalid={Boolean(errors.comment)}
            aria-describedby="gift-comment-error"
          />
          <span className="hint">{[...comment].length} / 300</span>
          <span className="error" id="gift-comment-error">
            {errors.comment}
          </span>
        </label>
      </fieldset>
      <div className="gift-dialog-actions">
        <button className="primary" disabled={pending || offline || conflict}>
          {pending
            ? wishlistText("Сохраняем…")
            : attempt
              ? wishlistText("Проверить сохранение")
              : gift
                ? wishlistText("Сохранить")
                : wishlistText("Добавить подарок")}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={pending}
          onClick={onClose}
        >
          {wishlistText("Отмена")}
        </button>
      </div>
    </form>
  );
}
