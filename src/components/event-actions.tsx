"use client";
import Link from "next/link";
import { announceEventChange } from "@/lib/event-updates";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { TelegramBack } from "./telegram-back";

type Attempt = { key: string; expectedVersion: number };
export function EventActions({
  id,
  title,
  version,
  onConflict,
}: {
  id: string;
  title: string;
  version: number;
  onConflict: () => void;
}) {
  const router = useRouter();
  const modal = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const attempt = useRef<Attempt | null>(null);
  const [mode, setMode] = useState<"menu" | "delete">("menu");
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const connection = () => setOffline(!navigator.onLine);
    connection();
    const protect = (event: BeforeUnloadEvent) => {
      if (busy.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    window.addEventListener("beforeunload", protect);
    return () => {
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
      window.removeEventListener("beforeunload", protect);
    };
  }, []);
  function close() {
    if (!busy.current) modal.current?.close();
  }
  function open() {
    // A timed-out operation keeps its exact version and key for a safe repeat.
    setMode(attempt.current ? "delete" : "menu");
    if (!attempt.current) {
      setError("");
      setConflict(false);
      setUnknown(false);
    }
    modal.current?.showModal();
  }
  async function remove() {
    if (busy.current || offline || conflict) return;
    busy.current = true;
    setPending(true);
    setError("");
    const operation = attempt.current ?? {
      key: crypto.randomUUID(),
      expectedVersion: version,
    };
    attempt.current = operation;
    let sent = false;
    try {
      const csrf = await fetch("/api/auth/csrf", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (csrf.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (!csrf.ok)
        throw Error("Не удалось подготовить удаление. Повторите попытку.");
      const token = (await csrf.json()).data.csrfToken;
      sent = true;
      const response = await fetch(`/api/v1/events/${id}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
          "idempotency-key": operation.key,
        },
        body: JSON.stringify({ expectedVersion: operation.expectedVersion }),
      });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      const result = await response.json();
      if (!response.ok) {
        if (
          response.status === 409 &&
          result.error?.code === "VERSION_CONFLICT"
        ) {
          attempt.current = null;
          setUnknown(false);
          setConflict(true);
          setError(
            "Событие изменилось в другой вкладке. Загрузите актуальные сведения и снова подтвердите удаление.",
          );
          return;
        }
        if ([403, 404, 422].includes(response.status)) {
          attempt.current = null;
          setUnknown(false);
          if (response.status === 404) {
            setConflict(true);
            setError(
              "Событие недоступно. Возможно, оно удалено или у вас нет доступа.",
            );
            return;
          }
          sent = false;
        }
        throw Error(result.error?.message ?? "Не удалось удалить событие.");
      }
      if (result.data?.deleted !== true || result.data?.id !== id)
        throw Error();
      announceEventChange();
      window.location.replace("/events?deleted=1");
    } catch (caught) {
      if (sent) {
        setUnknown(true);
        setError(
          "Результат удаления пока не подтверждён. Проверьте его: повторная отправка прежней операции безопасна.",
        );
      } else
        setError(
          caught instanceof Error
            ? caught.message
            : "Не удалось удалить событие. Повторите попытку.",
        );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <>
      <TelegramBack
        warnBeforeClose={pending}
        onBack={() => {
          if (modal.current?.open) close();
          else router.push("/events");
        }}
      />
      <div className="event-actions">
        <Link href={`/events/${id}/edit`} className="primary">
          Редактировать событие
        </Link>
        <Link
          href={`/events/${id}/share`}
          className="secondary event-share-link"
        >
          Поделиться
        </Link>
        <button
          ref={opener}
          className="secondary event-more"
          aria-label="Другие действия с событием"
          aria-haspopup="dialog"
          onClick={open}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="4" cy="12" r="2.5" />
            <circle cx="12" cy="12" r="2.5" />
            <circle cx="20" cy="12" r="2.5" />
          </svg>
        </button>
      </div>
      {offline && (
        <p className="notice" role="status">
          Нет соединения с интернетом. Удаление станет доступно после
          подключения.
        </p>
      )}
      <dialog
        ref={modal}
        aria-labelledby="event-action-title"
        aria-describedby={mode === "delete" ? "delete-warning" : undefined}
        aria-busy={pending}
        onCancel={(event) => {
          if (busy.current) event.preventDefault();
        }}
        onClose={() => opener.current?.focus()}
      >
        <h2 id="event-action-title">
          {mode === "menu" ? "Действия с событием" : "Удалить событие?"}
        </h2>
        {mode === "menu" ? (
          <>
            <button className="danger" onClick={() => setMode("delete")}>
              Удалить событие
            </button>
            <button className="secondary" autoFocus onClick={close}>
              Отмена
            </button>
          </>
        ) : (
          <>
            <p className="delete-event-name">Удалить «{title}»?</p>
            <p id="delete-warning" className="muted">
              Ссылка на мероприятие перестанет работать. Это действие нельзя
              отменить.
            </p>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            {pending && (
              <p role="status">
                {unknown ? "Проверяем результат…" : "Удаляем событие…"}
              </p>
            )}
            {offline && <p role="status">Нет соединения с интернетом.</p>}
            <button
              className="secondary"
              autoFocus
              disabled={pending}
              onClick={close}
            >
              Отмена
            </button>
            {conflict ? (
              <button
                className="secondary"
                onClick={() => {
                  close();
                  onConflict();
                }}
              >
                Загрузить актуальные сведения
              </button>
            ) : (
              <button
                className="danger"
                disabled={pending || offline}
                onClick={remove}
              >
                {pending
                  ? "Подождите…"
                  : unknown
                    ? "Проверить удаление"
                    : "Удалить событие"}
              </button>
            )}
          </>
        )}
      </dialog>
    </>
  );
}
