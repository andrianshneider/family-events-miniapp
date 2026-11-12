import { adultsCount, childrenCount, peopleCount } from "@/lib/russian-count";
import type { Summary } from "@/lib/rsvp";
export function GuestSummary({ summary }: { summary: Summary }) {
  return (
    <section className="guest-summary" aria-label="Ответы гостей">
      <p>
        <strong>
          Ожидаем{" "}
          {peopleCount(summary.confirmed.adults + summary.confirmed.children)}
        </strong>
      </p>
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
        Подтвердили: {adultsCount(summary.confirmed.adults)} ·{" "}
        {childrenCount(summary.confirmed.children)}
      </p>
      <p className="hint">Всего ответов: {summary.responses.total}</p>
    </section>
  );
}
