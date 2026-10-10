import "server-only";
import { transaction, type Transaction } from "../db/client";
import { createOrganizerSession } from "../auth/sessions";
import { tokenHash } from "../auth/crypto";
import { AppError } from "../errors";
import type { VerifiedTelegramUser } from "../telegram/init-data";
export async function login(user: VerifiedTelegramUser, previousHash?: Buffer) {
  return transaction((tx) => authenticate(tx, user, previousHash));
}
async function authenticate(
  tx: Transaction,
  user: VerifiedTelegramUser,
  previousHash?: Buffer,
) {
  const [row] =
    await tx`INSERT INTO app.users(telegram_user_id,display_name,username,avatar_url,locale) VALUES(${user.telegramId},${user.displayName},${user.username},${user.avatarUrl},${user.locale}) ON CONFLICT(telegram_user_id) DO UPDATE SET display_name=excluded.display_name,username=excluded.username,avatar_url=excluded.avatar_url,locale=excluded.locale RETURNING id,display_name`;
  if (previousHash)
    await tx`UPDATE app.organizer_sessions SET revoked_at=now() WHERE token_hash=${previousHash} AND revoked_at IS NULL`;
  const raw = await createOrganizerSession(tx, row.id);
  return { raw, user: { id: row.id, displayName: row.display_name } };
}

// The endpoint validates signature and freshness before calling this service.
export async function loginMiniApp(
  user: VerifiedTelegramUser,
  initData: string,
  previous?: string,
  reauth?: string,
) {
  const digest = tokenHash(
    new URLSearchParams(
      [...new URLSearchParams(initData).entries()].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    ).toString(),
  );
  return transaction(async (tx) => {
    await tx`DELETE FROM app.mini_app_logins WHERE expires_at < now()`;
    const [claimed] =
      await tx`INSERT INTO app.mini_app_logins(digest,expires_at) VALUES(${digest},now()+interval '5 minutes') ON CONFLICT(digest) DO NOTHING RETURNING digest`;
    if (!claimed) {
      if (reauth && /^[\w-]{43}$/.test(reauth)) {
        const [grant] =
          await tx`SELECT l.digest FROM app.mini_app_logins l JOIN app.organizer_sessions s ON s.token_hash=l.session_hash JOIN app.users u ON u.id=s.user_id WHERE l.digest=${digest} AND l.reauth_hash=${tokenHash(reauth)} AND l.expires_at>now() AND s.revoked_at IS NOT NULL AND u.telegram_user_id=${user.telegramId} FOR UPDATE OF l`;
        if (grant) {
          const result = await authenticate(tx, user);
          await tx`UPDATE app.mini_app_logins SET session_hash=${tokenHash(result.raw)},reauth_hash=NULL WHERE digest=${digest}`;
          return result;
        }
      }
      if (previous && /^[\w-]{43}$/.test(previous)) {
        const [session] =
          await tx`SELECT u.id,u.display_name FROM app.mini_app_logins l JOIN app.organizer_sessions s ON s.token_hash=l.session_hash JOIN app.users u ON u.id=s.user_id WHERE l.digest=${digest} AND s.token_hash=${tokenHash(previous)} AND s.revoked_at IS NULL AND s.expires_at>now() AND u.telegram_user_id=${user.telegramId}`;
        if (session)
          return {
            raw: previous,
            user: { id: session.id, displayName: session.display_name },
          };
      }
      throw new AppError(
        401,
        "TELEGRAM_DATA_REPLAYED",
        "Перезапустите приложение в Telegram.",
      );
    }
    const result = await authenticate(
      tx,
      user,
      previous ? tokenHash(previous) : undefined,
    );
    await tx`UPDATE app.mini_app_logins SET session_hash=${tokenHash(result.raw)} WHERE digest=${digest}`;
    return result;
  });
}
