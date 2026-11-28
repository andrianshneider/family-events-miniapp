"use client";
import { useEffect, useRef } from "react";
import { usePwa } from "./pwa-provider";
import { pwaText } from "@/lib/pwa-copy";
export function InstallHelp({ home = false }: { home?: boolean }) {
  const {
    available,
    kind,
    installing,
    message,
    instructions,
    install,
    closeInstructions,
  } = usePwa();
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (instructions && available) dialog.current?.showModal();
    else dialog.current?.close();
  }, [instructions, available]);
  useEffect(() => () => closeInstructions(), [closeInstructions]);
  if (!available || (!home && kind === "telegram")) return null;
  return (
    <section
      className={home ? "home-install" : "install-help"}
      aria-label={pwaText("title")}
    >
      <button
        ref={trigger}
        type="button"
        className={`secondary${home ? " home-install-button" : ""}`}
        onClick={install}
        disabled={installing}
        aria-busy={installing}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="12" height="18" rx="2" />
          <path d="M8 17h2m5-9h7m-3.5-3.5v7" />
        </svg>
        <span>
          {installing ? pwaText("opening") : pwaText(home ? "add" : "install")}
        </span>
      </button>
      {message && (
        <p role="status" className="hint">
          {message}
        </p>
      )}
      <dialog
        ref={dialog}
        role="dialog"
        className="install-dialog"
        aria-labelledby={home ? "home-install-title" : "login-install-title"}
        onClose={() => {
          closeInstructions();
          if (available) trigger.current?.focus();
        }}
      >
        <h2 id={home ? "home-install-title" : "login-install-title"}>
          {pwaText("title")}
        </h2>
        {instructions === "ios" ? (
          <ol>
            <li>{pwaText("iosShare")}</li>
            <li>{pwaText("iosHome")}</li>
            <li>{pwaText("iosFinish")}</li>
          </ol>
        ) : (
          <p>{pwaText("browser")}</p>
        )}
        <p className="muted">{pwaText("account")}</p>
        <button
          type="button"
          className="primary"
          autoFocus
          onClick={() => dialog.current?.close()}
        >
          {pwaText("close")}
        </button>
      </dialog>
    </section>
  );
}
