import { it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
const bridge = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  query: vi.fn(),
  transaction: vi.fn(),
  send: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) =>
      bridge.cookies.has(n) ? { value: bridge.cookies.get(n) } : undefined,
  }),
}));
vi.mock("@/server/db/client", () => ({
  db: () => bridge.query,
  transaction: bridge.transaction,
}));
vi.mock("postgres", () => ({
  default: () => Object.assign(bridge.query, { end: async () => {} }),
}));
vi.mock("@/server/telegram/bot", () => ({
  bot: bridge.send,
  BotError: class extends Error {
    constructor(
      public code: number,
      public retryAfter?: number,
    ) {
      super("Bot error");
    }
  },
}));
import {
  GET,
  PUT,
} from "@/app/api/v1/events/[eventId]/notification-subscription/route";
import { POST as handoff } from "@/app/api/v1/events/[eventId]/notification-handoff/route";
import { tokenHash, csrf } from "@/server/auth/crypto";
import { saveRsvp } from "@/server/services/rsvps";
import { deliver } from "@/server/notifications/worker";
import { BotError } from "@/server/telegram/bot";
import { organizerRsvpMessage } from "@/server/notifications/templates";
import { returnPath } from "@/server/telegram/oidc";
it("uses truthful N1/N2 templates and preserves safe private CTA return paths", () => {
  const next = {
    guestName: "Анна",
    status: "no" as const,
    adultsCount: 1,
    childrenCount: 0,
    comment: null,
    expectedVersion: null,
  };
  const text = organizerRsvpMessage("День рождения", next, {
    guest_name: "Анна",
    status: "yes",
    adults_count: 2,
    children_count: 1,
    comment: "old",
  });
  expect(text).toContain("Было: Буду");
  expect(text).toContain("Теперь: Не буду");
  expect(text).toContain("2 взрослых · 1 ребёнок → 1 взрослый · 0 детей");
  expect(text).toContain("Комментарий удалён");
  expect(organizerRsvpMessage("Семья", next)).toContain("не будет");
  const id = randomUUID();
  expect(returnPath(`/events/${id}`)).toBe(`/events/${id}`);
  expect(returnPath(`/events/${id}/notifications`)).toBe(
    `/events/${id}/notifications`,
  );
  expect(returnPath("https://evil.test")).toBe("/events");
});
it("runs own consent/handoff, atomically queues N1/N2 and tests worker delivery/dedup/opt-out/retry through restricted PostgreSQL", async () => {
  process.env.APP_URL = "https://example.test";
  process.env.APP_ENV = "local";
  process.env.VERCEL = "0";
  process.env.SESSION_SECRET = "s".repeat(32);
  process.env.RATE_LIMIT_SECRET = "r".repeat(32);
  process.env.GIFT_WRITE_RATE_LIMIT = "200";
  process.env.DATABASE_WORKER_URL = "postgres://unused";
  process.env.TELEGRAM_BOT_USERNAME = "FamilyEventsMiniAppBot";
  const pg = await PGlite.create();
  const adapter = (c: Pick<PGlite, "query">) =>
    Object.assign(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.reduce((t, p, i) => t + (i ? "$" + i : "") + p, "");
        return (await c.query<Record<string, unknown>>(sql, values)).rows;
      },
      { json: JSON.stringify },
    );
  const q = adapter(pg);
  bridge.query.mockImplementation(q);
  bridge.transaction.mockImplementation(
    (work: (tx: unknown) => Promise<unknown>) =>
      pg.transaction((tx) => work(adapter(tx))),
  );
  const raw = randomBytes(32).toString("base64url"),
    pid = randomBytes(16).toString("base64url");
  const request = (
    method = "GET",
    body?: unknown,
    key = randomUUID(),
    token = csrf(raw),
  ) =>
    new Request("https://example.test/api", {
      method,
      headers: {
        Origin: "https://example.test",
        "Content-Type": "application/json",
        "x-csrf-token": token,
        "idempotency-key": key,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    await pg.exec("CREATE ROLE anon;CREATE ROLE authenticated;");
    for (const f of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pg.exec(await readFile("supabase/migrations/" + f, "utf8"));
    expect(
      (
        await q`SELECT has_function_privilege('anon','app.claim_notifications(integer)','EXECUTE') AS ok`
      )[0].ok,
    ).toBe(false);
    await pg.exec("SET ROLE fe_server");
    const [u] =
      await q`INSERT INTO app.users(telegram_user_id,display_name) VALUES(8001,'Owner') RETURNING id`;
    const [foreign] =
      await q`INSERT INTO app.users(telegram_user_id,display_name) VALUES(8002,'Other') RETURNING id`;
    const [session] =
      await q`INSERT INTO app.organizer_sessions(user_id,token_hash,expires_at) VALUES(${u.id},${tokenHash(raw)},now()+interval '1 day') RETURNING id`;
    const [e] =
      await q`INSERT INTO app.events(organizer_id,public_id,title,event_type,event_date,timezone,effective_at) VALUES(${u.id},${pid},'Birthday','family','2030-01-01','UTC','2030-01-01T00:00Z') RETURNING id`;
    const params = { params: Promise.resolve({ eventId: String(e.id) }) };
    expect((await GET(request(), params)).status).toBe(401);
    bridge.cookies.set("__Host-fe_org", raw);
    expect((await PUT(request("PUT", { enabled: true }), params)).status).toBe(
      409,
    );
    expect(
      (
        await PUT(
          request("PUT", { enabled: true }, randomUUID(), "bad"),
          params,
        )
      ).status,
    ).toBe(403);
    expect(
      (await PUT(request("PUT", { enabled: true, userId: foreign.id }), params))
        .status,
    ).toBe(422);
    const [guest] =
      await q`INSERT INTO app.guest_identities(display_name) VALUES('Anna') RETURNING id`;
    const [gs] =
      await q`INSERT INTO app.guest_sessions(guest_identity_id,token_hash,expires_at) VALUES(${guest.id},${tokenHash(randomBytes(32).toString("base64url"))},now()+interval '1 day') RETURNING id`;
    const principal = {
      kind: "guest" as const,
      guestIdentityId: String(guest.id),
      sessionId: String(gs.id),
    };
    const first = {
      guestName: "Anna",
      status: "yes" as const,
      adultsCount: 2,
      childrenCount: 1,
      comment: null,
      expectedVersion: null,
    };
    const before = await saveRsvp(principal, pid, first, randomUUID());
    expect(await q`SELECT id FROM app.notifications`).toHaveLength(0);
    const created = await handoff(
      request("POST", { mode: "bot_start" }),
      params,
    );
    expect(created.status).toBe(201);
    const payload = (await created.json()).data;
    const secret = new URL(payload.telegramUrl).searchParams
      .get("start")!
      .slice(7);
    const hash = tokenHash(secret);
    await pg.exec("SET ROLE fe_worker");
    expect(
      (
        await q`SELECT app.confirm_organizer_notification(${hash},8002,8002,now(),'bot_start') AS ok`
      )[0].ok,
    ).toBe(false);
    await pg.exec("SET ROLE fe_server");
    expect(
      (await (await GET(request(), params)).json()).data.handoff.state,
    ).toBe("account_mismatch");
    expect(await q`SELECT id FROM app.notification_subscriptions`).toHaveLength(
      0,
    );
    await pg.exec("SET ROLE fe_worker");
    expect(
      (
        await q`SELECT app.confirm_organizer_notification(${hash},8001,8001,now(),'bot_start') AS ok`
      )[0].ok,
    ).toBe(true);
    expect(
      (
        await q`SELECT app.confirm_organizer_notification(${hash},8001,8001,now(),'bot_start') AS ok`
      )[0].ok,
    ).toBe(false);
    await pg.exec("SET ROLE fe_server");
    const settings = (await (await GET(request(), params)).json()).data;
    expect(settings.enabled).toBe(true);
    expect(settings.channel).toBe("ready");
    expect(JSON.stringify(settings)).not.toContain("8001");
    const changed = await saveRsvp(
      principal,
      pid,
      {
        ...first,
        status: "no",
        adultsCount: 0,
        childrenCount: 0,
        expectedVersion: before.body.rsvp.version,
      },
      randomUUID(),
    );
    const jobs =
      await q`SELECT type,trigger_key,payload FROM app.notifications`;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].type).toBe("rsvp_changed");
    expect((jobs[0].payload as { text: string }).text).toContain("Было: Буду");
    expect((jobs[0].payload as { action: { path: string } }).action.path).toBe(
      `/events/${e.id}/guests`,
    );
    await saveRsvp(
      principal,
      pid,
      {
        ...first,
        status: "no",
        adultsCount: 0,
        childrenCount: 0,
        expectedVersion: changed.body.rsvp.version,
      },
      randomUUID(),
    );
    expect(await q`SELECT id FROM app.notifications`).toHaveLength(1);
    bridge.send.mockResolvedValue({ message_id: 900 });
    await pg.exec("SET ROLE fe_worker");
    expect(await deliver()).toEqual({ processed: 1, sent: 1 });
    expect(await deliver()).toEqual({ processed: 0, sent: 0 });
    expect(bridge.send).toHaveBeenCalledTimes(1);
    expect(
      bridge.send.mock.calls[0][1].reply_markup.inline_keyboard[0][0].url,
    ).toBe(`https://example.test/events/${e.id}/guests`);
    await pg.exec("SET ROLE fe_server");
    expect(
      (await q`SELECT status,provider_message_id FROM app.notifications`)[0],
    ).toMatchObject({ status: "sent", provider_message_id: 900 });
    const [guest2] =
      await q`INSERT INTO app.guest_identities(display_name) VALUES('Bob') RETURNING id`;
    const [gs2] =
      await q`INSERT INTO app.guest_sessions(guest_identity_id,token_hash,expires_at) VALUES(${guest2.id},${tokenHash(randomBytes(32).toString("base64url"))},now()+interval '1 day') RETURNING id`;
    const secondP = {
      kind: "guest" as const,
      guestIdentityId: String(guest2.id),
      sessionId: String(gs2.id),
    };
    const key = randomUUID();
    await saveRsvp(secondP, pid, { ...first, guestName: "Bob" }, key);
    await saveRsvp(secondP, pid, { ...first, guestName: "Bob" }, key);
    expect(
      await q`SELECT id FROM app.notifications WHERE type='rsvp_new'`,
    ).toHaveLength(1);
    await PUT(request("PUT", { enabled: false }), params);
    await pg.exec("SET ROLE fe_worker");
    expect((await deliver()).sent).toBe(0);
    await pg.exec("SET ROLE fe_server");
    expect(
      (await q`SELECT status FROM app.notifications WHERE type='rsvp_new'`)[0]
        .status,
    ).toBe("cancelled");
    await PUT(request("PUT", { enabled: true }), params);
    const [sub] =
      await q`SELECT id FROM app.notification_subscriptions WHERE event_id=${e.id}`;
    await q`INSERT INTO app.notifications(subscription_id,type,trigger_key,payload,scheduled_at,next_attempt_at) VALUES(${sub.id},'rsvp_new','retry',${q.json({ text: "Synthetic retry" })},now(),now())`;
    bridge.send.mockRejectedValueOnce(new BotError(429, 120));
    await pg.exec("SET ROLE fe_worker");
    expect(await deliver()).toEqual({ processed: 1, sent: 0 });
    await pg.exec("SET ROLE fe_server");
    expect(
      (
        await q`SELECT status,last_error_code,next_attempt_at>now()+interval '110 seconds' AS delayed FROM app.notifications WHERE trigger_key='retry'`
      )[0],
    ).toMatchObject({
      status: "pending",
      last_error_code: "429",
      delayed: true,
    });
    await q`UPDATE app.notifications SET next_attempt_at=now() WHERE trigger_key='retry'`;
    bridge.send.mockRejectedValueOnce(new BotError(403));
    await pg.exec("SET ROLE fe_worker");
    expect((await deliver()).sent).toBe(0);
    await pg.exec("SET ROLE fe_server");
    expect((await (await GET(request(), params)).json()).data).toMatchObject({
      enabled: false,
      channel: "blocked",
    });
    // A stale worker lease cannot block a subsequently restored channel.
    const [retryJob] =
      await q`SELECT id FROM app.notifications WHERE trigger_key='retry'`;
    await q`UPDATE app.telegram_channels SET delivery_state='ready',permission_granted_at=now() WHERE user_id=${u.id}`;
    await pg.exec("SET ROLE fe_worker");
    await q`SELECT app.finish_notification(${retryJob.id},now()+interval '1 hour',NULL,'403',1)`;
    await pg.exec("SET ROLE fe_server");
    expect(
      (
        await q`SELECT delivery_state FROM app.telegram_channels WHERE user_id=${u.id}`
      )[0].delivery_state,
    ).toBe("ready");
    const revoked = await handoff(
      request("POST", { mode: "bot_start" }),
      params,
    );
    const revokedSecret = new URL(
      (await revoked.json()).data.telegramUrl,
    ).searchParams
      .get("start")!
      .slice(7);
    await q`UPDATE app.organizer_sessions SET revoked_at=now() WHERE id=${session.id}`;
    await pg.exec("SET ROLE fe_worker");
    expect(
      (
        await q`SELECT app.confirm_organizer_notification(${tokenHash(revokedSecret)},8001,8001,now(),'bot_start') AS ok`
      )[0].ok,
    ).toBe(false);
    await pg.exec("SET ROLE fe_server");
    await q`UPDATE app.organizer_sessions SET revoked_at=NULL WHERE id=${session.id}`;
    expect(
      (
        await GET(request(), {
          params: Promise.resolve({ eventId: randomUUID() }),
        })
      ).status,
    ).toBe(404);
  } finally {
    bridge.cookies.clear();
    bridge.send.mockReset();
    await pg.close();
  }
}, 30000);
