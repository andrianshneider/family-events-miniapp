import "server-only";
import { transaction } from "../db/client";
import { createGuestSession } from "../auth/sessions";
import { tokenHash } from "../auth/crypto";
import { AppError } from "../errors";
export async function bootstrapGuest(
  raw: string | undefined,
  userId: string | null,
  restart: boolean,
) {
  return transaction(async (tx) => {
    // Serialize binding to the same confirmed account before locking its identities.
    if (userId)
      await tx`SELECT id FROM app.users WHERE id=${userId} FOR UPDATE`;
    const [existing] =
      raw && /^[\w-]{43}$/.test(raw)
        ? await tx`SELECT g.id,g.linked_user_id FROM app.guest_sessions s JOIN app.guest_identities g ON g.id=s.guest_identity_id WHERE s.token_hash=${tokenHash(raw)} AND s.revoked_at IS NULL AND s.expires_at>now() AND g.merged_into_id IS NULL FOR UPDATE OF g`
        : [];
    if (existing && !restart) {
      if (
        userId &&
        existing.linked_user_id &&
        existing.linked_user_id !== userId
      )
        throw new AppError(
          409,
          "GUEST_ACCOUNT_CONFLICT",
          "На устройстве сохранён ответ другого Telegram-аккаунта. Автоматическая смена гостя запрещена.",
        );
      if (userId && !existing.linked_user_id) {
        const [canonical] =
          await tx`SELECT id FROM app.guest_identities WHERE linked_user_id=${userId} AND merged_into_id IS NULL FOR UPDATE`;
        if (canonical && canonical.id !== existing.id)
          throw new AppError(
            409,
            "GUEST_LINK_REQUIRED",
            "Анонимный ответ сохранён. Для объединения с Telegram требуется отдельная безопасная привязка; сейчас можно продолжить анонимно.",
          );
        await tx`UPDATE app.guest_identities SET linked_user_id=${userId} WHERE id=${existing.id}`;
      }
      return { raw: raw!, created: false };
    }
    if (raw && !existing && !restart)
      throw new AppError(
        401,
        "GUEST_SESSION_LOST",
        "Гостевая сессия истекла или недоступна. Прежний анонимный ответ нельзя восстановить по имени.",
      );
    if (
      existing &&
      restart &&
      userId &&
      existing.linked_user_id &&
      existing.linked_user_id !== userId
    ) {
      await tx`UPDATE app.guest_sessions SET revoked_at=now() WHERE token_hash=${tokenHash(raw!)}`;
    } else if (existing && restart)
      throw new AppError(
        409,
        "GUEST_SESSION_ACTIVE",
        "Действующая гостевая сессия уже существует.",
      );
    const [identity] = userId
      ? await tx`INSERT INTO app.guest_identities(linked_user_id) VALUES(${userId}) ON CONFLICT(linked_user_id) DO UPDATE SET linked_user_id=excluded.linked_user_id RETURNING id`
      : await tx`INSERT INTO app.guest_identities DEFAULT VALUES RETURNING id`;
    return { raw: await createGuestSession(tx, identity.id), created: true };
  });
}
