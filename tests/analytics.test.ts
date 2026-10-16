import { it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const b = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  headers: new Map<string, string>(),
  query: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) =>
      b.cookies.has(n) ? { value: b.cookies.get(n) } : undefined,
  }),
  headers: async () => ({ get: (n: string) => b.headers.get(n) ?? null }),
}));
vi.mock("@/server/db/client", () => ({
  db: () => b.query,
  transaction: b.transaction,
}));
import { append, success, optional } from "@/server/analytics/journal";
import { context, collect } from "@/server/analytics/context";
import {
  loginFact,
  resetAnalytics,
  linkedGuest,
} from "@/server/analytics/identity";
import { safePayload, drain } from "@/server/analytics/exporter";
import { createEvent } from "@/server/services/events";
import { tokenHash } from "@/server/auth/crypto";
import type { Transaction } from "@/server/db/client";
import { properties } from "@/lib/analytics/contract";
it("rejects PII, invented events and unsafe internal identifiers before export", () => {
  expect(() =>
    properties("app_entered", {
      entry_point: "direct",
      email: "canary@example.test",
    }),
  ).toThrow();
  expect(() =>
    safePayload("$identify", { $anon_distinct_id: "secret-canary" }),
  ).toThrow();
  expect(() => safePayload("invitation_created", {})).toThrow();
  const r = safePayload("share_result", {
    schema_version: "1.0",
    analytics_event_id: randomUUID(),
    occurred_at: new Date().toISOString(),
    environment: "local",
    app_version: "unknown",
    source: "client",
    platform: "web",
    origin_platform: "web",
    participant_role: "organizer",
    is_authenticated: true,
    traffic_class: "synthetic",
    event_id: randomUUID(),
    share_channel: "native",
    attempt_id: randomUUID(),
    outcome: "cancelled",
    $current_url: "https://secret.test/e/private?token=canary",
    title: "canary",
  });
  expect(JSON.stringify(r)).not.toContain("canary");
  expect(r).toMatchObject({
    outcome: "cancelled",
    $process_person_profile: false,
    $geoip_disable: true,
  });
});
it("enforces consent, same actor/event, savepoint fail-open, committed dedup, first touch, verified links, mixed-account resets and leased delivery", async () => {
  process.env.ANALYTICS_ENABLED = "true";
  process.env.APP_ENV = "local";
  process.env.SESSION_SECRET = "x".repeat(32);
  type TestRow = {
    id: string;
    distinct_id: string;
    event_id: string;
    properties: Record<string, unknown>;
    description: string;
    origin_event_id: string | null;
    n: number;
  };
  const pg = await PGlite.create();
  let seq = 0;
  function adapter(client: Pick<PGlite, "query" | "exec">) {
    const q = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.reduce((a, s, i) => a + (i ? "$" + i : "") + s, "");
      return (await client.query<TestRow>(text, values)).rows;
    };
    q.json = (value: unknown) => JSON.stringify(value);
    q.savepoint = async (work: (tx: unknown) => Promise<unknown>) => {
      const s = "a" + ++seq;
      await client.exec("SAVEPOINT " + s);
      try {
        const r = await work(q);
        await client.exec("RELEASE SAVEPOINT " + s);
        return r;
      } catch (e) {
        await client.exec("ROLLBACK TO SAVEPOINT " + s);
        await client.exec("RELEASE SAVEPOINT " + s);
        throw e;
      }
    };
    return q;
  }
  const query = adapter(pg),
    run = (work: (tx: Transaction) => Promise<unknown>) =>
      pg.transaction((tx) => work(adapter(tx) as unknown as Transaction));
  b.query.mockImplementation(query);
  b.transaction.mockImplementation(run);
  const tx = async (work: (tx: Transaction) => Promise<unknown>) => run(work);
  try {
    await pg.exec("CREATE ROLE anon;CREATE ROLE authenticated");
    for (const f of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pg.exec(await readFile("supabase/migrations/" + f, "utf8"));
    await pg.exec("SET ROLE fe_server");
    const [owner, u1, u2] =
      await query`INSERT INTO app.users(telegram_user_id,display_name) VALUES(1,'canary owner'),(2,'canary U1'),(3,'canary U2') RETURNING id`;
    const [e] =
      await query`INSERT INTO app.events(organizer_id,public_id,title,event_type,event_date,timezone,effective_at) VALUES(${owner.id},'abcdefghijklmnopqrstuv','canary address/title','family','2030-01-01','UTC','2030-01-01T00:00:00Z') RETURNING id`;
    await tx((t) =>
      append(
        t,
        "app_entered",
        { entry_point: "direct" },
        { role: "anonymous" },
      ),
    );
    expect(await query`SELECT id FROM app.analytics_events`).toHaveLength(0);
    const raw = "a".repeat(43);
    b.cookies.set("__Host-fe_analytics", raw);
    const [v] =
      await query`INSERT INTO app.analytics_visitors(token_hash,consent,consented_at,traffic_class,last_platform) VALUES(${tokenHash(raw)},true,now(),'synthetic','web') RETURNING id`;
    let c: Awaited<ReturnType<typeof context>> = null;
    await tx(async (t) => {
      c = await context(t, { kind: "public", id: "abcdefghijklmnopqrstuv" });
    });
    expect(c!.distinctId).toBe(v.id);
    expect(c!.eventId).toBe(e.id);
    expect(await query`SELECT id FROM app.guest_identities`).toHaveLength(0);
    const view = {
      name: "event_viewed",
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      platform: "web",
      locator: { kind: "public", id: "abcdefghijklmnopqrstuv" },
      properties: {
        navigation_id: randomUUID(),
        view_mode: "public",
        event_id: randomUUID(),
        actor_relation: "known_owner",
      },
    };
    await tx((t) => collect(t, view));
    await tx((t) => collect(t, view));
    const rows =
      await query`SELECT distinct_id,event_id,properties FROM app.analytics_events WHERE name='event_viewed'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      distinct_id: v.id,
      event_id: e.id,
      properties: { actor_relation: "unknown" },
    });
    const [g] =
      await query`INSERT INTO app.guest_identities DEFAULT VALUES RETURNING id`;
    const gr = "g".repeat(43);
    await query`INSERT INTO app.guest_sessions(guest_identity_id,token_hash,expires_at) VALUES(${g.id},${tokenHash(gr)},now()+interval '1 day')`;
    b.cookies.set("__Host-fe_guest", gr);
    await tx((t) =>
      success(
        t,
        "rsvp_submitted",
        {
          event_id: e.id,
          rsvp_id: randomUUID(),
          rsvp_version: 1,
          status: "yes",
          actor_relation: "unknown",
        },
        undefined,
        g.id,
      ),
    );
    expect(
      (
        await query`SELECT distinct_id FROM app.analytics_events WHERE name='rsvp_submitted'`
      )[0].distinct_id,
    ).toBe(v.id);
    // A swallowed PostgreSQL error inside telemetry must not leave the parent transaction aborted.
    await tx(async (t) => {
      await optional(t, async (s) => {
        await s`SELECT 1/0`;
      });
      await t`UPDATE app.events SET description='business committed after telemetry error' WHERE id=${e.id}`;
    });
    expect(
      (await query`SELECT description FROM app.events WHERE id=${e.id}`)[0]
        .description,
    ).toContain("committed");
    const count = (await query`SELECT id FROM app.analytics_events`).length;
    await expect(
      tx(async (t) => {
        await append(
          t,
          "app_entered",
          { entry_point: "direct" },
          { role: "anonymous" },
        );
        throw Error("rollback");
      }),
    ).rejects.toThrow();
    expect(await query`SELECT id FROM app.analytics_events`).toHaveLength(
      count,
    );
    await query`UPDATE app.guest_identities SET linked_user_id=${u1.id} WHERE id=${g.id}`;
    await tx((t) => linkedGuest(t, g.id, g.id, u1.id));
    expect(
      await query`SELECT id FROM app.analytics_events WHERE name='$identify'`,
    ).toHaveLength(1);
    await tx((t) => loginFact(t, u1.id, "telegram_oidc"));
    expect(
      (await query`SELECT origin_event_id FROM app.users WHERE id=${u1.id}`)[0]
        .origin_event_id,
    ).toBe(e.id);
    const createKey = randomUUID(),
      data = {
        title: "canary new event",
        eventType: "family" as const,
        eventDate: "2030-01-01",
        timezone: "UTC",
      };
    const p = {
      kind: "organizer" as const,
      userId: u1.id,
      sessionId: randomUUID(),
    };
    await createEvent(p, data, createKey);
    await createEvent(p, data, createKey);
    const made =
      await query`SELECT properties FROM app.analytics_events WHERE name='event_created'`;
    expect(made).toHaveLength(1);
    expect(made[0].properties.origin_event_id).toBe(e.id);
    expect(JSON.stringify(made)).not.toContain("canary");
    let reset: string | undefined;
    await tx(async (t) => {
      reset = await resetAnalytics(t);
    });
    b.cookies.set("__Host-fe_analytics", reset!);
    await tx((t) =>
      append(
        t,
        "app_entered",
        { entry_point: "direct" },
        { guestId: g.id, role: "anonymous" },
      ),
    );
    const anon =
      await query`SELECT distinct_id FROM app.analytics_events WHERE name='app_entered' ORDER BY received_at DESC LIMIT 1`;
    expect(anon[0].distinct_id).not.toBe(u1.id);
    let switched: string | undefined;
    await tx(async (t) => {
      switched = await loginFact(t, u2.id, "telegram_oidc");
    });
    expect(switched).toBeDefined();
    b.cookies.set("__Host-fe_analytics", switched!);
    expect(
      (
        await query`SELECT properties FROM app.analytics_events WHERE name='$identify' AND distinct_id=${u2.id}`
      )[0].properties.$anon_distinct_id,
    ).not.toBe(u1.id);
    // Outage retries same journal UUID; legacy is never exported; injected transport represents provider ACK only.
    const attempts: string[] = [];
    await drain(async (r) => {
      attempts.push(r.id);
      throw Error("provider down canary");
    });
    expect(
      (
        await query`SELECT count(*)::int AS n FROM app.analytics_events WHERE delivery_status='sent'`
      )[0].n,
    ).toBe(0);
    await query`UPDATE app.analytics_events SET next_attempt_at=now()`;
    for (let i = 0; i < 6; i++)
      await drain(async (r) => {
        expect(JSON.stringify(safePayload(r.name, r.properties))).not.toContain(
          "canary",
        );
        attempts.push(r.id);
      });
    expect(
      (
        await query`SELECT count(*)::int AS n FROM app.analytics_events WHERE delivery_status='pending'`
      )[0].n,
    ).toBe(0);
    expect(new Set(attempts).size).toBeLessThan(attempts.length);
    await query`UPDATE app.analytics_visitors SET consent=false,revoked_at=now() WHERE token_hash=${tokenHash(switched!)}`;
    const before = (await query`SELECT id FROM app.analytics_events`).length;
    await tx((t) =>
      append(
        t,
        "app_entered",
        { entry_point: "direct" },
        { role: "anonymous" },
      ),
    );
    expect(await query`SELECT id FROM app.analytics_events`).toHaveLength(
      before,
    );
    // Q16: local, deterministic metric fixture; never a staging business-state mutation.
    await query`DELETE FROM app.analytics_events`;
    const [ownEvent] =
      await query`SELECT id FROM app.events WHERE organizer_id=${u1.id} LIMIT 1`;
    const actor = randomUUID(),
      baseTime = new Date(Date.now() - 10 * 86400000);
    async function fact(
      name: string,
      eventId: string,
      actorId: string,
      extra: Record<string, unknown>,
      offset: number,
    ) {
      const id = randomUUID(),
        at = new Date(baseTime.getTime() + offset);
      const value = {
        schema_version: "1.0",
        environment: "production",
        traffic_class: "external",
        event_id: eventId,
        ...extra,
      };
      await query`INSERT INTO app.analytics_events(id,name,event_id,distinct_id,schema_version,properties,occurred_at,delivery_status) VALUES(${id},${name},${eventId},${actorId},'1.0',${JSON.stringify(value)},${at.toISOString()},'sent')`;
    }
    await fact("event_created", e.id, owner.id, {}, -86400000);
    await fact("event_created", ownEvent.id, u1.id, {}, -86400000);
    await fact(
      "event_viewed",
      e.id,
      actor,
      { view_mode: "public", actor_relation: "unknown" },
      0,
    );
    await fact(
      "rsvp_submitted",
      e.id,
      actor,
      { status: "no", actor_relation: "unknown" },
      3600000,
    );
    await fact(
      "gift_reserved",
      ownEvent.id,
      actor,
      { actor_relation: "unknown" },
      7200000,
    );
    const dashboard = JSON.parse(
      await readFile("docs/analytics/dashboard-v1.json", "utf8"),
    );
    for (const widget of dashboard.widgets) {
      const r = await pg.query<{ metric: string; n: number }>(widget.sql);
      if (widget.id === 2) {
        expect(Number(r.rows[0].n)).toBe(1);
        expect(Number(r.rows[1].n)).toBe(2);
      }
    }
  } finally {
    delete process.env.ANALYTICS_ENABLED;
    b.cookies.clear();
    await pg.close();
  }
}, 30000);
it("uses the pinned actual SDK with stable UUID/insert ID and no browser defaults or IP enrichment", async () => {
  const { PostHog } = await import("posthog-node");
  const captured: string[] = [];
  const sdk = new PostHog("phc_test_only", {
    host: "https://us.i.posthog.com",
    disableGeoip: true,
    flushInterval: 0,
    fetchRetryCount: 0,
    fetch: async (_url, options) => {
      const { gunzipSync } = await import("node:zlib");
      captured.push(
        typeof options.body === "string"
          ? options.body
          : gunzipSync(Buffer.from(options.body as Uint8Array)).toString(),
      );
      return { status: 200, text: async () => "{}", json: async () => ({}) };
    },
  });
  const id = randomUUID();
  try {
    await sdk.captureImmediate({
      distinctId: randomUUID(),
      event: "app_entered",
      uuid: id,
      timestamp: new Date("2026-10-16T00:00:00Z"),
      properties: {
        $insert_id: id,
        entry_point: "direct",
        $process_person_profile: false,
        $geoip_disable: true,
      },
      disableGeoip: true,
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toContain(id);
    for (const forbidden of [
      "$current_url",
      "$referrer",
      "$initial_",
      "canary",
      "$pageview",
      "$session_id",
    ])
      expect(captured[0]).not.toContain(forbidden);
    expect(captured[0]).toContain('"$geoip_disable":true');
  } finally {
    await sdk.shutdown();
  }
});
