import type { Summary } from "@/lib/rsvp";
export function GuestSummary({ summary }: { summary: Summary }) {
  return (
    <section className="guest-summary" aria-label="Ответы гостей">
      <div className="response-summary">
        <p>
          <strong>{summary.responses.yes}</strong>
          <span>Будут</span>
        </p>
        <p>
          <strong>{summary.responses.no}</strong>
          <span>Не будут</span>
        </p>
        <p>
          <strong>{summary.responses.maybe}</strong>
          <span>Пока не знают</span>
        </p>
      </div>
      <p>
        Подтвердили: {summary.confirmed.adults} взрослых ·{" "}
        {summary.confirmed.children} детей
      </p>
      <p className="hint">Всего ответов: {summary.responses.total}</p>
    </section>
  );
}
