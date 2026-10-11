"use client";
export default function InvitationError({ reset }: { reset: () => void }) {
  return (
    <main className="shell event-shell">
      <h1>Не удалось открыть приглашение</h1>
      <p role="alert">Проверьте соединение и попробуйте снова.</p>
      <button className="secondary" onClick={reset}>
        Попробовать снова
      </button>
    </main>
  );
}
