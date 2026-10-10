import "server-only";
import { db, transaction } from "../db/client";
import { randomBytes } from "node:crypto";
import { storage, mediaBucket } from "../storage/client";
export async function infrastructureHealth() {
  const [database] =
    await db()`SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema='app'`;
  if (database.tables !== 21) throw new Error("Unexpected database schema");
  const { data, error } = await storage().getBucket(mediaBucket());
  if (error || !data || data.public)
    throw new Error("Private storage unavailable");
  const sentinel = new Error("rollback smoke");
  let dal = false;
  try {
    await transaction(async (tx) => {
      const identity = (
        BigInt("0x" + randomBytes(6).toString("hex")) + 1000000000000n
      ).toString();
      const [row] =
        await tx`INSERT INTO app.users(telegram_user_id,display_name) VALUES(${identity},'Infrastructure smoke') RETURNING id`;
      const [read] = await tx`SELECT id FROM app.users WHERE id=${row.id}`;
      dal = read.id === row.id;
      throw sentinel;
    });
  } catch (error) {
    if (error !== sentinel) throw error;
  }
  if (!dal) throw new Error("DAL unavailable");
  return { database: true, schema: true, storage: true, dal: true };
}
