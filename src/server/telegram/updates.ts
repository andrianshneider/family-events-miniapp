import { databaseTls } from "../db/tls";
import "server-only";
import postgres from "postgres";
import { z } from "zod";
import { setting } from "../config";
import { decrypt, tokenHash } from "../auth/crypto";
const privateChat = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  type: z.literal("private"),
});
const user = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  first_name: z.string().optional(),
});
const update = z.object({
  message: z
    .object({
      text: z.string().optional(),
      date: z.number().int().positive(),
      write_access_allowed: z
        .object({ from_request: z.boolean().optional() })
        .passthrough()
        .optional(),
      chat: privateChat,
      from: user,
    })
    .optional(),
  my_chat_member: z
    .object({
      chat: privateChat,
      date: z.number().int().positive(),
      new_chat_member: z.object({ status: z.string() }),
    })
    .optional(),
});
export async function processUpdates() {
  const sql = postgres(setting("DATABASE_WORKER_URL"), {
    prepare: false,
    max: 1,
    ssl: databaseTls(),
  });
  let processed = 0;
  try {
    const jobs =
      await sql`SELECT bot_id,update_id,payload_ciphertext,lease::text AS lease FROM app.claim_telegram_updates(20)`;
    for (const job of jobs) {
      let success = false;
      try {
        const parsed = update.safeParse(
          JSON.parse(decrypt(job.payload_ciphertext)),
        );
        if (parsed.success) {
          const data = parsed.data;
          if (
            data.message &&
            /^\/start(?:@\w+)?$/.test(data.message.text ?? "") &&
            data.message.from.id === data.message.chat.id
          )
            await sql`SELECT app.record_telegram_channel_at(${String(data.message.from.id)},${String(data.message.chat.id)},false,${new Date(data.message.date * 1000)})`;
          if (data.message && data.message.from.id === data.message.chat.id) {
            const start = /^\/start(?:@\w+)? notify_([\w-]{43})$/.exec(
              data.message.text ?? "",
            );
            const guestStart = /^\/start(?:@\w+)? guest_([\w-]{43})$/.exec(
              data.message.text ?? "",
            );
            if (guestStart)
              await sql`SELECT app.verify_guest_handoff(${tokenHash(guestStart[1])},${String(data.message.from.id)},${String(data.message.chat.id)},${new Date(data.message.date * 1000)},${data.message.from.first_name ?? "Гость Telegram"})`;
            if (start)
              await sql`SELECT app.confirm_organizer_notification(${tokenHash(start[1])},${String(data.message.from.id)},${String(data.message.chat.id)},${new Date((data.message.date ?? 0) * 1000)},'bot_start')`;
            if (data.message.write_access_allowed && data.message.date)
              await sql`SELECT app.confirm_organizer_notification(NULL,${String(data.message.from.id)},${String(data.message.chat.id)},${new Date(data.message.date * 1000)},'mini_app')`;
          }
          if (
            data.my_chat_member &&
            ["kicked", "left"].includes(
              data.my_chat_member.new_chat_member.status,
            )
          )
            await sql`SELECT app.record_telegram_channel_at(${String(data.my_chat_member.chat.id)},${String(data.my_chat_member.chat.id)},true,${new Date(data.my_chat_member.date * 1000)})`;
        }
        success = true;
        processed++;
      } catch {
        /* Retry without logging raw Telegram content. */
      }
      await sql`SELECT app.finish_telegram_update(${job.bot_id},${job.update_id},${job.lease}::text::timestamptz,${success})`;
    }
    return { processed };
  } finally {
    await sql.end();
  }
}
