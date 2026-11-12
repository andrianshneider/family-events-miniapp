"use client";
import { Brand } from "@/components/brand";
import { useAnalyticsError } from "@/lib/analytics/client";
export default function UnavailableInvitation() {
  useAnalyticsError("event_view", true);
  return (
    <main className="shell event-shell">
      <Brand />
      <h1>Это мероприятие недоступно</h1>
      <p>Уточните ссылку у отправителя.</p>
    </main>
  );
}
