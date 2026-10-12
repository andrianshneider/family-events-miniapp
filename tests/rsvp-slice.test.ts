import { it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
const bridge = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  query: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      bridge.cookies.has(name)
        ? { value: bridge.cookies.get(name) }
        : undefined,
  }),
}));
vi.mock("@/server/db/client", () => ({
  db: () => bridge.query,
  transaction: bridge.transaction,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Error("TEST_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw Error("TEST_REDIRECT:" + url);
  },
  useRouter: () => ({ push: vi.fn() }),
}));
import { POST as session } from "@/app/api/guest/session/route";
import { GET as context } from "@/app/api/v1/public/events/[publicId]/my-context/route";
import {
  GET as own,
  PUT,
} from "@/app/api/v1/public/events/[publicId]/rsvp/route";
import { GET as list } from "@/app/api/v1/events/[eventId]/guests/route";
import { GET as summary } from "@/app/api/v1/events/[eventId]/summary/route";
import { eventGuests } from "@/server/services/guests";
import { tokenHash, csrf } from "@/server/auth/crypto";
import { organizerEvent } from "@/server/services/events";
import { publicEvent } from "@/server/services/public-events";
import { GuestListScreen } from "@/components/guest-list-screen";
import { PublicEventScreen } from "@/components/public-event-screen";
import GuestsPage from "@/app/events/[eventId]/guests/page";
import { returnPath } from "@/server/telegram/oidc";

