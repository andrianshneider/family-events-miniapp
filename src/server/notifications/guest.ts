import "server-only";
import type { Transaction } from "../db/client";
import { transaction } from "../db/client";
import { reminderAt } from "../services/time";
import { enqueue } from "./outbox";
import { ownedEvent } from "../db/authorization";
import { idempotent } from "../db/idempotency";
import { AppError, unavailable } from "../errors";
import type { OrganizerPrincipal } from "@/types/principal";
export async function planReminders(tx: Transaction, eventId: string) {
  const [e] =
    await tx`SELECT id,title,public_id,event_date::text,start_time::text,timezone,venue_name,address,schedule_version FROM app.events WHERE id=${eventId} AND deleted_at IS NULL`;
  if (!e) return;
  const key = `event:${e.id}:schedule:${e.schedule_version}`;
  await tx`UPDATE app.notifications SET status='cancelled',locked_until=NULL WHERE type='reminder_24h' AND status IN('pending','processing') AND trigger_key<>${key} AND subscription_id IN(SELECT id FROM app.notification_subscriptions WHERE event_id=${eventId})`;
  const at = reminderAt(
    e.event_date,
    e.start_time?.slice(0, 5) ?? null,
    e.timezone,
  );
  if (!at) return;
  const subs =
    await tx`SELECT s.id,r.status FROM app.notification_subscriptions s JOIN app.rsvps r ON r.event_id=s.event_id AND r.guest_identity_id=s.guest_identity_id JOIN app.telegram_channels c ON c.user_id=s.user_id WHERE s.event_id=${eventId} AND s.role='guest' AND s.enabled AND s.revoked_at IS NULL AND s.consented_at IS NOT NULL AND c.delivery_state='ready' AND c.permission_granted_at IS NOT NULL AND r.status IN('yes','maybe')`;
  for (const s of subs) {
    const text = `${s.status === "maybe" ? "🔔 Напоминание о мероприятии" : "🎉 Завтра"} ${e.title}\n${e.event_date}${e.start_time ? " · " + e.start_time.slice(0, 5) : ""}\nЧасовой пояс: ${e.timezone}${e.venue_name ? "\n" + e.venue_name : ""}${e.address ? "\n" + e.address : ""}`;
    await enqueue(tx, s.id, "reminder_24h", key, text, at, {
      label: "Открыть мероприятие",
      path: `/e/${e.public_id}`,
    });
    // Opt-out/no -> yes may re-arm only an unsent cancelled schedule, never sent/failed.
    await tx`UPDATE app.notifications SET status='pending',locked_until=NULL,attempts=0,last_error_code=NULL,next_attempt_at=${at},scheduled_at=${at},payload=${tx.json({ text, action: { label: "Открыть мероприятие", path: `/e/${e.public_id}` } })} WHERE subscription_id=${s.id} AND type='reminder_24h' AND trigger_key=${key} AND status IN('cancelled','pending') AND provider_message_id IS NULL`;
  }
}
export async function decideChange(
  p: OrganizerPrincipal,
  eventId: string,
  changeId: string,
  decision: "send" | "skip",
  key: string,
) {
  return transaction(async (tx) => {
    const [session] =
      await tx`SELECT id FROM app.organizer_sessions WHERE id=${p.sessionId} AND user_id=${p.userId} AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`;
    if (!session) throw new AppError(401, "SESSION_EXPIRED", "Войдите снова.");
    const e = await ownedEvent(tx, p, eventId);
    return idempotent(
      tx,
      "organizer:" + p.userId,
      `POST /events/${eventId}/changes/${changeId}/decision`,
      key,
      { decision },
      async () => {
        const [change] =
          await tx`SELECT * FROM app.event_changes WHERE id=${changeId} AND event_id=${eventId} FOR UPDATE`;
        if (!change) throw unavailable();
        if (change.notify_decision !== "pending") {
          if (change.notify_decision !== decision)
            throw new AppError(
              409,
              "CHANGE_ALREADY_DECIDED",
              "Решение по уведомлению уже принято.",
            );
          return { status: 200, body: { decision } };
        }
        if (change.event_version !== e.version)
          throw new AppError(
            409,
            "STALE_EVENT_CHANGE",
            "Событие изменилось. Это уведомление устарело.",
          );
        const [event] =
          await tx`SELECT title,public_id FROM app.events WHERE id=${eventId}`;
        if (decision === "send") {
          const labels: Record<string, string> = {
            eventDate: "Дата",
            startTime: "Начало",
            endTime: "Окончание",
            timezone: "Часовой пояс",
            venueName: "Место",
            address: "Адрес",
          };
          const text =
            `⚠️ Изменилась информация о мероприятии\n${event.title}\n` +
            Object.entries(change.changes as Record<string, { after: unknown }>)
              .map(
                ([field, v]) =>
                  `${labels[field] ?? field}: ${v.after === null || v.after === "" ? "не указано" : String(v.after)}`,
              )
              .join("\n");
          const subs =
            await tx`SELECT s.id FROM app.notification_subscriptions s JOIN app.telegram_channels c ON c.user_id=s.user_id JOIN app.rsvps r ON r.event_id=s.event_id AND r.guest_identity_id=s.guest_identity_id WHERE s.event_id=${eventId} AND s.role='guest' AND s.enabled AND s.revoked_at IS NULL AND s.consented_at IS NOT NULL AND c.delivery_state='ready' AND c.permission_granted_at IS NOT NULL`;
          for (const s of subs)
            await enqueue(
              tx,
              s.id,
              "event_changed",
              `change:${changeId}`,
              text,
              new Date().toISOString(),
              { label: "Посмотреть событие", path: `/e/${event.public_id}` },
            );
        }
        await tx`UPDATE app.event_changes SET notify_decision=${decision},decided_at=now() WHERE id=${changeId}`;
        return { status: 200, body: { decision } };
      },
    );
  });
}
