"use client";
export type Platform = "telegram" | "web" | "pwa";
export function platform(): Platform {
  if (typeof window === "undefined") return "web";
  const telegram = (
    window as Window & { Telegram?: { WebApp?: { initData?: string } } }
  ).Telegram?.WebApp;
  return telegram?.initData
    ? "telegram"
    : window.matchMedia("(display-mode: standalone)").matches
      ? "pwa"
      : "web";
}