it("preserves guest authority and one RSVP through real session/context/write/list handlers, transactions and failures", async () => {
  process.env.APP_URL = "https://example.test";
  process.env.VERCEL = "0";
  process.env.APP_ENV = "local";
  process.env.SESSION_SECRET = "s".repeat(32);
  process.env.RATE_LIMIT_SECRET = "r".repeat(32);
  process.env.GUEST_SESSION_RATE_LIMIT = "200";
  process.env.GUEST_WRITE_SESSION_RATE_LIMIT = "200";
  process.env.GUEST_WRITE_IP_RATE_LIMIT = "300";
  process.env.PUBLIC_READ_RATE_LIMIT = "300";
  const pg = await PGlite.create();
  const adapter = (client: Pick<PGlite, "query">) =>
    Object.assign(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.reduce(
          (text, part, index) => text + (index ? "$" + index : "") + part,
          "",
        );
        return (
          await client.query<Record<string, string | number | boolean | null>>(
            sql,
            values,
          )
        ).rows;
      },
      { json: JSON.stringify },
    );
  const query = adapter(pg);
  bridge.query.mockImplementation(query);
  bridge.transaction.mockImplementation(
    (work: (tx: unknown) => Promise<unknown>) =>
      pg.transaction((tx) => work(adapter(tx))),
  );
  const req = (
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
    token?: string,
  ) =>
    new Request("https://example.test" + path, {
      method,
      headers: {
        Origin: "https://example.test",
        "Content-Type": "application/json",
        ...(key ? { "idempotency-key": key } : {}),
        ...(token ? { "x-csrf-token": token } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const publicId = randomBytes(16).toString("base64url");
  let eventId = "";
  const ctx = () =>
    context(req("/context"), { params: Promise.resolve({ publicId }) });
  const put = (
    body: unknown,
    key = "rsvp-key-save-000001",
    token = csrf(bridge.cookies.get("__Host-fe_guest") ?? ""),
  ) =>
    PUT(req("/rsvp", "PUT", body, key, token), {
      params: Promise.resolve({ publicId }),
    });
  const guests = (query = "") =>
    list(req("/api/v1/events/" + eventId + "/guests" + query), {
      params: Promise.resolve({ eventId }),
    });
  async function bootstrap(options: unknown = {}) {
    const response = await session(req("/api/guest/session", "POST", options));
    const cookie = response.headers
      .getSetCookie()
      .find((v) => v.startsWith("__Host-fe_guest="));
    if (cookie)
      bridge.cookies.set("__Host-fe_guest", cookie.split(";")[0].split("=")[1]);
    return response;
  }
  const first = {
    guestName: "  Анна 😊  ",
    status: "yes",
    adultsCount: 2,
    childrenCount: 1,
    comment: " Со двора\nБудем позже ",
    expectedVersion: null,
  };
  try {
    await pg.exec("CREATE ROLE anon;CREATE ROLE authenticated;");
    for (const file of (await readdir("supabase/migrations"))
      .filter((v) => v.endsWith(".sql"))
      .sort())
      await pg.exec(await readFile("supabase/migrations/" + file, "utf8"));
    await pg.exec("SET ROLE fe_server");
    const users =
      await query`INSERT INTO app.users(telegram_user_id,display_name) VALUES(3001,'Organizer'),(3002,'Other') RETURNING id`;
    const [event] =
      await query`INSERT INTO app.events(organizer_id,public_id,title,event_type,event_date,timezone,effective_at) VALUES(${users[0].id},${publicId},'RSVP fixture','family','2030-01-01','UTC','2030-01-01T00:00Z') RETURNING id`;
    eventId = String(event.id);
    await query`INSERT INTO app.wishlists(event_id) VALUES(${eventId})`;
    expect((await (await ctx()).json()).data).toMatchObject({
      rsvp: null,
      sessionState: "none",
    });
    expect(await query`SELECT id FROM app.guest_identities`).toHaveLength(0);
    expect((await put(first)).status).toBe(401);
    const boot = await bootstrap();
    expect(boot.status).toBe(201);
    const flags = boot.headers.getSetCookie()[0];
    for (const flag of [
      "HttpOnly",
      "Secure",
      "SameSite=lax",
      "Path=/",
      "Max-Age=15552000",
    ])
      expect(flags.toLowerCase()).toContain(flag.toLowerCase());
    expect(flags).not.toContain("Domain=");
    const raw = bridge.cookies.get("__Host-fe_guest")!;
    const [g1] =
      await query`SELECT guest_identity_id FROM app.guest_sessions WHERE token_hash=${tokenHash(raw)}`;
    const guestId = String(g1.guest_identity_id);
    expect(await query`SELECT id FROM app.guest_identities`).toHaveLength(1);
    expect((await bootstrap()).status).toBe(200);
    expect(bridge.cookies.get("__Host-fe_guest")).toBe(raw);
    expect(await query`SELECT id FROM app.guest_sessions`).toHaveLength(1);
    expect((await bootstrap({ guestIdentityId: "forged" })).status).toBe(422);
    expect((await put(first, "rsvp-nocsrf-000001", "bad")).status).toBe(403);
    expect((await put({ ...first, guestIdentityId: guestId })).status).toBe(
      422,
    );
    for (const fields of [
      { guestName: "😊" },
      { guestName: "А".repeat(61) },
      { adultsCount: 0 },
      { adultsCount: 21 },
      { childrenCount: -1 },
      { childrenCount: 21 },
      { adultsCount: 1.5 },
      { comment: "😊".repeat(301) },
      { status: "no", adultsCount: 1, childrenCount: 0 },
    ])
      expect((await put({ ...first, ...fields })).status).toBe(422);
    const saved = await put(first);
    expect(saved.status).toBe(200);
    const r1 = (await saved.json()).data.rsvp;
    expect(r1).toMatchObject({
      guestName: "Анна 😊",
      version: 1,
      status: "yes",
      adultsCount: 2,
      childrenCount: 1,
    });
    const [original] =
      await query`SELECT created_at FROM app.rsvps WHERE id=${r1.id}`;
    expect((await (await put(first)).json()).data.rsvp).toEqual(r1);
    expect((await put({ ...first, status: "maybe" })).status).toBe(409);
    expect((await put(first, "rsvp-create-stale-01")).status).toBe(409);
    expect((await (await ctx()).json()).data.rsvp.id).toBe(r1.id);
    expect(
      (
        await (
          await own(req("/own"), { params: Promise.resolve({ publicId }) })
        ).json()
      ).data.rsvp.id,
    ).toBe(r1.id);
    const noop = await put(
      { ...first, guestName: "Анна 😊", expectedVersion: 1 },
      "rsvp-noop-00000001",
    );
    expect((await noop.json()).data).toMatchObject({
      changed: false,
      rsvp: { version: 1 },
    });
    expect(
      await query`SELECT id FROM app.analytics_events WHERE name='rsvp_changed'`,
    ).toHaveLength(0);
    bridge.cookies.delete("__Host-fe_guest");
    await bootstrap();
    const otherRaw = bridge.cookies.get("__Host-fe_guest")!;
    expect((await (await ctx()).json()).data.rsvp).toBeNull();
    expect(
      (
        await put(
          { ...first, guestName: "Анна 😊", status: "maybe" },
          "rsvp-second-guest01",
        )
      ).status,
    ).toBe(200);
    const ownerRaw = "o".repeat(43),
      foreignRaw = "f".repeat(43);
    await query`INSERT INTO app.organizer_sessions(user_id,token_hash,expires_at) VALUES(${users[0].id},${tokenHash(ownerRaw)},now()+interval '1 day'),(${users[1].id},${tokenHash(foreignRaw)},now()+interval '1 day')`;
    expect((await guests()).status).toBe(401);
    bridge.cookies.set("__Host-fe_org", foreignRaw);
    expect((await guests()).status).toBe(404);
    await expect(
      GuestsPage({
        params: Promise.resolve({ eventId }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("TEST_NOT_FOUND");
    bridge.cookies.set("__Host-fe_org", ownerRaw);
    const initial = (await (await guests("?limit=1")).json()).data;
    expect(initial.summary).toEqual({
      responses: { yes: 1, no: 0, maybe: 1, total: 2 },
      confirmed: { adults: 2, children: 1 },
    });
    expect(initial.guests).toHaveLength(1);
    expect(initial.nextCursor).toBeTruthy();
    const page2 = (
      await (await guests("?limit=1&cursor=" + initial.nextCursor)).json()
    ).data;
    expect(page2.guests).toHaveLength(1);
    expect(page2.guests[0].id).not.toBe(initial.guests[0].id);
    expect(page2.nextCursor).toBeNull();
    expect(
      (await guests("?status=yes&cursor=" + initial.nextCursor)).status,
    ).toBe(422);
    const filtered = (await (await guests("?status=no")).json()).data;
    expect(filtered.guests).toHaveLength(0);
    expect(filtered.summary).toEqual(initial.summary);
    expect(Object.keys(initial.guests[0]).sort()).toEqual(
      [
        "id",
        "guestName",
        "status",
        "adultsCount",
        "childrenCount",
        "comment",
        "version",
        "updatedAt",
      ].sort(),
    );
    const listHtml = renderToString(
      createElement(GuestListScreen, { initial }),
    );
    expect(listHtml).toContain("Список гостей");
    expect(listHtml).not.toContain(guestId);
    bridge.cookies.set("__Host-fe_guest", raw);
    expect(
      (
        await put(
          { ...first, expectedVersion: 1 },
          "rsvp-org-csrf-0001",
          csrf(ownerRaw),
        )
      ).status,
    ).toBe(403);
    await query`INSERT INTO app.telegram_channels(user_id,chat_id,permission_granted_at,permission_source,delivery_state) VALUES(${users[0].id},3001,now(),'bot_start','ready')`;
    const [sub] =
      await query`INSERT INTO app.notification_subscriptions(event_id,user_id,role,enabled,consented_at) VALUES(${eventId},${users[0].id},'organizer',true,now()) RETURNING id`;
    const changed = {
      ...first,
      status: "no",
      adultsCount: 0,
      childrenCount: 0,
      expectedVersion: 1,
    };
    const edited = (await (await put(changed, "rsvp-edit-no-00001")).json())
      .data.rsvp;
    expect(edited).toMatchObject({ id: r1.id, version: 2, status: "no" });
    expect(
      (await query`SELECT created_at FROM app.rsvps WHERE id=${r1.id}`)[0],
    ).toEqual(original);
    expect(
      (
        await query`SELECT type,trigger_key FROM app.notifications WHERE subscription_id=${sub.id}`
      )[0],
    ).toMatchObject({ type: "rsvp_changed", trigger_key: `rsvp:${r1.id}:v2` });
    expect(
      (await (await put(changed, "rsvp-edit-no-00001")).json()).data.rsvp.id,
    ).toBe(r1.id);
    expect(
      await query`SELECT id FROM app.notifications WHERE subscription_id=${sub.id}`,
    ).toHaveLength(1);
    const aggregate = (
      await (
        await summary(req("/summary"), { params: Promise.resolve({ eventId }) })
      ).json()
    ).data;
    expect(aggregate).toEqual({
      responses: { yes: 0, no: 1, maybe: 1, total: 2 },
      confirmed: { adults: 0, children: 0 },
    });
    const privateEvent = await organizerEvent(
      { kind: "organizer", userId: String(users[0].id), sessionId: "test" },
      eventId,
    );
    expect(privateEvent.latestResponses).toHaveLength(2);
    expect(privateEvent.responses).toMatchObject({
      yes: 0,
      no: 1,
      maybe: 1,
      adults: 0,
      children: 0,
    });
    bridge.cookies.set("__Host-fe_guest", otherRaw);
    const otherContext = (await (await ctx()).json()).data;
    const parallel = await Promise.all([
      put(
        { ...first, status: "yes", expectedVersion: otherContext.rsvp.version },
        "rsvp-parallel-0001",
      ),
      put(
        {
          ...first,
          status: "no",
          adultsCount: 0,
          childrenCount: 0,
          expectedVersion: otherContext.rsvp.version,
        },
        "rsvp-parallel-0002",
      ),
    ]);
    expect(parallel.map((v) => v.status).sort()).toEqual([200, 409]);
    bridge.cookies.delete("__Host-fe_guest");
    await bootstrap();
    const newRaw = bridge.cookies.get("__Host-fe_guest")!;
    const fresh = (
      await (
        await put({ ...first, guestName: "Новый гость" }, "rsvp-new-notify-01")
      ).json()
    ).data.rsvp;
    expect(
      await query`SELECT id FROM app.notifications WHERE type='rsvp_new' AND trigger_key=${"rsvp:" + fresh.id + ":v1"}`,
    ).toHaveLength(1);
    await pg.exec(
      "RESET ROLE;CREATE FUNCTION app.test_fail_rsvp_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture fail'; END $$;CREATE TRIGGER fail_rsvp_outbox BEFORE INSERT ON app.notifications FOR EACH ROW EXECUTE FUNCTION app.test_fail_rsvp_outbox();SET ROLE fe_server;",
    );
    expect(
      (
        await put(
          {
            ...first,
            status: "no",
            adultsCount: 0,
            childrenCount: 0,
            expectedVersion: 1,
          },
          "rsvp-rollback-0001",
        )
      ).status,
    ).toBe(500);
    expect((await (await ctx()).json()).data.rsvp.version).toBe(1);
    expect(
      await query`SELECT id FROM app.api_idempotency WHERE key='rsvp-rollback-0001'`,
    ).toHaveLength(0);
    await pg.exec(
      "RESET ROLE;DROP TRIGGER fail_rsvp_outbox ON app.notifications;DROP FUNCTION app.test_fail_rsvp_outbox();SET ROLE fe_server;",
    );
    const [notifyGuest] =
      await query`SELECT guest_identity_id FROM app.guest_sessions WHERE token_hash=${tokenHash(newRaw)}`;
    const [guestSub] =
      await query`INSERT INTO app.notification_subscriptions(event_id,user_id,role,guest_identity_id,enabled,consented_at) VALUES(${eventId},${users[0].id},'guest',${notifyGuest.guest_identity_id},true,now()) RETURNING id`;
    await query`INSERT INTO app.notifications(subscription_id,type,trigger_key,payload,scheduled_at,next_attempt_at,status,locked_until) VALUES(${guestSub.id},'reminder_24h','pending-fixture','{}',now()+interval '10 years',now()+interval '10 years','pending',NULL),(${guestSub.id},'reminder_24h','processing-fixture','{}',now()+interval '10 years',now()+interval '10 years','processing',now()+interval '2 minutes')`;
    expect(
      (
        await put(
          {
            ...first,
            status: "no",
            adultsCount: 0,
            childrenCount: 0,
            expectedVersion: 1,
          },
          "rsvp-cancel-n4-0001",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await query`SELECT status,locked_until FROM app.notifications WHERE subscription_id=${guestSub.id}`
      ).every((row) => row.status === "cancelled" && row.locked_until === null),
    ).toBe(true);
    // Keep PostgreSQL microseconds in cursors; two rows in one millisecond must both be reachable.
    const [microEvent] =
      await query`INSERT INTO app.events(organizer_id,public_id,title,event_type,event_date,timezone,effective_at) VALUES(${users[0].id},${randomBytes(16).toString("base64url")},'Microsecond fixture','family','2030-01-01','UTC','2030-01-01T00:00Z') RETURNING id`;
    const identities =
      await query`INSERT INTO app.guest_identities(display_name) VALUES('Micro One'),('Micro Two') RETURNING id`;
    await query`INSERT INTO app.rsvps(event_id,guest_identity_id,guest_name,status,adults_count,children_count,created_at) VALUES(${microEvent.id},${identities[0].id},'Micro One','yes',1,0,'2026-10-12T00:00:00.123456Z'),(${microEvent.id},${identities[1].id},'Micro Two','yes',1,0,'2026-10-12T00:00:00.123455Z')`;
    const microPrincipal = {
      kind: "organizer" as const,
      userId: String(users[0].id),
      sessionId: "test",
    };
    const microFirst = await eventGuests(
      microPrincipal,
      String(microEvent.id),
      { limit: 1 },
    );
    expect(
      JSON.parse(Buffer.from(microFirst.nextCursor!, "base64url").toString())
        .createdAt,
    ).toBe("2026-10-12T00:00:00.123456Z");
    const microNext = await eventGuests(microPrincipal, String(microEvent.id), {
      limit: 1,
      cursor: microFirst.nextCursor!,
    });
    expect(microNext.guests).toHaveLength(1);
    expect(microNext.guests[0].id).not.toBe(microFirst.guests[0].id);
    // Link the proven account to the same anonymous identity without changing its RSVP.
    const [beforeLink] =
      await query`SELECT guest_identity_id FROM app.guest_sessions WHERE token_hash=${tokenHash(newRaw)}`;
    expect((await bootstrap()).status).toBe(200);
    expect(
      (
        await query`SELECT linked_user_id FROM app.guest_identities WHERE id=${beforeLink.guest_identity_id}`
      )[0].linked_user_id,
    ).toBe(users[0].id);
    bridge.cookies.set("__Host-fe_org", foreignRaw);
    expect((await (await ctx()).json()).data.sessionState).toBe("lost");
    expect(
      (await put({ ...first, expectedVersion: 1 }, "rsvp-wrong-user-01"))
        .status,
    ).toBe(401);
    expect((await bootstrap()).status).toBe(409);
    expect((await bootstrap({ restart: true })).status).toBe(201);
    expect((await (await ctx()).json()).data.rsvp).toBeNull();
    bridge.cookies.delete("__Host-fe_org");
    bridge.cookies.set("__Host-fe_guest", raw);
    await query`UPDATE app.guest_sessions SET revoked_at=now() WHERE token_hash=${tokenHash(raw)}`;
    expect((await (await ctx()).json()).data).toMatchObject({
      sessionState: "lost",
      rsvp: null,
    });
    expect((await bootstrap()).status).toBe(401);
    expect((await bootstrap({ restart: true })).status).toBe(201);
    expect((await (await ctx()).json()).data.rsvp).toBeNull();
    const expiredRaw = bridge.cookies.get("__Host-fe_guest")!;
    await query`UPDATE app.guest_sessions SET created_at=now()-interval '2 days',expires_at=now()-interval '1 second' WHERE token_hash=${tokenHash(expiredRaw)}`;
    expect((await (await ctx()).json()).data.sessionState).toBe("lost");
    expect((await bootstrap()).status).toBe(401);
    expect((await put(first, "rsvp-expired-0001")).status).toBe(401);
    expect((await bootstrap({ restart: true })).status).toBe(201);
    const publicDto = await publicEvent(publicId);
    const publicHtml = renderToString(
      createElement(PublicEventScreen, { initialEvent: publicDto }),
    );
    expect(publicHtml).not.toContain("Анна");
    expect(publicHtml).not.toContain("Новый гость");
    expect(publicHtml).toContain("Загружаем ваш ответ");
    expect(returnPath(`/events/${eventId}/guests?status=maybe`)).toBe(
      `/events/${eventId}/guests?status=maybe`,
    );
    expect(
      returnPath(`/events/${eventId}/guests?status=maybe&url=https://bad.test`),
    ).toBe("/events");
    await query`SELECT app.soft_delete_event(${eventId},${users[0].id},1)`;
    expect((await ctx()).status).toBe(404);
    expect((await put(first, "rsvp-deleted-00001")).status).toBe(404);
    bridge.cookies.set("__Host-fe_org", ownerRaw);
    expect((await guests()).status).toBe(404);
    expect(
      (await summary(req("/summary"), { params: Promise.resolve({ eventId }) }))
        .status,
    ).toBe(404);
    expect(
      await query`SELECT id FROM app.rsvps WHERE event_id=${eventId}`,
    ).toHaveLength(3);
  } finally {
    bridge.cookies.clear();
    await pg.close();
  }
}, 30000);
