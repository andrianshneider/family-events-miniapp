"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicEvent } from "@/lib/invitation";
import { rsvpLabels, type RsvpStatus, type GuestContext } from "@/lib/rsvp";
import { rsvpInput } from "@/lib/validation";
import { announceEventChange, watchEventChanges } from "@/lib/event-updates";
import { TelegramBack } from "./telegram-back";
import { eventDateLabel } from "./event-presentation";
type Draft = {
  guestName: string;
  status: RsvpStatus;
  adultsCount: number;
  childrenCount: number;
  comment: string;
};
type Attempt = {
  key: string;
  contextKey: string;
  payload: ReturnType<typeof rsvpInput.parse>;
};
const empty: Draft = {
  guestName: "",
  status: "yes",
  adultsCount: 1,
  childrenCount: 0,
  comment: "",
};
export function RsvpCard({
  event,
  onUnavailable,
}: {
  event: PublicEvent;
  onUnavailable: () => void;
}) {
  const [context, setContext] = useState<GuestContext | null>(null),
    [loading, setLoading] = useState(true),
    [pending, setPending] = useState(false),
    [offline, setOffline] = useState(false);
  const [draft, setDraft] = useState<Draft>(empty),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [success, setSuccess] = useState(false),
    [conflict, setConflict] = useState(false),
    [attempt, setAttempt] = useState<Attempt | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dialog = useRef<HTMLDialogElement>(null),
    form = useRef<HTMLFormElement>(null),
    source = useRef<HTMLElement | null>(null),
    busy = useRef(false),
    flight = useRef<Promise<GuestContext> | null>(null),
    last = useRef(0);
  const base = useRef<{
    id: string | null;
    version: number | null;
    contextKey: string | null;
  }>({ id: null, version: null, contextKey: null });
  const contextRef = useRef<GuestContext | null>(null),
    panel = useRef<HTMLElement>(null);
  const path = `/api/v1/public/events/${event.publicId}`;
  const load = useCallback(() => {
    if (flight.current) return flight.current;
    const work = (async () => {
      const response = await fetch(path + "/my-context", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 404) {
        onUnavailable();
        throw Error("Это мероприятие недоступно.");
      }
      if (!response.ok)
        throw Error("Не удалось проверить ваш ответ. Повторите попытку.");
      const data: GuestContext = (await response.json()).data;
      if (
        contextRef.current?.contextKey &&
        contextRef.current.contextKey !== data.contextKey
      )
        setNotice(
          "Гостевая сессия изменилась. Прежний анонимный ответ не восстановить по имени.",
        );
      if (
        contextRef.current?.contextKey &&
        contextRef.current.contextKey !== data.contextKey &&
        data.sessionState === "active"
      ) {
        setDraft(empty);
        setSuccess(false);
        setConflict(true);
        if (!busy.current) dialog.current?.close();
      }
      contextRef.current = data;
      setContext(data);
      return data;
    })().finally(() => {
      flight.current = null;
      last.current = Date.now();
      setLoading(false);
    });
    flight.current = work;
    return work;
  }, [path, onUnavailable]);
  useEffect(() => {
    const network = () => setOffline(!navigator.onLine);
    network();
    const restore = () => {
      if (
        document.visibilityState === "visible" &&
        !busy.current &&
        Date.now() - last.current > 1000
      )
        void load().catch((e) => setError(e.message));
    };
    const show = (e: PageTransitionEvent) => {
      if (e.persisted) restore();
    };
    void load().catch((e) => setError(e.message));
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    window.addEventListener("online", restore);
    window.addEventListener("pageshow", show);
    document.addEventListener("visibilitychange", restore);
    const interval = window.setInterval(restore, 30000),
      stop = watchEventChanges(restore);
    return () => {
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
      window.removeEventListener("online", restore);
      window.removeEventListener("pageshow", show);
      document.removeEventListener("visibilitychange", restore);
      window.clearInterval(interval);
      stop();
    };
  }, [load]);
  function open(status: RsvpStatus) {
    if (!context || busy.current) return;
    source.current = document.activeElement as HTMLElement;
    if (!attempt)
      base.current = {
        id: context.rsvp?.id ?? null,
        version: context.rsvp?.version ?? null,
        contextKey: context.contextKey,
      };
    setSuccess(false);
    setConflict(false);
    setError("");
    setErrors({});
    if (!attempt)
      setDraft(
        context.rsvp
          ? {
              guestName: context.rsvp.guestName,
              status: context.rsvp.status,
              adultsCount: context.rsvp.adultsCount || 1,
              childrenCount: context.rsvp.childrenCount,
              comment: context.rsvp.comment ?? "",
            }
          : { ...empty, status, guestName: context.defaultName ?? "" },
      );
    setModalOpen(true);
    dialog.current?.showModal();
  }
  async function bootstrap(restart = false) {
    const app = (
      window as Window & { Telegram?: { WebApp?: { initData?: string } } }
    ).Telegram?.WebApp;
    if (app?.initData && context?.sessionState !== "active") {
      const auth = await fetch("/api/auth/telegram/mini-app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: app.initData }),
        signal: AbortSignal.timeout(10000),
      });
      if (!auth.ok)
        throw Error(
          "Не удалось подтвердить Telegram. Перезапустите приложение; введённые поля сохранены.",
        );
    }
    const response = await fetch("/api/guest/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(restart ? { restart: true } : {}),
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!response.ok) {
      if (result.error?.code === "GUEST_LINK_REQUIRED") {
        setNotice(result.error.message);
        return load();
      }
      throw Error(
        result.error?.message ?? "Не удалось подготовить гостевую сессию.",
      );
    }
    return load();
  }
  async function submit() {
    if (busy.current || offline || context?.sessionState === "lost" || conflict)
      return;
    let operation = attempt;
    const payload = {
      ...draft,
      adultsCount: draft.status === "no" ? 0 : draft.adultsCount,
      childrenCount: draft.status === "no" ? 0 : draft.childrenCount,
      expectedVersion: base.current.version,
    };
    if (!operation) {
      const parsed = rsvpInput.safeParse(payload);
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues)
          fieldErrors[String(issue.path[0])] =
            (
              {
                guestName: "Введите имя от 2 до 60 символов.",
                adultsCount: "Взрослых — целое число от 1 до 20.",
                childrenCount: "Детей — целое число от 0 до 20.",
                comment: "Комментарий — до 300 символов.",
              } as Record<string, string>
            )[String(issue.path[0])] ?? "Проверьте поле.";
        setErrors(fieldErrors);
        form.current
          ?.querySelector<HTMLElement>(
            `[name="${Object.keys(fieldErrors)[0]}"]`,
          )
          ?.focus();
        return;
      }
    }
    busy.current = true;
    setPending(true);
    setError("");
    setErrors({});
    let sent = false;
    try {
      const fresh = operation ? await load() : await bootstrap();
      if (fresh.sessionState !== "active" || !fresh.contextKey)
        throw Error(
          "Гостевая сессия недоступна. Подтвердите создание новой сессии отдельно.",
        );
      if (operation && operation.contextKey !== fresh.contextKey) {
        setConflict(true);
        throw Error(
          "Гость изменился. Прежний запрос нельзя повторить от другого имени.",
        );
      }
      if (
        !operation &&
        (base.current.id !== (fresh.rsvp?.id ?? null) ||
          base.current.version !== (fresh.rsvp?.version ?? null) ||
          (base.current.contextKey !== null &&
            base.current.contextKey !== fresh.contextKey))
      ) {
        setConflict(true);
        throw Error(
          "На сервере уже есть другой ответ. Загрузите текущий ответ перед сохранением.",
        );
      }
      operation ??= {
        key: crypto.randomUUID(),
        contextKey: fresh.contextKey,
        payload: rsvpInput.parse(payload),
      };
      const csrf = await fetch("/api/auth/csrf?context=guest", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!csrf.ok) {
        await load();
        throw Error("Гостевая сессия истекла. Отправка остановлена.");
      }
      const token = (await csrf.json()).data.csrfToken;
      setAttempt(operation);
      sent = true;
      const response = await fetch(path + "/rsvp", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
          "idempotency-key": operation.key,
        },
        body: JSON.stringify(operation.payload),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (response.status === 404) {
        onUnavailable();
        return;
      }
      if (!response.ok) {
        if (
          [401, 403, 422, 429].includes(response.status) ||
          result.error?.code === "RSVP_VERSION_CONFLICT"
        ) {
          setAttempt(null);
          sent = false;
        }
        if (response.status === 401) await load();
        if (result.error?.code === "RSVP_VERSION_CONFLICT") setConflict(true);
        throw Error(result.error?.message ?? "Не удалось сохранить ответ.");
      }
      const saved = result.data.rsvp;
      const updated = {
        ...fresh,
        rsvp:
          fresh.rsvp && fresh.rsvp.version > saved.version ? fresh.rsvp : saved,
      };
      contextRef.current = updated;
      setContext(updated);
      setAttempt(null);
      setSuccess(true);
      setConflict(false);
      announceEventChange();
    } catch (caught) {
      setError(
        sent
          ? "Результат пока неизвестен. Нажмите «Проверить сохранение»: повторим прежнюю операцию без дубля."
          : caught instanceof Error
            ? caught.message
            : "Не удалось сохранить ответ.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function restart() {
    if (busy.current || offline || attempt) return;
    if (
      !window.confirm(
        "Прежний анонимный ответ недоступен. Создать новую гостевую сессию? Это не восстановит ответ по имени.",
      )
    )
      return;
    busy.current = true;
    setPending(true);
    try {
      await bootstrap(true);
      setNotice(
        "Новая сессия готова. Ответ не отправлен; проверьте форму и подтвердите отдельно.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Не удалось создать сессию.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  function close() {
    if (!busy.current) {
      dialog.current?.close();
      setSuccess(false);
    }
  }
  const lost = context?.sessionState === "lost";
  return (
    <section
      ref={panel}
      className="panel rsvp-panel"
      aria-labelledby="rsvp-heading"
      aria-busy={loading || pending}
    >
      <TelegramBack
        onBack={() => {
          if (dialog.current?.open) close();
          else window.history.back();
        }}
        warnBeforeClose={pending || !!attempt}
      />
      <h2 id="rsvp-heading">Вы придёте?</h2>
      {loading ? (
        <p role="status">Загружаем ваш ответ…</p>
      ) : !context ? (
        <>
          <p className="error" role="alert">
            {error || "Не удалось проверить ваш ответ."}
          </p>
          <button
            className="secondary"
            onClick={() => {
              setLoading(true);
              void load().catch((e) => setError(e.message));
            }}
          >
            Попробовать снова
          </button>
        </>
      ) : (
        <>
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {lost ? (
            <>
              <p className="notice">
                Гостевая сессия недоступна. Прежний анонимный ответ нельзя
                восстановить по имени.
              </p>
              <button
                className="secondary"
                disabled={pending || offline || !!attempt}
                onClick={restart}
              >
                Создать новую гостевую сессию
              </button>
              {attempt && (
                <button
                  className="text-button"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Результат прежней операции недоступен без старой сессии. Отказаться от её проверки? Новая сессия не восстановит анонимный ответ.",
                      )
                    ) {
                      setAttempt(null);
                      setConflict(false);
                    }
                  }}
                >
                  Отказаться от проверки прежнего запроса
                </button>
              )}
            </>
          ) : context.rsvp ? (
            <>
              <p className="status-answer">
                Ваш ответ: {rsvpLabels[context.rsvp.status]}
              </p>
              {context.rsvp.status !== "no" && (
                <p>
                  {context.rsvp.adultsCount} взрослых ·{" "}
                  {context.rsvp.childrenCount} детей
                </p>
              )}
              <button
                className="secondary"
                disabled={pending || offline}
                onClick={() => open(context.rsvp!.status)}
              >
                Изменить
              </button>
            </>
          ) : (
            <div className="rsvp-buttons">
              {Object.entries(rsvpLabels).map(([status, label]) => (
                <button
                  key={status}
                  className={status === "yes" ? "primary" : "secondary"}
                  disabled={pending || offline}
                  onClick={() => open(status as RsvpStatus)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {error && !modalOpen && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <p className="hint">
            Регистрация не нужна. Ответ доступен в этой гостевой сессии; другой
            браузер или удаление cookies могут создать другого гостя.
          </p>
        </>
      )}
      <dialog
        ref={dialog}
        className="rsvp-dialog"
        aria-labelledby="rsvp-dialog-heading"
        aria-busy={pending}
        onCancel={(e) => {
          if (busy.current) e.preventDefault();
        }}
        onClose={() => {
          setModalOpen(false);
          if (source.current?.isConnected) source.current.focus();
          else
            panel.current
              ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
              ?.focus();
        }}
      >
        {success ? (
          <>
            <h2 id="rsvp-dialog-heading">Спасибо! Ваш ответ сохранён</h2>
            {context?.rsvp?.status === "yes" && (
              <p>Увидимся {eventDateLabel(event.eventDate)}.</p>
            )}
            <p>Ваш ответ: {context?.rsvp && rsvpLabels[context.rsvp.status]}</p>
            <button className="primary" autoFocus onClick={close}>
              К событию
            </button>
          </>
        ) : (
          <>
            <h2 id="rsvp-dialog-heading">
              {context?.rsvp ? "Изменить ответ" : "Ответить на приглашение"}
            </h2>
            <form
              ref={form}
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
              noValidate
            >
              <fieldset disabled={pending || !!attempt}>
                <label className="field">
                  Ваше имя *
                  <input
                    name="guestName"
                    value={draft.guestName}
                    maxLength={120}
                    autoComplete="name"
                    onChange={(e) =>
                      setDraft({ ...draft, guestName: e.target.value })
                    }
                    aria-invalid={!!errors.guestName}
                    aria-describedby="rsvp-name-error"
                  />
                </label>
                <p id="rsvp-name-error" className="field-error">
                  {errors.guestName}
                </p>
                <label className="field">
                  Ваш ответ
                  <select
                    name="status"
                    value={draft.status}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        status: e.target.value as RsvpStatus,
                      })
                    }
                  >
                    {Object.entries(rsvpLabels).map(([status, label]) => (
                      <option key={status} value={status}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {draft.status !== "no" && (
                  <div className="rsvp-counts">
                    {(["adultsCount", "childrenCount"] as const).map((name) => (
                      <label
                        className="field"
                        key={name}
                        htmlFor={`rsvp-${name}`}
                      >
                        {name === "adultsCount" ? "Взрослых" : "Детей"}
                        <span className="rsvp-stepper">
                          <button
                            type="button"
                            className="secondary"
                            aria-label={
                              name === "adultsCount"
                                ? "Уменьшить число взрослых"
                                : "Уменьшить число детей"
                            }
                            disabled={
                              draft[name] <= (name === "adultsCount" ? 1 : 0)
                            }
                            onClick={() =>
                              setDraft({
                                ...draft,
                                [name]: Math.max(
                                  name === "adultsCount" ? 1 : 0,
                                  (Number.isFinite(draft[name])
                                    ? draft[name]
                                    : name === "adultsCount"
                                      ? 1
                                      : 0) - 1,
                                ),
                              })
                            }
                          >
                            −
                          </button>
                          <input
                            id={`rsvp-${name}`}
                            name={name}
                            type="number"
                            min={name === "adultsCount" ? 1 : 0}
                            max={20}
                            step={1}
                            inputMode="numeric"
                            value={Number.isNaN(draft[name]) ? "" : draft[name]}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                [name]:
                                  e.target.value === ""
                                    ? NaN
                                    : Number(e.target.value),
                              })
                            }
                            aria-invalid={!!errors[name]}
                          />
                          <button
                            type="button"
                            className="secondary"
                            aria-label={
                              name === "adultsCount"
                                ? "Увеличить число взрослых"
                                : "Увеличить число детей"
                            }
                            disabled={draft[name] >= 20}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                [name]: Math.min(
                                  20,
                                  (Number.isFinite(draft[name])
                                    ? draft[name]
                                    : name === "adultsCount"
                                      ? 1
                                      : 0) + 1,
                                ),
                              })
                            }
                          >
                            +
                          </button>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <label className="field">
                  Комментарий
                  <textarea
                    name="comment"
                    value={draft.comment}
                    maxLength={600}
                    placeholder="Например, будем немного позже"
                    onChange={(e) =>
                      setDraft({ ...draft, comment: e.target.value })
                    }
                    aria-invalid={!!errors.comment}
                  />
                </label>
                <p className="hint">{[...draft.comment].length}/300</p>
              </fieldset>
              {Object.entries(errors)
                .filter(([key]) => key !== "guestName")
                .map(([key, message]) => (
                  <p key={key} className="field-error" role="alert">
                    {message}
                  </p>
                ))}
              {error && (
                <p className="notice error" role="alert">
                  {error}
                </p>
              )}
              {offline && <p role="status">Нет соединения. Ввод сохранён.</p>}
              {conflict && (
                <button
                  type="button"
                  className="secondary"
                  disabled={pending || offline}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        "Загрузить текущий ответ? Введённые изменения будут заменены.",
                      )
                    )
                      return;
                    try {
                      const current = await load();
                      base.current = {
                        id: current.rsvp?.id ?? null,
                        version: current.rsvp?.version ?? null,
                        contextKey: current.contextKey,
                      };
                      setAttempt(null);
                      setConflict(false);
                      setError("");
                      setDraft(
                        current.rsvp
                          ? {
                              guestName: current.rsvp.guestName,
                              status: current.rsvp.status,
                              adultsCount: current.rsvp.adultsCount || 1,
                              childrenCount: current.rsvp.childrenCount,
                              comment: current.rsvp.comment ?? "",
                            }
                          : { ...empty, guestName: current.defaultName ?? "" },
                      );
                    } catch (caught) {
                      setError(
                        caught instanceof Error
                          ? caught.message
                          : "Не удалось загрузить ответ.",
                      );
                    }
                  }}
                >
                  Загрузить текущий ответ
                </button>
              )}
              <button
                type="button"
                className="secondary"
                disabled={pending}
                onClick={close}
              >
                Отмена
              </button>
              <button
                type="submit"
                className="primary"
                disabled={pending || offline || lost || conflict}
              >
                {pending
                  ? "Сохраняем…"
                  : attempt
                    ? "Проверить сохранение"
                    : context?.rsvp
                      ? "Сохранить изменения"
                      : "Подтвердить"}
              </button>
            </form>
          </>
        )}
      </dialog>
    </section>
  );
}
