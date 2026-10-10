import "server-only";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { OrganizerPrincipal, GuestPrincipal } from "@/types/principal";
import { db, type Transaction } from "../db/client";
import { token, tokenHash } from "./crypto";
import { unauthenticated } from "../errors";
export const ORG_COOKIE = "__Host-fe_org",
  GUEST_COOKIE = "__Host-fe_guest";
export const ORG_TTL = 30 * 86400,
  GUEST_TTL = 180 * 86400;
export function sessionCookie(
  response: NextResponse,
  name: string,
  value: string,
  maxAge: number,
) {
  response.cookies.set(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}
export async function createOrganizerSession(tx: Transaction, userId: string) {
  const raw = token();
  await tx`INSERT INTO app.organizer_sessions(user_id,token_hash,expires_at) VALUES(${userId},${tokenHash(raw)},now()+interval '30 days')`;
  return raw;
}
export async function createGuestSession(tx: Transaction, identityId: string) {
  const raw = token();
  await tx`INSERT INTO app.guest_sessions(guest_identity_id,token_hash,expires_at) VALUES(${identityId},${tokenHash(raw)},now()+interval '180 days')`;
  return raw;
}
const validToken = (raw: string | undefined) =>
  raw && /^[\w-]{43}$/.test(raw) ? raw : undefined;
export async function organizer(): Promise<OrganizerPrincipal> {
  const raw = validToken((await cookies()).get(ORG_COOKIE)?.value);
  if (!raw) throw unauthenticated();
  const [row] =
    await db()`SELECT id,user_id FROM app.organizer_sessions WHERE token_hash=${tokenHash(raw)} AND revoked_at IS NULL AND expires_at>now()`;
  if (!row) throw unauthenticated();
  return { kind: "organizer", userId: row.user_id, sessionId: row.id };
}
export async function guest(): Promise<GuestPrincipal> {
  const raw = validToken((await cookies()).get(GUEST_COOKIE)?.value);
  if (!raw) throw unauthenticated();
  const [row] =
    await db()`SELECT s.id,g.id AS identity_id FROM app.guest_sessions s JOIN app.guest_identities g ON g.id=s.guest_identity_id WHERE s.token_hash=${tokenHash(raw)} AND s.revoked_at IS NULL AND s.expires_at>now() AND g.merged_into_id IS NULL`;
  if (!row) throw unauthenticated();
  return { kind: "guest", guestIdentityId: row.identity_id, sessionId: row.id };
}
