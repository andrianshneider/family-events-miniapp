"use client";
import Script from "next/script";
import { useEffect, useRef } from "react";
type Back = {
  show(): void;
  hide(): void;
  onClick(callback: () => void): void;
  offClick(callback: () => void): void;
};
type App = { ready(): void; expand(): void; BackButton?: Back };
export function TelegramBack({ onBack }: { onBack: () => void }) {
  const callback = useRef(onBack);
  useEffect(() => {
    callback.current = onBack;
  }, [onBack]);
  const attached = useRef<Back | undefined>(undefined);
  const handler = useRef(() => callback.current());
  function attach() {
    const app = (window as Window & { Telegram?: { WebApp?: App } }).Telegram
      ?.WebApp;
    app?.ready();
    app?.expand();
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
