"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { wishlistApi, WishlistError } from "@/lib/wishlist-client";
type Settings = {
  eventTitle: string;
  enabled: boolean;
  linkedName: string | null;
  channel: string;
  handoff: { id: string; state: string } | null;
};
type Proof = {
  id: string;
  state: string;
  accountName: string | null;
  conflicts: {
    event_id: string;
    title: string;
    current_name: string;
    current_status: string;
    telegram_name: string;
    telegram_status: string;
    current_version: number;
    telegram_version: number;
  }[];
};
const labels: Record<string, string> = {
  yes: "Буду",
  no: "Не буду",
  maybe: "Пока не знаю",
};
async function mutate<T>(path: string, method: string, body: unknown) {
  const csrf = await wishlistApi<{ csrfToken: string }>(
    "/api/auth/csrf?context=guest",
  );
  return wishlistApi<T>(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrf.csrfToken,
    },
    body: JSON.stringify(body),
  });
}
export function GuestNotificationsScreen({ publicId }: { publicId: string }) {
  const base = `/api/v1/public/events/${publicId}`;
  const [data, setData] = useState<Settings | null>(null),
    [proof, setProof] = useState<Proof | null>(null),
    [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [choices, setChoices] = useState<Record<string, "current" | "telegram">>(
      {},
    );
  const flight = useRef(false);
  const load = useCallback(async () => {
    if (flight.current) return;
    flight.current = true;
    try {
      const s = await wishlistApi<Settings>(
        base + "/notification-subscription",
      );
      setData(s);
      if (
        s.handoff &&
        ["pending", "verified", "expired"].includes(s.handoff.state)
      )
        setProof(
          await wishlistApi<Proof>(
            base + "/notification-handoff/" + s.handoff.id,
          ),
        );
      else setProof(null);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось проверить подключение.",
      );
      if (e instanceof WishlistError && e.status === 401) {
        setData(null);
        setProof(null);
        setUrl("");
      }
    } finally {
      flight.current = false;
    }
  }, [base]);
  useEffect(() => {
    const restore = () => {
      if (document.visibilityState === "visible") void load();
    };
    restore();
    const t = setInterval(restore, 5000);
    window.addEventListener("pageshow", restore);
    window.addEventListener("online", restore);
    document.addEventListener("visibilitychange", restore);
    return () => {
      clearInterval(t);
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("online", restore);
      document.removeEventListener("visibilitychange", restore);
    };
  }, [load]);
  async function action(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Не удалось сохранить. Повторите попытку.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    await action(async () => {
      if (data?.linkedName && data.channel === "ready") {
        await mutate(base + "/notification-subscription", "PUT", {
          enabled: true,
        });
        return;
      }
      const app = (
        window as Window & {
          Telegram?: {
            WebApp?: {
              initData?: string;
              requestWriteAccess?: (cb: (allowed: boolean) => void) => void;
            };
          };
        }
      ).Telegram?.WebApp;
      if (app?.initData && app.requestWriteAccess) {
        const allowed = await new Promise<boolean>((resolve, reject) => {
          const timeout = setTimeout(
            () =>
              reject(
                Error(
                  "Запрос разрешения не завершился. Повторите подключение.",
                ),
              ),
            30000,
          );
          app.requestWriteAccess!((allowed) => {
            clearTimeout(timeout);
            resolve(allowed);
          });
        });
        if (!allowed)
          throw Error("Разрешение не выдано. Ответ и подарки сохранены.");
        try {
          await mutate(base + "/notification-permission", "POST", {
            initData: app.initData,
          });
          return;
        } catch (e) {
          if (
            !(e instanceof WishlistError) ||
            ![
              "WRITE_PERMISSION_REQUIRED",
              "INVALID_TELEGRAM_DATA",
              "BOT_BLOCKED",
            ].includes(e.code)
          )
            throw e;
        }
      }
      const h = await mutate<{ url: string }>(
        base + "/notification-handoff",
        "POST",
        {},
      );
      setUrl(h.url);
      setChoices({});
    });
  }
  return (
    <main className="shell organizer-notifications" aria-busy={busy}>
      <Link href={`/e/${publicId}`}>← К событию</Link>
      <h1>Уведомления в Telegram</h1>
      {data && <p>{data.eventTitle}</p>}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {!data ? (
        <>
          <p>
            {error
              ? "Подключение пока недоступно. Ваш ответ и подарки сохранены."
              : "Проверяем подключение…"}
          </p>
          <button onClick={() => void load()}>Повторить</button>
        </>
      ) : (
        <>
          <section className="panel">
            <h2>
              {data.enabled
                ? "Уведомления включены"
                : "Получать напоминания в Telegram"}
            </h2>
            <p>
              Изменения и напоминания только об этом событии. Ответ и выбранные
              подарки сохранятся.
            </p>
            {data.linkedName && <p>Связанный аккаунт: {data.linkedName}</p>}
            {proof?.state === "verified" ? (
              <>
                <h3>Подтвердите аккаунт</h3>
                <p>
                  Подключить Telegram «{proof.accountName}» к вашему ответу?
                </p>
                {proof.conflicts.map((c) => (
                  <fieldset key={c.event_id}>
                    <legend>Два ответа: {c.title}</legend>
                    <p>
                      Выберите ответ, который нужно сохранить. Подарки
                      объединятся.
                    </p>
                    {(["current", "telegram"] as const).map((choice) => (
                      <label key={choice}>
                        <input
                          type="radio"
                          name={c.event_id}
                          checked={choices[c.event_id] === choice}
                          onChange={() =>
                            setChoices({ ...choices, [c.event_id]: choice })
                          }
                        />
                        {choice === "current"
                          ? `На этом устройстве: ${c.current_name} — ${labels[c.current_status]}`
                          : `В Telegram: ${c.telegram_name} — ${labels[c.telegram_status]}`}
                      </label>
                    ))}
                  </fieldset>
                ))}
                <button
                  className="primary"
                  disabled={
                    busy || proof.conflicts.some((c) => !choices[c.event_id])
                  }
                  onClick={() =>
                    void action(async () => {
                      await mutate(base + "/notification-complete", "POST", {
                        handoffId: proof.id,
                        confirmAccount: true,
                        choices: Object.fromEntries(
                          proof.conflicts.map((c) => [
                            c.event_id,
                            {
                              choice: choices[c.event_id],
                              currentVersion: c.current_version,
                              telegramVersion: c.telegram_version,
                            },
                          ]),
                        ),
                      });
                      setUrl("");
                    })
                  }
                >
                  Подтвердить и включить
                </button>
              </>
            ) : data.enabled ? (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void action(() =>
                    mutate(base + "/notification-subscription", "PUT", {
                      enabled: false,
                    }),
                  )
                }
              >
                Выключить уведомления
              </button>
            ) : (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void connect()}
              >
                Подключить Telegram
              </button>
            )}
            {url && proof?.state === "pending" && (
              <>
                <a
                  className="primary route-link"
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть Telegram
                </a>
                <p>
                  Нажмите «Запустить» у бота, затем вернитесь сюда и подтвердите
                  аккаунт.
                </p>
              </>
            )}
            {proof?.state === "pending" && (
              <p role="status">Ожидаем подтверждение в Telegram…</p>
            )}
            {proof?.state === "expired" && (
              <p>Ссылка истекла. Подключите Telegram заново.</p>
            )}
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void load()}
            >
              Проверить подключение
            </button>
            {proof && ["pending", "verified"].includes(proof.state) && (
              <button
                disabled={busy}
                onClick={() =>
                  void action(() =>
                    mutate(base + "/notification-subscription", "PUT", {
                      enabled: false,
                    }),
                  )
                }
              >
                Отменить подключение
              </button>
            )}
          </section>
          <p>
            Для ответа «Не буду» напоминание не отправляется. Получение
            изменений можно оставить включённым.
          </p>
          <p>
            Telegram может потребовать ручного возврата в Safari или приложение.
          </p>
        </>
      )}
    </main>
  );
}
