import "server-only";
import { cookies } from "next/headers";
import { token, tokenHash } from "../auth/crypto";
import type { Transaction } from "../db/client";
import { ANALYTICS_COOKIE, enabled } from "./journal";

// Default-on applies only to new contexts; it never reverses a recorded opt-out.
export async function defaultVisitor(
  tx: Transaction,
  principal: { userId?: string; guestId?: string },
  platform = "unknown",
) {
  if (!enabled()) return;
  const jar = await cookies();
  if (jar.get("__Host-fe_analytics_choice")?.value === "denied") return;
  const old = jar.get(ANALYTICS_COOKIE)?.value;
  if (old && /^[\w-]{43}$/.test(old)) {
    const [known] =
      await tx`SELECT id FROM app.analytics_visitors WHERE token_hash=${tokenHash(old)}`;
    // Includes revoked visitors: default-on is not renewed consent.
    if (known) return;
  }
  const [denied] =
    await tx`SELECT id FROM app.users WHERE analytics_denied_at IS NOT NULL AND (id=${principal.userId ?? null} OR id IN(SELECT linked_user_id FROM app.guest_identities WHERE id=${principal.guestId ?? null} AND merged_into_id IS NULL)) LIMIT 1`;
  if (denied) return;
  const raw = token();
  const suppress = !!jar.get("__Host-fe_analytics_reset") && !principal.userId;
  await tx`INSERT INTO app.analytics_visitors(token_hash,consent,consented_at,suppress_guest_identification,last_platform) VALUES(${tokenHash(raw)},true,now(),${suppress},${platform})`;
  return raw;
}
