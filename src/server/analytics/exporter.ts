import { envelope } from "@/lib/analytics/envelope";
import { z } from "zod";
import "server-only";
import { PostHog } from "posthog-node";
import { randomUUID } from "node:crypto";
import { db, transaction } from "../db/client";
import { enabled } from "./journal";
import { properties, specs, type EventName } from "@/lib/analytics/contract";
import { log } from "../log";
export function configured() {
  const host = process.env.POSTHOG_HOST,
    key = process.env.POSTHOG_PROJECT_KEY;
  return (
    enabled() &&
    !!key &&
    ["https://eu.i.posthog.com", "https://us.i.posthog.com"].includes(
      host ?? "",
    ) &&
    process.env.POSTHOG_ENVIRONMENT === "non-production"
  );
}
export function safePayload(name: string, p: Record<string, unknown>) {
  if (name === "$identify") {
    const control = z
      .object({
        $anon_distinct_id: z.uuid().optional(),
        $set: z
          .object({
            has_created_event: z.boolean().optional(),
            first_guest_origin_event_id: z.uuid().optional(),
            first_guest_seen_at: z.iso.datetime().optional(),
          })
          .strict()
          .optional(),
        $set_once: z
          .object({
            signup_date: z.iso.datetime().optional(),
            first_platform: z.enum(["web", "telegram", "pwa"]).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .parse(p);
    return { ...control, $process_person_profile: true, $geoip_disable: true };
  }
  if (!(name in specs)) throw Error("LEGACY_EVENT");
  const shape = specs[name as EventName].shape;
  const semantic = Object.fromEntries(
    Object.keys(shape)
      .filter((k) => k in p)
      .map((k) => [k, p[k]]),
  );
  const clean = properties(name as EventName, semantic);
  const result = { ...clean, ...envelope.parse(p) };
  return { ...result, $process_person_profile: false, $geoip_disable: true };
}
export async function drain(
  send?: (row: {
    id: string;
    name: string;
    distinct_id: string;
    properties: Record<string, unknown>;
    occurred_at: Date;
  }) => Promise<void>,
) {
  if (!configured() && !send) return { configured: false, sent: 0 };
  let sdk: PostHog | undefined;
  if (!send) {
    sdk = new PostHog(process.env.POSTHOG_PROJECT_KEY!, {
      host: process.env.POSTHOG_HOST!,
      flushAt: 1,
      flushInterval: 0,
      requestTimeout: 5000,
      fetchRetryCount: 0,
      disableGeoip: true,
    });
    send = async (row) => {
      await sdk!.captureImmediate({
        distinctId: row.distinct_id,
        event: row.name,
        properties: {
          ...safePayload(row.name, row.properties),
          $insert_id: row.id,
        },
        timestamp: new Date(row.occurred_at),
        uuid: row.id,
        disableGeoip: true,
      });
    };
  }
  let sent = 0;
  try {
    await db()`UPDATE app.analytics_events a SET delivery_status='suppressed',locked_until=NULL,lease_id=NULL FROM app.analytics_visitors v LEFT JOIN app.users u ON u.id=v.user_id WHERE a.visitor_id=v.id AND a.delivery_status IN('pending','processing') AND (NOT v.consent OR v.revoked_at IS NOT NULL OR u.analytics_denied_at IS NOT NULL)`;
    for (let i = 0; i < 3; i++) {
      const lease = randomUUID();
      const row = await transaction(async (tx) => {
        const [r] =
          await tx`SELECT a.* FROM app.analytics_events a JOIN app.analytics_visitors v ON v.id=a.visitor_id LEFT JOIN app.users u ON u.id=v.user_id WHERE a.schema_version='1.0' AND v.consent AND v.revoked_at IS NULL AND u.analytics_denied_at IS NULL AND ((a.delivery_status='pending' AND a.next_attempt_at<=now()) OR (a.delivery_status='processing' AND a.locked_until<now())) ORDER BY a.received_at,a.id FOR UPDATE OF a SKIP LOCKED LIMIT 1`;
        if (!r) return null;
        await tx`UPDATE app.analytics_events SET delivery_status='processing',attempts=attempts+1,lease_id=${lease},locked_until=now()+interval '30 seconds' WHERE id=${r.id}`;
        return r;
      });
      if (!row) break;
      try {
        // Validate again even when tests inject a transport. Never trust arbitrary stored JSON.
        safePayload(row.name, row.properties);
        const live =
          await db()`SELECT a.id FROM app.analytics_events a JOIN app.analytics_visitors v ON v.id=a.visitor_id LEFT JOIN app.users u ON u.id=v.user_id WHERE a.id=${row.id} AND a.lease_id=${lease} AND a.delivery_status='processing' AND v.consent AND v.revoked_at IS NULL AND u.analytics_denied_at IS NULL`;
        if (!live.length) continue;
        await send(row as Parameters<NonNullable<typeof send>>[0]);
        await db()`UPDATE app.analytics_events SET delivery_status='sent',sent_at=now(),locked_until=NULL,lease_id=NULL,last_error_code=NULL WHERE id=${row.id} AND lease_id=${lease} AND delivery_status='processing'`;
        sent++;
      } catch (error) {
        const invalid =
          error instanceof z.ZodError ||
          (error instanceof Error && error.message === "LEGACY_EVENT");
        await db()`UPDATE app.analytics_events SET delivery_status=${invalid ? "failed" : "pending"},next_attempt_at=now()+least(3600,power(2,least(attempts,11))::integer)*interval '1 second',locked_until=NULL,lease_id=NULL,last_error_code=${invalid ? "SCHEMA_REJECTED" : "EXPORT_FAILED"} WHERE id=${row.id} AND lease_id=${lease} AND delivery_status='processing'`;
        log("analytics_export_retry", {
          code: invalid ? "SCHEMA_REJECTED" : "EXPORT_FAILED",
        });
      }
    }
  } finally {
    await sdk?.shutdown();
  }
  return { configured: true, sent };
}
export async function queueHealth() {
  const rows =
    await db()`SELECT delivery_status,count(*)::int AS count,coalesce(extract(epoch FROM now()-min(received_at)),0)::integer AS oldest_seconds FROM app.analytics_events WHERE schema_version='1.0' GROUP BY delivery_status`;
  return {
    configured: configured(),
    statuses: rows,
    alert: rows.some(
      (r) =>
        ["pending", "processing"].includes(r.delivery_status) &&
        r.oldest_seconds > 300,
    ),
  };
}
