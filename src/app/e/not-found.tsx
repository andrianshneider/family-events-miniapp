"use client";
import {useAnalyticsError} from "@/lib/analytics/client";
export default function UnavailableInvitation() {
  useAnalyticsError("event_view",true);
  return (
    <main className="shell event-shell">
      <div className="brand">
        <span aria-hidden="true">♡</span>Family Events
      </div>
      <h1>Это мероприятие недоступно</h1>
      <p>Уточните ссылку у отправителя.</p>
    </main>
  );
}
