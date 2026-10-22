import "server-only";
import { z } from "zod";
import type { OrganizerPrincipal } from "@/types/principal";
import type { OrganizerNotifications } from "@/lib/organizer-notifications";
import { db, transaction } from "../db/client";
import { ownedEvent } from "../db/authorization";
import { AppError, unauthenticated, unavailable } from "../errors";
import { idempotent } from "../db/idempotency";
import { token, tokenHash } from "../auth/crypto";
import { setting } from "../config";
import { validateInitData } from "../telegram/init-data";
export const subscriptionInput = z.object({ enabled: z.boolean() }).strict();
export const handoffInput = z
  .object({ mode: z.enum(["mini_app", "bot_start"]) })
  .strict();
export async function notificationSettings(
  p: OrganizerPrincipal,
  eventId: string,
): Promise<OrganizerNotifications> {
  if (!z.uuid().safeParse(eventId).success) throw unavailable();
  const [e] =
    await db()`SELECT e.title,s.enabled,c.delivery_state,c.permission_granted_at FROM app.events e LEFT JOIN app.notification_subscriptions s ON s.event_id=e.id AND s.user_id=${p.userId} AND s.role='organizer' AND s.revoked_at IS NULL LEFT JOIN app.telegram_channels c ON c.user_id=${p.userId} WHERE e.id=${eventId} AND e.organizer_id=${p.userId} AND e.deleted_at IS NULL`;
  if (!e) throw unavailable();
  const [h] =
    await db()`SELECT id,state,expires_at FROM app.organizer_notification_handoffs WHERE organizer_session_id=${p.sessionId} AND event_id=${eventId} ORDER BY created_at DESC LIMIT 1`;
  const ready = e.delivery_state === "ready" && e.permission_granted_at;
  return {
    eventTitle: e.title,
    enabled: Boolean(e.enabled && ready),
    channel: ready
      ? "ready"
      : e.delivery_state === "blocked"
        ? "blocked"
        : "unknown",
    handoff: h
      ? {
          id: h.id,
          state:
            new Date(h.expires_at).getTime() <= Date.now() &&
            ["pending", "account_mismatch"].includes(h.state)
              ? "expired"
              : h.state,
          expiresAt: new Date(h.expires_at).toISOString(),
        }
      : null,
  };
}
export async function setNotificationSubscription(
  p: OrganizerPrincipal,
  eventId: string,
  enabled: boolean,
  key: string,
) {
  if (!z.uuid().safeParse(eventId).success) throw unavailable();
  return transaction(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"organizer-notifications:" + p.userId},0))`;
    const [session] =
      await tx`SELECT id FROM app.organizer_sessions WHERE id=${p.sessionId} AND user_id=${p.userId} AND revoked_at IS NULL AND expires_at>now() FOR SHARE`;
    if (!session) throw unauthenticated();
    await ownedEvent(tx, p, eventId);
    return idempotent(
      tx,
      "organizer:" + p.userId,
      `PUT /events/${eventId}/notification-subscription`,
      key,
      { enabled },
      async () => {
        if (enabled) {
          const [c] =
            await tx`SELECT user_id FROM app.telegram_channels WHERE user_id=${p.userId} AND permission_granted_at IS NOT NULL AND delivery_state='ready' FOR SHARE`;
          if (!c)
            throw new AppError(
              409,
              "TELEGRAM_PERMISSION_REQUIRED",
              "Сначала разрешите боту сообщения и проверьте подключение.",
            );
        }
        await tx`INSERT INTO app.notification_subscriptions(event_id,user_id,role,enabled,consented_at,revoked_at) VALUES(${eventId},${p.userId},'organizer',${enabled},${enabled ? new Date() : null},${enabled ? null : new Date()}) ON CONFLICT(event_id,user_id,role) DO UPDATE SET enabled=excluded.enabled,consented_at=CASE WHEN excluded.enabled THEN now() ELSE app.notification_subscriptions.consented_at END,revoked_at=excluded.revoked_at`;
        if (!enabled) {
          await tx`UPDATE app.organizer_notification_handoffs SET state='cancelled' WHERE user_id=${p.userId} AND event_id=${eventId} AND state IN('pending','account_mismatch')`;
          await tx`UPDATE app.notifications SET status='cancelled',locked_until=NULL WHERE subscription_id IN(SELECT id FROM app.notification_subscriptions WHERE event_id=${eventId} AND user_id=${p.userId} AND role='organizer') AND status IN('pending','processing')`;
        }
        return { status: 200, body: { saved: true } };
      },
    );
  });
}
export async function beginNotificationHandoff(
  p: OrganizerPrincipal,
  eventId: string,
  mode: "mini_app" | "bot_start",
) {
  if (!z.uuid().safeParse(eventId).success) throw unavailable();
  const raw = token();
  return transaction(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"organizer-notifications:" + p.userId},0))`;
    const [session] =
      await tx`SELECT id FROM app.organizer_sessions WHERE id=${p.sessionId} AND user_id=${p.userId} AND revoked_at IS NULL AND expires_at>now() FOR SHARE`;
    if (!session) throw unauthenticated();
    await ownedEvent(tx, p, eventId);
    await tx`UPDATE app.organizer_notification_handoffs SET state='cancelled' WHERE user_id=${p.userId} AND state IN('pending','account_mismatch')`;
    const [h] =
      await tx`INSERT INTO app.organizer_notification_handoffs(token_hash,user_id,organizer_session_id,event_id,mode,expires_at,created_at) VALUES(${tokenHash(raw)},${p.userId},${p.sessionId},${eventId},${mode},clock_timestamp()+interval '10 minutes',clock_timestamp()) RETURNING id,expires_at`;
    return {
      id: h.id,
      expiresAt: new Date(h.expires_at).toISOString(),
      telegramUrl: `https://t.me/${setting("TELEGRAM_BOT_USERNAME")}?start=notify_${raw}`,
    };
  });
}
export async function confirmSignedPermission(
  p: OrganizerPrincipal,
  eventId: string,
  initData: string,
) {
  if (!z.uuid().safeParse(eventId).success) throw unavailable();
  const verified = validateInitData(initData, setting("TELEGRAM_BOT_TOKEN"));
  const signedUser = JSON.parse(
    new URLSearchParams(initData).get("user") ?? "{}",
  );
  if (signedUser.allows_write_to_pm !== true)
    throw new AppError(
      409,
      "TELEGRAM_PERMISSION_PENDING",
      "Разрешение ещё не подтверждено сервером. Проверьте подключение или откройте бота.",
    );
  return transaction(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"organizer-notifications:" + p.userId},0))`;
    await ownedEvent(tx, p, eventId);
    const [u] =
      await tx`SELECT telegram_user_id FROM app.users WHERE id=${p.userId}`;
    if (String(u.telegram_user_id) !== verified.telegramId)
      throw new AppError(
        409,
        "TELEGRAM_ACCOUNT_MISMATCH",
        "В Telegram открыт другой аккаунт.",
      );
    const [s] =
      await tx`SELECT id FROM app.organizer_sessions WHERE id=${p.sessionId} AND user_id=${p.userId} AND revoked_at IS NULL AND expires_at>now() FOR SHARE`;
    if (!s) throw unauthenticated();
    const [h] =
      await tx`SELECT id FROM app.organizer_notification_handoffs WHERE event_id=${eventId} AND organizer_session_id=${p.sessionId} AND mode='mini_app' AND state='pending' AND expires_at>now() ORDER BY created_at DESC LIMIT 1 FOR UPDATE`;
    if (!h)
      throw new AppError(409, "HANDOFF_EXPIRED", "Создайте новое подключение.");
    const [blocked] =
      await tx`SELECT user_id FROM app.telegram_channels WHERE user_id=${p.userId} AND delivery_state='blocked' AND last_verified_at>to_timestamp(${Number(new URLSearchParams(initData).get("auth_date"))})`;
    if (blocked)
      throw new AppError(
        409,
        "TELEGRAM_PERMISSION_REQUIRED",
        "Разблокируйте бота и разрешите сообщения заново.",
      );
    await tx`INSERT INTO app.telegram_channels(user_id,chat_id,permission_granted_at,permission_source,delivery_state,last_verified_at) VALUES(${p.userId},${verified.telegramId},now(),'mini_app','ready',now()) ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id,permission_granted_at=now(),permission_source='mini_app',delivery_state='ready',last_verified_at=now()`;
    await tx`INSERT INTO app.notification_subscriptions(event_id,user_id,role,enabled,consented_at) VALUES(${eventId},${p.userId},'organizer',true,now()) ON CONFLICT(event_id,user_id,role) DO UPDATE SET enabled=true,consented_at=now(),revoked_at=NULL`;
    await tx`UPDATE app.organizer_notification_handoffs SET state='confirmed',consumed_at=now() WHERE id=${h.id}`;
    return { confirmed: true };
  });
}
