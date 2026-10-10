import { databaseTls } from "./tls";
import "server-only";
import postgres from "postgres";
import { setting } from "../config";
let pool: ReturnType<typeof postgres> | undefined;
export function db() {
  pool ??= postgres(setting("DATABASE_URL"), {
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: databaseTls(),
  });
  return pool;
}
export type Transaction = postgres.TransactionSql;
export async function transaction<T>(
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return (await db().begin(async (tx) => work(tx))) as T;
}
