import Link from "next/link";
export default function UnavailableEvent() {
  return (
    <main className="shell">
      <h1>Событие недоступно</h1>
      <p>Оно удалено или у вас нет доступа.</p>
      <Link href="/events" className="secondary">
        Мои события
      </Link>
    </main>
  );
}
