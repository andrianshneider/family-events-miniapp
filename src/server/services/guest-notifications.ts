import "server-only";
import { z } from "zod";
import { transaction, type Transaction } from "../db/client";
import { token, tokenHash, encrypt, decrypt } from "../auth/crypto";
import { createGuestSession } from "../auth/sessions";
import { setting } from "../config";
import { validateInitData } from "../telegram/init-data";
import { AppError, unavailable, unauthenticated } from "../errors";
import { validPublicId } from "./public-events";
import { planReminders } from "../notifications/guest";
import type { GuestPrincipal } from "@/types/principal";
export const completeInput = z
  .object({
    handoffId: z.uuid(),
    confirmAccount: z.literal(true),
    choices: z
      .record(
        z.uuid(),
        z
          .object({
            choice: z.enum(["current", "telegram"]),
            currentVersion: z.number().int().positive(),
            telegramVersion: z.number().int().positive(),
          })
          .strict(),
      )
      .default({}),
  })
  .strict();
async function current(tx: Transaction, p: GuestPrincipal, publicId: string) {
  validPublicId(publicId);
  const [g] =
    await tx`SELECT g.id,g.linked_user_id FROM app.guest_identities g JOIN app.guest_sessions s ON s.guest_identity_id=g.id WHERE s.id=${p.sessionId} AND g.id=${p.guestIdentityId} AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND g.merged_into_id IS NULL`;
  if (!g) throw unauthenticated();
  const [e] =
    await tx`SELECT id,title FROM app.events WHERE public_id=${publicId} AND deleted_at IS NULL`;
  if (!e) throw unavailable();
  if (
    !(
      await tx`SELECT id FROM app.rsvps WHERE event_id=${e.id} AND guest_identity_id=${g.id}`
    ).length
  )
    throw new AppError(
      409,
      "RSVP_REQUIRED",
      "Сначала ответьте на приглашение.",
    );
  return { g, e };
}
export async function guestNotificationSettings(
  p: GuestPrincipal,
  publicId: string,
  expectedUserId: string | null = null,
) {
  return transaction(async (tx) => {
    const { g, e } = await current(tx, p, publicId);
    const [s] =
      await tx`SELECT s.enabled,c.delivery_state,c.permission_granted_at FROM app.notification_subscriptions s LEFT JOIN app.telegram_channels c ON c.user_id=s.user_id WHERE s.event_id=${e.id} AND s.guest_identity_id=${g.id} AND s.role='guest' AND s.revoked_at IS NULL`;
    const [h] =
      await tx`SELECT id,state,expires_at,token_ciphertext,confirmed_user_id FROM app.auth_handoffs WHERE guest_session_id=${p.sessionId} AND event_id=${e.id} ORDER BY created_at DESC LIMIT 1`;
    const [u] = g.linked_user_id
      ? await tx`SELECT display_name FROM app.users WHERE id=${g.linked_user_id}`
      : [];
    const [channel] = g.linked_user_id
      ? await tx`SELECT delivery_state,permission_granted_at FROM app.telegram_channels WHERE user_id=${g.linked_user_id}`
      : [];
    return {
      eventTitle: e.title,
      accountConflict: !!(
        expectedUserId &&
        h?.confirmed_user_id &&
        h.confirmed_user_id !== expectedUserId
      ),
      enabled:
        !!s?.enabled &&
        s.delivery_state === "ready" &&
        !!s.permission_granted_at,
      linkedName: u?.display_name ?? null,
      channel:
        channel?.delivery_state === "blocked"
          ? "blocked"
          : channel?.permission_granted_at
            ? channel.delivery_state
            : "unknown",
      handoff: h
        ? {
            id: h.id,
            url:
              h.state === "pending" &&
              new Date(h.expires_at).getTime() > Date.now() &&
              h.token_ciphertext
                ? `https://t.me/${setting("TELEGRAM_BOT_USERNAME")}?start=guest_${decrypt(h.token_ciphertext)}`
                : null,
            state:
              ["pending", "verified"].includes(h.state) &&
              new Date(h.expires_at).getTime() <= Date.now()
                ? "expired"
                : h.state,
          }
        : null,
    };
  });
}
export async function beginGuestHandoff(p: GuestPrincipal, publicId: string) {
  return transaction(async (tx) => {
    const { g, e } = await current(tx, p, publicId);
    await tx`SELECT id FROM app.guest_sessions WHERE id=${p.sessionId} FOR UPDATE`;
    const [existing] =
      await tx`SELECT id,state,token_ciphertext FROM app.auth_handoffs WHERE guest_session_id=${p.sessionId} AND event_id=${e.id} AND state IN('pending','verified') AND expires_at>clock_timestamp() ORDER BY created_at DESC LIMIT 1 FOR UPDATE`;
    if (existing?.state === "verified") return { id: existing.id, url: null };
    if (existing?.token_ciphertext)
      return {
        id: existing.id,
        url: `https://t.me/${setting("TELEGRAM_BOT_USERNAME")}?start=guest_${decrypt(existing.token_ciphertext)}`,
      };
    await tx`UPDATE app.auth_handoffs SET state='cancelled' WHERE guest_session_id=${p.sessionId} AND state IN('pending','verified')`;
    const raw = token();
    const [h] =
      await tx`INSERT INTO app.auth_handoffs(token_hash,token_ciphertext,guest_identity_id,guest_session_id,event_id,expires_at,created_at) VALUES(${tokenHash(raw)},${encrypt(raw)},${g.id},${p.sessionId},${e.id},clock_timestamp()+interval '10 minutes',clock_timestamp()) RETURNING id`;
    return {
      id: h.id,
      url: `https://t.me/${setting("TELEGRAM_BOT_USERNAME")}?start=guest_${raw}`,
    };
  });
}
export async function verifyGuestMini(
  p: GuestPrincipal,
  publicId: string,
  initData: string,
) {
  const u = validateInitData(initData, setting("TELEGRAM_BOT_TOKEN"));
  const parsed = JSON.parse(new URLSearchParams(initData).get("user")!);
  if (parsed.allows_write_to_pm !== true)
    throw new AppError(
      409,
      "WRITE_PERMISSION_REQUIRED",
      "Разрешение ещё не подтверждено. Откройте бота в Telegram.",
    );
  return transaction(async (tx) => {
    const { g, e } = await current(tx, p, publicId);
    const [user] =
      await tx`INSERT INTO app.users(telegram_user_id,display_name) VALUES(${u.telegramId},${u.displayName}) ON CONFLICT(telegram_user_id) DO UPDATE SET telegram_user_id=excluded.telegram_user_id RETURNING id`;
    if (g.linked_user_id && g.linked_user_id !== user.id)
      throw new AppError(
        409,
        "GUEST_ACCOUNT_CONFLICT",
        "Ответ связан с другим Telegram-аккаунтом.",
      );
    await tx`SELECT pg_advisory_xact_lock(hashtextextended('organizer-notifications:'||${user.id},0))`;
    if (
      (
        await tx`SELECT user_id FROM app.telegram_channels WHERE user_id=${user.id} AND delivery_state='blocked' AND last_verified_at>to_timestamp(${Number(new URLSearchParams(initData).get("auth_date"))})`
      ).length
    )
      throw new AppError(409, "BOT_BLOCKED", "Подключите бота заново.");
    await tx`INSERT INTO app.telegram_channels(user_id,chat_id,permission_granted_at,permission_source,delivery_state,last_verified_at) VALUES(${user.id},${u.telegramId},now(),'mini_app','ready',now()) ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id,permission_granted_at=now(),permission_source='mini_app',delivery_state='ready',last_verified_at=now()`;
    await tx`UPDATE app.auth_handoffs SET state='cancelled' WHERE guest_session_id=${p.sessionId} AND state IN('pending','verified')`;
    const [h] =
      await tx`INSERT INTO app.auth_handoffs(token_hash,guest_identity_id,guest_session_id,event_id,expires_at,confirmed_user_id,state) VALUES(${tokenHash(token())},${g.id},${p.sessionId},${e.id},now()+interval '10 minutes',${user.id},'verified') RETURNING id`;
    return { id: h.id };
  });
}
export async function guestHandoffStatus(
  p: GuestPrincipal,
  publicId: string,
  id: string,
) {
  return transaction(async (tx) => {
    const { g, e } = await current(tx, p, publicId);
    const [h] =
      await tx`SELECT h.*,u.display_name FROM app.auth_handoffs h LEFT JOIN app.users u ON u.id=h.confirmed_user_id WHERE h.id=${id} AND h.guest_session_id=${p.sessionId} AND h.event_id=${e.id}`;
    if (!h) throw unavailable();
    const conflicts =
      h.state === "verified" && h.confirmed_user_id
        ? await tx`SELECT a.event_id,e.title,a.guest_name AS current_name,a.status AS current_status,b.guest_name AS telegram_name,b.status AS telegram_status,a.version AS current_version,b.version AS telegram_version FROM app.rsvps a JOIN app.rsvps b ON b.event_id=a.event_id JOIN app.guest_identities c ON c.id=b.guest_identity_id JOIN app.events e ON e.id=a.event_id WHERE a.guest_identity_id=${g.id} AND c.linked_user_id=${h.confirmed_user_id} AND c.id<>${g.id}`
        : [];
    return {
      id: h.id,
      state:
        ["pending", "verified"].includes(h.state) &&
        new Date(h.expires_at).getTime() <= Date.now()
          ? "expired"
          : h.state,
      accountName: h.display_name ?? null,
      conflicts,
    };
  });
}
export async function completeGuestHandoff(
  p: GuestPrincipal,
  publicId: string,
  data: z.infer<typeof completeInput>,
  expectedUserId: string | null = null,
) {
  return transaction(async (tx) => {
    // Serialize all identity binding for the same account, then lock identities in UUID order.
    const [proof] =
      await tx`SELECT confirmed_user_id FROM app.auth_handoffs WHERE id=${data.handoffId} AND guest_session_id=${p.sessionId}`;
    if (!proof?.confirmed_user_id) throw unavailable();
    if (expectedUserId && proof.confirmed_user_id !== expectedUserId)
      throw new AppError(
        409,
        "GUEST_ACCOUNT_CONFLICT",
        "В Telegram открыт другой аккаунт. Подключите аккаунт, с которым выполнен вход в браузере.",
      );
    await tx`SELECT id FROM app.users WHERE id=${proof.confirmed_user_id} FOR UPDATE`;
    const { g, e } = await current(tx, p, publicId);
    const [h] =
      await tx`SELECT * FROM app.auth_handoffs WHERE id=${data.handoffId} AND guest_session_id=${p.sessionId} AND event_id=${e.id} FOR UPDATE`;
    if (
      !h ||
      new Date(h.expires_at).getTime() <= Date.now() ||
      !["verified", "completed"].includes(h.state)
    )
      throw new AppError(
        409,
        "HANDOFF_EXPIRED",
        "Подключение истекло. Создайте новое.",
      );
    const uid = h.confirmed_user_id;
    if (h.state === "completed")
      return { raw: await createGuestSession(tx, g.id) };
    if (g.linked_user_id && g.linked_user_id !== uid)
      throw new AppError(
        409,
        "GUEST_ACCOUNT_CONFLICT",
        "Ответ связан с другим аккаунтом.",
      );
    const [canonical] =
      await tx`SELECT id FROM app.guest_identities WHERE linked_user_id=${uid} AND merged_into_id IS NULL`;
    const target = canonical?.id ?? g.id;
    await tx`SELECT id FROM app.guest_identities WHERE id IN(${g.id},${target}) ORDER BY id FOR UPDATE`;
    await tx`SELECT id FROM app.events WHERE id IN(SELECT event_id FROM app.rsvps WHERE guest_identity_id IN(${g.id},${target})) ORDER BY id FOR UPDATE`;
    if (
      !(
        await tx`SELECT id FROM app.events WHERE id=${e.id} AND deleted_at IS NULL`
      ).length
    )
      throw unavailable();
    if (target !== g.id) {
      const conflicts =
        await tx`SELECT a.event_id,a.version AS current_version,b.version AS telegram_version FROM app.rsvps a JOIN app.rsvps b ON b.event_id=a.event_id WHERE a.guest_identity_id=${g.id} AND b.guest_identity_id=${target} ORDER BY a.event_id FOR UPDATE OF a,b`;
      if (conflicts.some((r) => !data.choices[r.event_id]))
        throw new AppError(
          409,
          "RSVP_MERGE_CONFLICT",
          "Выберите, какой ответ сохранить для каждого события.",
        );
      for (const c of conflicts) {
        const pick = data.choices[c.event_id];
        if (
          pick.currentVersion !== c.current_version ||
          pick.telegramVersion !== c.telegram_version
        )
          throw new AppError(
            409,
            "RSVP_MERGE_VERSION_CONFLICT",
            "Ответ изменился. Проверьте актуальные ответы перед объединением.",
          );
        const discard = pick.choice === "current" ? target : g.id;
        await tx`DELETE FROM app.rsvps WHERE event_id=${c.event_id} AND guest_identity_id=${discard}`;
      }
      await tx`UPDATE app.rsvps SET guest_identity_id=${target} WHERE guest_identity_id=${g.id}`;
      await tx`UPDATE app.gift_reservations SET guest_identity_id=${target} WHERE guest_identity_id=${g.id}`;
      await tx`UPDATE app.guest_sessions SET guest_identity_id=${target} WHERE guest_identity_id=${g.id}`;
      await tx`UPDATE app.analytics_events SET guest_identity_id=${target} WHERE guest_identity_id=${g.id}`;
      await tx`UPDATE app.guest_identities SET merged_into_id=${target} WHERE id=${g.id}`;
    } else
      await tx`UPDATE app.guest_identities SET linked_user_id=${uid} WHERE id=${g.id}`;
    await tx`SELECT id FROM app.events WHERE id=${e.id} AND deleted_at IS NULL FOR UPDATE`;
    if (
      !(
        await tx`SELECT user_id FROM app.telegram_channels WHERE user_id=${uid} AND delivery_state='ready' AND permission_granted_at IS NOT NULL`
      ).length
    )
      throw new AppError(
        409,
        "BOT_PERMISSION_REQUIRED",
        "Подключите бота заново.",
      );
    await tx`INSERT INTO app.notification_subscriptions(event_id,user_id,guest_identity_id,role,enabled,consented_at) VALUES(${e.id},${uid},${target},'guest',true,now()) ON CONFLICT(event_id,user_id,role) DO UPDATE SET guest_identity_id=excluded.guest_identity_id,enabled=true,consented_at=now(),revoked_at=NULL`;
    await tx`UPDATE app.auth_handoffs SET state='completed',consumed_at=coalesce(consumed_at,now()) WHERE id=${h.id}`;
    const affected =
      await tx`SELECT event_id FROM app.rsvps WHERE guest_identity_id=${target} ORDER BY event_id`;
    for (const row of affected) await planReminders(tx, row.event_id);
    const raw = await createGuestSession(tx, target);
    return { raw };
  });
}
export async function setGuestSubscription(
  p: GuestPrincipal,
  publicId: string,
  enabled: boolean,
) {
  return transaction(async (tx) => {
    const { g, e } = await current(tx, p, publicId);
    await tx`SELECT id FROM app.events WHERE id=${e.id} AND deleted_at IS NULL FOR UPDATE`;
    if (enabled) {
      if (
        !g.linked_user_id ||
        !(
          await tx`SELECT user_id FROM app.telegram_channels WHERE user_id=${g.linked_user_id} AND delivery_state='ready' AND permission_granted_at IS NOT NULL`
        ).length
      )
        throw new AppError(
          409,
          "TELEGRAM_LINK_REQUIRED",
          "Сначала подключите Telegram.",
        );
      await tx`INSERT INTO app.notification_subscriptions(event_id,user_id,guest_identity_id,role,enabled,consented_at) VALUES(${e.id},${g.linked_user_id},${g.id},'guest',true,now()) ON CONFLICT(event_id,user_id,role) DO UPDATE SET enabled=true,consented_at=now(),revoked_at=NULL`;
    } else {
      await tx`UPDATE app.notification_subscriptions SET enabled=false,revoked_at=now() WHERE event_id=${e.id} AND guest_identity_id=${g.id} AND role='guest'`;
      await tx`UPDATE app.auth_handoffs SET state='cancelled' WHERE guest_session_id=${p.sessionId} AND event_id=${e.id} AND state IN('pending','verified')`;
      await tx`UPDATE app.notifications SET status='cancelled',locked_until=NULL WHERE status IN('pending','processing') AND subscription_id IN(SELECT id FROM app.notification_subscriptions WHERE event_id=${e.id} AND guest_identity_id=${g.id} AND role='guest')`;
    }
    await planReminders(tx, e.id);
    return { enabled };
  });
}
