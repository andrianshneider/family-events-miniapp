import "server-only";
import { transaction } from "../db/client";
import { createOrganizerSession } from "../auth/sessions";
import type { VerifiedTelegramUser } from "../telegram/init-data";
export async function login(user: VerifiedTelegramUser, previousHash?: Buffer) {
  return transaction(async (tx) => {
    const [row] =
      await tx`INSERT INTO app.users(telegram_user_id,display_name,username,avatar_url,locale) VALUES(${user.telegramId},${user.displayName},${user.username},${user.avatarUrl},${user.locale}) ON CONFLICT(telegram_user_id) DO UPDATE SET display_name=excluded.display_name,username=excluded.username,avatar_url=excluded.avatar_url,locale=excluded.locale RETURNING id,display_name`;
    if (previousHash)
      await tx`UPDATE app.organizer_sessions SET revoked_at=now() WHERE token_hash=${previousHash} AND revoked_at IS NULL`;
    const raw = await createOrganizerSession(tx, row.id);
    return { raw, user: { id: row.id, displayName: row.display_name } };
  });
}
