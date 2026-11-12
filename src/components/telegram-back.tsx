"use client";
import Script from "next/script";
import { useEffect, useRef } from "react";
type Back = {
  show(): void;
  hide(): void;
  onClick(callback: () => void): void;
  offClick(callback: () => void): void;
};
type App = {
  initData?: string;
  ready(): void;
  expand(): void;
  BackButton?: Back;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
};
export function TelegramBack({
  onBack,
  warnBeforeClose = false,
}: {
  onBack: () => void;
  warnBeforeClose?: boolean;
}) {
  const closeGuard = useRef(warnBeforeClose);
  const callback = useRef(onBack);
  useEffect(() => {
    callback.current = onBack;
  }, [onBack]);
  const attached = useRef<Back | undefined>(undefined);
  const handler = useRef(() => callback.current());
  useEffect(() => {
    closeGuard.current = warnBeforeClose;
    const app = (window as Window & { Telegram?: { WebApp?: App } }).Telegram
      ?.WebApp;
    if (!app?.initData) return;
    if (warnBeforeClose) app.enableClosingConfirmation?.();
    else app.disableClosingConfirmation?.();
  }, [warnBeforeClose]);
  function attach() {
    const app = (window as Window & { Telegram?: { WebApp?: App } }).Telegram
      ?.WebApp;
    if (!app?.initData) return;
    app?.ready();
    app?.expand();
    if (closeGuard.current) app.enableClosingConfirmation?.();
    else app.disableClosingConfirmation?.();
    if (!attached.current && app?.BackButton) {
      attached.current = app.BackButton;
      app.BackButton.show();
      app.BackButton.onClick(handler.current);
    }
  }
  useEffect(() => {
    attach();
    const click = handler.current;
    return () => {
      attached.current?.offClick(click);
      attached.current?.hide();
      attached.current = undefined;
      (
        window as Window & { Telegram?: { WebApp?: App } }
      ).Telegram?.WebApp?.disableClosingConfirmation?.();
    };
  }, []);
  return (
    <Script
      src="https://telegram.org/js/telegram-web-app.js"
      strategy="afterInteractive"
      onReady={attach}
    />
  );
}
