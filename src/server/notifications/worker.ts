import { databaseTls } from "../db/tls";
import "server-only";
import postgres from "postgres";
import { z } from "zod";
import { setting } from "../config";
import { bot, BotError } from "../telegram/bot";
const message = z
  .object({
    text: z.string().min(1).max(4096),
    action: z
      .object({
        label: z.enum([
          "Открыть событие",
          "Открыть гостей",
          "Посмотреть событие",
          "Открыть мероприятие",
        ]),
        path: z
          .string()
          .regex(
            /^(?:\/events\/[0-9a-f-]{36}(\/guests)?|\/e\/[A-Za-z0-9_-]{22})$/i,
          ),
      })
      .strict()
      .optional(),
  })
  .strict();
export async function deliver() {
  const sql = postgres(setting("DATABASE_WORKER_URL"), {
    prepare: false,
    max: 1,
    ssl: databaseTls(),
  });
  let sent = 0;
  try {
    const jobs =
      await sql`SELECT id,chat_id,payload,attempt,lease::text AS lease FROM app.claim_notifications(3)`;
    for (const job of jobs) {
      const [check] =
        await sql`SELECT app.notification_deliverable(${job.id},${job.lease}::text::timestamptz) AS allowed`;
      if (!check.allowed) {
        await sql`SELECT app.finish_notification(${job.id},${job.lease}::text::timestamptz,NULL,'CANCELLED',1)`;
        continue;
      }
      const payload = message.safeParse(job.payload);
      if (!payload.success) {
        await sql`SELECT app.finish_notification(${job.id},${job.lease}::text::timestamptz,NULL,'CANCELLED',1)`;
        continue;
      }
      try {
        const result = await bot<{ message_id: number }>("sendMessage", {
          chat_id: String(job.chat_id),
          text: payload.data.text,
          ...(payload.data.action
            ? {
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text: payload.data.action.label,
                        url: new URL(
                          payload.data.action.path,
                          setting("APP_URL"),
                        ).href,
                      },
                    ],
                  ],
                },
              }
            : {}),
        });
        await sql`SELECT app.finish_notification(${job.id},${job.lease}::text::timestamptz,${result.message_id},NULL,1)`;
        sent++;
      } catch (error) {
        const code =
          error instanceof BotError ? String(error.code) : "NETWORK_ERROR";
        const delay =
          error instanceof BotError && error.retryAfter
            ? error.retryAfter
            : Math.min(3600, 2 ** job.attempt * 30) +
              Math.floor(Math.random() * 10);
        await sql`SELECT app.finish_notification(${job.id},${job.lease}::text::timestamptz,NULL,${code},${delay})`;
      }
    }
    return { processed: jobs.length, sent };
  } finally {
    await sql.end();
  }
}
