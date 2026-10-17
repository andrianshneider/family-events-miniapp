"use client";
import Link from "next/link";
export default function EventError({ reset }: { reset: () => void }) {
  return (
    <main className="shell">
      <h1>Не удалось загрузить страницу</h1>
      <p role="alert">Проверьте соединение и повторите попытку.</p>
      <button className="secondary" onClick={reset}>
        Попробовать снова
      </button>
      <p>
        <Link href="/events">Мои события</Link>
      </p>
    </main>
  );
}
