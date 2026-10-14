"use client";
import { usePwa } from "./pwa-provider";
export function InstallHelp() {
  const { prompt, ios, hidden, installing, error, install } = usePwa();
  if (hidden || (!ios && !prompt && !installing && !error)) return null;
  return (
    <section className="install-help" aria-label="Установка Family Events">
      {(prompt || installing) && (
        <button className="secondary" onClick={install} disabled={installing}>
          {installing ? "Открываем установку…" : "Установить Family Events"}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {ios && (
        <details>
          <summary>Добавить на экран «Домой»</summary>
          <ol>
            <li>В Safari нажмите «Поделиться», затем «На экран “Домой”».</li>
            <li>
              Если есть переключатель «Открывать как веб-приложение», включите
              его.
            </li>
            <li>Нажмите «Добавить» и откройте Family Events с новой иконки.</li>
          </ol>
          <p>
            При первом запуске может понадобиться снова войти через Telegram.
            Используйте тот же аккаунт — ваши события сохранятся. Для работы
            нужен интернет.
          </p>
        </details>
      )}
      {!ios && (
        <p>
          Установку также можно открыть через меню поддерживаемого браузера.
          Войдите тем же аккаунтом Telegram, чтобы увидеть свои события.
        </p>
      )}
    </section>
  );
}
