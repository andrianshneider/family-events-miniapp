"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { eventInput } from "@/lib/validation";
import {
  emptyEventFields as empty,
  readEventForm,
  type EventFields as Fields,
  type CreateAttempt as Attempt,
} from "@/lib/event-form-state";
import { eventDateLabel, eventTypes } from "./event-presentation";
import { TelegramBack } from "./telegram-back";
import { OrganizerHeader } from "./organizer-header";
const storageKey = "fe-create-event-form-v1";
function removeSaved() {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    /* Browser storage may be unavailable. */
  }
}
const groups: {
  title: string;
  fields: {
    key: keyof Fields;
    label: string;
    type?: string;
    max?: number;
    required?: boolean;
    hint?: string;
  }[];
}[] = [
  {
    title: "О событии",
    fields: [
      {
        key: "title",
        label: "Название",
        max: 80,
        required: true,
        hint: "От 3 до 80 символов",
      },
      {
        key: "eventType",
        label: "Тип события",
        type: "select",
        required: true,
      },
    ],
  },
  {
    title: "Когда встречаемся",
    fields: [
      {
        key: "eventDate",
        label: "Дата",
        type: "date",
        required: true,
        hint: "Сегодня или позже",
      },
      { key: "startTime", label: "Начало", type: "time" },
      {
        key: "endTime",
        label: "Окончание",
        type: "time",
        hint: "Позже начала в тот же день",
      },
    ],
  },
  {
    title: "Где встречаемся",
    fields: [
      { key: "venueName", label: "Место", max: 200 },
      {
        key: "address",
        label: "Адрес",
        max: 500,
        hint: "Введите город, улицу и дом вручную",
      },
      { key: "directions", label: "Как найти", max: 500, type: "textarea" },
    ],
  },
  {
    title: "Детали для гостей",
    fields: [
      { key: "description", label: "Описание", max: 1000, type: "textarea" },
      { key: "dressCode", label: "Dress code", max: 300, type: "textarea" },
    ],
  },
];
export function CreateEventScreen({
  userId,
  displayName,
}: {
  userId: string;
  displayName: string;
}) {
  const router = useRouter();
  const [fields, setFields] = useState(empty);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const attemptRef = useRef<Attempt | null>(null);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [coverError, setCoverError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const form = useRef<HTMLFormElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelSource = useRef<HTMLElement | null>(null);
  const busy = useRef(false);
  const uploadBusy = useRef(false);
  const allowExit = useRef(false);
  const fieldsRef = useRef(fields);
  const persist = useCallback(
    (value: Fields, request: Attempt | null) => {
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            userId,
            fields: value,
            attempt: request,
            savedAt: Date.now(),
          }),
        );
      } catch {
        /* The current form remains in memory when browser storage is unavailable. */
      }
    },
    [userId],
  );
  useEffect(() => {
    let value = {
      ...empty,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    };
    let savedAttempt: Attempt | null = null;
    try {
      const saved = readEventForm(localStorage.getItem(storageKey), userId);
      if (saved) {
        value = saved.fields;
        savedAttempt = saved.attempt;
      } else removeSaved();
    } catch {
      removeSaved();
    }
    // Initialize from the browser's temporary, account-bound form store after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFields(value);
    fieldsRef.current = value;
    setAttempt(savedAttempt);
    attemptRef.current = savedAttempt;
    setReady(true);
    setOnline(navigator.onLine);
    const network = () => setOnline(navigator.onLine);
    const restore = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/v1/me", {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        if (response.status === 401) {
          persist(fieldsRef.current, attemptRef.current);
          allowExit.current = true;
          window.location.assign(
            new URL("/login?returnTo=/events/new", window.location.origin).href,
          );
        } else if (response.ok && (await response.json()).data.id !== userId) {
          removeSaved();
          allowExit.current = true;
          window.location.replace("/events");
        }
      } catch {
        /* Offline editing remains available; mutations recheck the session. */
      }
    };
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    document.addEventListener("visibilitychange", restore);
    return () => {
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
      document.removeEventListener("visibilitychange", restore);
    };
  }, [userId, persist]);
  const dirty = Object.entries(fields).some(
    ([key, value]) => key !== "timezone" && value !== "",
  );
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (dirty && !allowExit.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  function change(key: keyof Fields, value: string) {
    const next = { ...fieldsRef.current, [key]: value };
    fieldsRef.current = next;
    setFields(next);
    persist(next, attempt);
    setFieldErrors((current) => ({ ...current, [key]: [] }));
  }
  function leave() {
    if (busy.current || uploadBusy.current) return;
    if (attempt) {
      setError(
        "Результат создания пока неизвестен. Сначала нажмите «Проверить создание», чтобы исключить повторное событие.",
      );
      return;
    }
    if (dirty) {
      cancelSource.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
    } else router.push("/events");
  }
  function requireLogin() {
    persist(fieldsRef.current, attempt);
    allowExit.current = true;
    window.location.assign(
      new URL("/login?returnTo=/events/new", window.location.origin).href,
    );
  }
  async function csrfToken() {
    const profile = await fetch("/api/v1/me", {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (profile.status === 401) {
      requireLogin();
      throw Error("Войдите снова, чтобы продолжить.");
    }
    if (!profile.ok)
      throw Error("Не удалось проверить сессию. Повторите попытку.");
    if ((await profile.json()).data.id !== userId) {
      removeSaved();
      window.location.replace("/events");
      throw Error("Аккаунт изменился. Откройте новую форму.");
    }
    const response = await fetch("/api/auth/csrf", {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401) {
      requireLogin();
      throw Error("Войдите снова, чтобы продолжить.");
    }
    if (!response.ok)
      throw Error("Не удалось проверить сессию. Повторите попытку.");
    return (await response.json()).data.csrfToken as string;
  }
  async function upload(file: File | undefined) {
    if (!file || busy.current || uploadBusy.current || attempt) return;
    setCoverError("");
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 10485760 ||
      !file.size
    ) {
      setCoverError("Выберите JPG, PNG или WebP до 10 MiB.");
      return;
    }
    uploadBusy.current = true;
    setUploading(true);
    try {
      const csrf = await csrfToken();
      const prepare = await fetch("/api/v1/media/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ mimeType: file.type, byteSize: file.size }),
        signal: AbortSignal.timeout(15000),
      });
      const prepared = await prepare.json();
      if (prepare.status === 401) requireLogin();
      if (!prepare.ok)
        throw Error(
          prepared.error?.message ?? "Не удалось подготовить загрузку.",
        );
      const sent = await fetch(prepared.data.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type, "x-upsert": "false" },
        body: file,
        signal: AbortSignal.timeout(60000),
      });
      if (!sent.ok)
        throw Error("Не удалось загрузить изображение. Повторите выбор.");
      const complete = await fetch(
        `/api/v1/media/${prepared.data.assetId}/complete`,
        {
          method: "POST",
          headers: { "x-csrf-token": csrf },
          signal: AbortSignal.timeout(60000),
        },
      );
      const result = await complete.json();
      if (complete.status === 401) requireLogin();
      if (!complete.ok)
        throw Error(
          result.error?.message ?? "Не удалось обработать изображение.",
        );
      change("coverAssetId", result.data.assetId);
    } catch (caught) {
      setCoverError(
        caught instanceof Error && caught.name === "Error"
          ? caught.message
          : "Не удалось загрузить обложку. Проверьте соединение и повторите выбор.",
      );
    } finally {
      uploadBusy.current = false;
      setUploading(false);
    }
  }
  async function submit() {
    if (busy.current || uploadBusy.current || !online) return;
    setError("");
    setFieldErrors({});
    let current = attempt;
    if (!current) {
      const payload = {
        ...fields,
        startTime: fields.startTime || null,
        endTime: fields.endTime || null,
        coverAssetId: fields.coverAssetId || null,
      };
      const parsed = eventInput.safeParse(payload);
      if (!parsed.success) {
        const errors: Record<string, string[]> = {};
        for (const issue of parsed.error.issues) {
          const key = String(issue.path[0]);
          errors[key] = [
            key === "title"
              ? "Введите название от 3 до 80 символов."
              : key === "eventType"
                ? "Выберите тип события."
                : key === "eventDate"
                  ? "Выберите дату."
                  : key === "endTime"
                    ? "Окончание должно быть позже начала в тот же день."
                    : "Проверьте значение поля.",
          ];
        }
        setFieldErrors(errors);
        form.current
          ?.querySelector<HTMLElement>(`[name="${Object.keys(errors)[0]}"]`)
          ?.focus();
        return;
      }
      current = { key: crypto.randomUUID(), payload: parsed.data };
    }
    busy.current = true;
    setPending(true);
    try {
      const csrf = await csrfToken();
      setAttempt(current);
      attemptRef.current = current;
      persist(fields, current);
      const response = await fetch("/api/v1/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrf,
          "idempotency-key": current.key,
        },
        body: JSON.stringify(current.payload),
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json();
      if (response.status === 401) {
        persist(fields, current);
        allowExit.current = true;
        window.location.assign(
          new URL("/login?returnTo=/events/new", window.location.origin).href,
        );
        return;
      }
      if (!response.ok) {
        if ([403, 422, 429].includes(response.status)) {
          setAttempt(null);
          attemptRef.current = null;
          persist(fields, null);
        }
        const errors =
          result.error?.fieldErrors ??
          (result.error?.code === "EVENT_DATE_IN_PAST"
            ? { eventDate: [result.error.message] }
            : {});
        setFieldErrors(errors);
        form.current
          ?.querySelector<HTMLElement>(`[name="${Object.keys(errors)[0]}"]`)
          ?.focus();
        throw Error(
          result.error?.message ??
            "Не удалось создать событие. Повторите проверку.",
        );
      }
      removeSaved();
      allowExit.current = true;
      window.location.replace(`/events/${result.data.id}?created=1`);
    } catch (caught) {
      setError(
        caught instanceof Error && caught.name === "Error"
          ? caught.message
          : "Ответ не получен. Повторите проверку: отправленный запрос повторится с прежним ключом.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const locked = pending || !!attempt;
  const cover = fields.coverAssetId
    ? `/api/v1/media/${fields.coverAssetId}`
    : null;
  return (
    <main className="shell event-shell">
      <TelegramBack onBack={leave} />
      <OrganizerHeader displayName={displayName} />
      <button
        className="text-button back"
        onClick={leave}
        disabled={pending || uploading}
      >
        ← Мои события
      </button>
      <h1>Создать событие</h1>
      <p className="muted">
        Соберите близких в один день.
        <br />
        Обязательно только название, тип и дата.
      </p>
      {!online && (
        <p role="status" className="notice">
          Нет соединения. Можно продолжать заполнять форму; отправка станет
          доступна после подключения.
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {attempt && !pending && (
        <p className="notice" role="status">
          Сначала проверим результат предыдущего запроса. Изменение формы
          временно недоступно, чтобы не создать дубликат.
        </p>
      )}
      <form
        ref={form}
        id="create-event"
        className="event-layout"
        noValidate
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="form-panels">
          {groups.map((group, index) => (
            <section className="panel" key={group.title}>
              <h2>{group.title}</h2>
              {index === 0 && (
                <>
                  <div className="event-cover">
                    {cover ? (
                      <Image
                        unoptimized
                        width={800}
                        height={480}
                        src={cover}
                        alt="Предпросмотр обложки события"
                      />
                    ) : (
                      <span aria-hidden="true">♡</span>
                    )}
                  </div>
                  <div className="cover-actions">
                    <label className="secondary upload-label">
                      {uploading
                        ? "Подготавливаем…"
                        : cover
                          ? "Сменить обложку"
                          : "＋ Добавить обложку"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={locked || uploading || !online || !ready}
                        onChange={(event) => {
                          void upload(event.target.files?.[0]);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    {cover && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={locked || uploading}
                        onClick={() => change("coverAssetId", "")}
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                  <p className="hint">
                    Необязательно · JPG, PNG или WebP, до 10 MiB
                  </p>
                  {coverError && (
                    <p role="alert" className="error">
                      {coverError}
                    </p>
                  )}
                  {fieldErrors.coverAssetId?.length ? (
                    <p role="alert" className="error">
                      {fieldErrors.coverAssetId[0]}
                    </p>
                  ) : null}
                </>
              )}
              {group.fields.map((field) => (
                <div className="field" key={field.key}>
                  <div className="label-row">
                    <label htmlFor={field.key}>
                      {field.label}
                      {field.required ? " *" : ""}
                    </label>
                    <span className="hint">
                      {field.max
                        ? `${fields[field.key].length} / ${field.max}`
                        : field.required
                          ? "Обязательно"
                          : "Необязательно"}
                    </span>
                  </div>
                  {field.type === "select" ? (
                    <select
                      id={field.key}
                      name={field.key}
                      value={fields[field.key]}
                      required={field.required}
                      disabled={locked || !ready}
                      aria-invalid={!!fieldErrors[field.key]?.length}
                      aria-describedby={`${field.key}-hint ${field.key}-error`}
                      onChange={(event) =>
                        change(field.key, event.target.value)
                      }
                    >
                      <option value="">Выберите тип</option>
                      {Object.entries(eventTypes).map(([key, label]) => (
                        <option value={key} key={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      id={field.key}
                      name={field.key}
                      rows={3}
                      value={fields[field.key]}
                      maxLength={field.max}
                      disabled={locked || !ready}
                      aria-invalid={!!fieldErrors[field.key]?.length}
                      aria-describedby={`${field.key}-hint ${field.key}-error`}
                      onChange={(event) =>
                        change(field.key, event.target.value)
                      }
                    />
                  ) : (
                    <input
                      id={field.key}
                      name={field.key}
                      type={field.type ?? "text"}
                      value={fields[field.key]}
                      maxLength={field.max}
                      required={field.required}
                      disabled={locked || !ready}
                      aria-invalid={!!fieldErrors[field.key]?.length}
                      aria-describedby={`${field.key}-hint ${field.key}-error`}
                      onChange={(event) =>
                        change(field.key, event.target.value)
                      }
                    />
                  )}
                  <p id={`${field.key}-hint`} className="hint">
                    {field.hint}
                  </p>
                  <p id={`${field.key}-error`} className="error">
                    {fieldErrors[field.key]?.[0]}
                  </p>
                </div>
              ))}
              {index === 1 && (
                <p className="timezone">
                  Часовой пояс: {fields.timezone}. Время сохраняется в этом
                  часовом поясе.
                </p>
              )}
            </section>
          ))}
        </div>
        <aside className="panel event-preview">
          <h2>Так увидят гости</h2>
          <div className="event-cover">
            {cover ? (
              <Image unoptimized width={800} height={480} src={cover} alt="" />
            ) : (
              <span aria-hidden="true">♡</span>
            )}
          </div>
          <h3>{fields.title || "Название события"}</h3>
          <p>
            {fields.eventDate
              ? eventDateLabel(fields.eventDate)
              : "Выберите дату"}
            {fields.startTime ? " · " + fields.startTime : ""}
          </p>
          <p className="muted">
            {fields.venueName || "Место можно добавить позже"}
          </p>
          <p className="hint">
            Предпросмотр сведений. Приглашения скоро появятся.
          </p>
        </aside>
      </form>
      <footer className="form-footer">
        <button
          type="button"
          className="secondary"
          onClick={leave}
          disabled={pending || uploading}
        >
          Отмена
        </button>
        <button
          type="submit"
          form="create-event"
          className="primary"
          disabled={
            !ready ||
            !online ||
            pending ||
            uploading ||
            (!attempt &&
              (fields.title.trim().length < 3 ||
                !fields.eventType ||
                !fields.eventDate))
          }
        >
          {pending
            ? "Создаём событие…"
            : attempt
              ? "Проверить создание"
              : "Создать событие"}
        </button>
      </footer>
      <dialog
        ref={dialog}
        aria-labelledby="cancel-title"
        onClose={() => cancelSource.current?.focus()}
      >
        <h2 id="cancel-title">Выйти из формы?</h2>
        <p>Введённые данные не сохранятся. Можно вернуться и продолжить.</p>
        <button
          className="primary"
          autoFocus
          onClick={() => dialog.current?.close()}
        >
          Продолжить создание
        </button>
        <button
          className="secondary"
          onClick={() => {
            removeSaved();
            allowExit.current = true;
            router.push("/events");
          }}
        >
          Выйти без сохранения
        </button>
      </dialog>
    </main>
  );
}
