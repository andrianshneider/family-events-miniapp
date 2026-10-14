import { it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
const bridge = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
  send: vi.fn(),
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
  BotError: class extends Error {},
}));
import { deliver } from "@/server/notifications/worker";
import { Temporal } from "@js-temporal/polyfill";
import { reminderAt } from "@/server/services/time";
import { updateEvent } from "@/server/services/events";
import { tokenHash } from "@/server/auth/crypto";
import {
  beginGuestHandoff,
  completeGuestHandoff,
  guestHandoffStatus,
  guestNotificationSettings,
  setGuestSubscription,
} from "@/server/services/guest-notifications";
import { planReminders, decideChange } from "@/server/notifications/guest";
it("requires source proof and explicit RSVP merge, preserves gifts and canonical sessions, schedules/deduplicates/cancels guest notifications", async () => {
  process.env.DATABASE_WORKER_URL = "postgres://unused";
  process.env.AUTH_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.APP_URL = "https://example.test";
  process.env.TELEGRAM_BOT_USERNAME = "FamilyEventsMiniAppBot";
  const pg = await PGlite.create();
  const adapter = (c: Pick<PGlite, "query">) =>
    Object.assign(
      async (strings: TemplateStringsArray, ...v: unknown[]) => {
        return (
          await c.query<Record<string, unknown>>(
            strings.reduce((s, p, i) => s + (i ? "$" + i : "") + p, ""),
            v,
          )
        ).rows;
      },
      { json: JSON.stringify },
    );
  const q = adapter(pg);
  bridge.query.mockImplementation(q);
  bridge.transaction.mockImplementation(
    (fn: (tx: unknown) => Promise<unknown>) =>
      pg.transaction((tx) => fn(adapter(tx))),
  );
  try {
    await pg.exec("CREATE ROLE anon;CREATE ROLE authenticated;");
    for (const f of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pg.exec(await readFile("supabase/migrations/" + f, "utf8"));
    await pg.exec("SET ROLE fe_server");
    const [owner] =
      await q`INSERT INTO app.users(telegram_user_id,display_name) VALUES(7001,'Owner') RETURNING id`;
    const [user] =
      await q`INSERT INTO app.users(telegram_user_id,display_name) VALUES(7002,'Guest') RETURNING id`;
    const pid = randomBytes(16).toString("base64url");
    const [e] =
      await q`INSERT INTO app.events(organizer_id,public_id,title,event_type,event_date,start_time,timezone,starts_at,effective_at) VALUES(${owner.id},${pid},'Birthday','family','2030-01-02','15:00','UTC','2030-01-02T15:00Z','2030-01-02T15:00Z') RETURNING id`;
    const [a] =
      await q`INSERT INTO app.guest_identities(display_name) VALUES('Anonymous') RETURNING id`;
    const [b] =
      await q`INSERT INTO app.guest_identities(linked_user_id,display_name) VALUES(${user.id},'Canonical') RETURNING id`;
    const [session] =
      await q`INSERT INTO app.guest_sessions(guest_identity_id,token_hash,expires_at) VALUES(${a.id},${tokenHash(randomBytes(32).toString("base64url"))},now()+interval '1 day') RETURNING id`;
    const p = {
      kind: "guest" as const,
      guestIdentityId: String(a.id),
      sessionId: String(session.id),
    };
    await q`INSERT INTO app.rsvps(event_id,guest_identity_id,guest_name,status,adults_count,children_count) VALUES(${e.id},${a.id},'Anonymous','yes',2,1),(${e.id},${b.id},'Canonical','maybe',1,0)`;
    const [w] =
      await q`INSERT INTO app.wishlists(event_id) VALUES(${e.id}) RETURNING id`;
    const [gift] =
      await q`INSERT INTO app.gifts(wishlist_id,title) VALUES(${w.id},'Gift') RETURNING id`;
    await q`INSERT INTO app.gift_reservations(gift_id,guest_identity_id) VALUES(${gift.id},${a.id})`;
    expect(
      (
        await q`SELECT has_function_privilege('anon','app.verify_guest_handoff(bytea,bigint,bigint,timestamptz,text)','EXECUTE') AS ok`
      )[0].ok,
    ).toBe(false);
    const expired = await beginGuestHandoff(p, pid);
    await q`UPDATE app.auth_handoffs SET created_at=now()-interval '2 seconds',expires_at=now()-interval '1 second' WHERE id=${expired.id}`;
    await pg.exec("SET ROLE fe_worker");
    expect(
      (
        await q`SELECT app.verify_guest_handoff(${tokenHash(expired.url!.split("guest_")[1])},7002,7002,now(),'Guest') AS ok`
      )[0].ok,
    ).toBe(false);
    await pg.exec("SET ROLE fe_server");
    const h = await beginGuestHandoff(p, pid);
    const repeated = await beginGuestHandoff(p, pid);
    expect(repeated).toEqual(h);
    expect((await guestNotificationSettings(p, pid)).handoff?.url).toBe(h.url);
    await expect(
      completeGuestHandoff(p, pid, {
        handoffId: h.id,
        confirmAccount: true,
        choices: {},
      }),
    ).rejects.toBeDefined();
    const raw = h.url!.split("guest_")[1];
    await pg.exec("SET ROLE fe_worker");
    expect(
      (
        await q`SELECT app.verify_guest_handoff(${tokenHash(raw)},7002,7002,now(),'Guest') AS ok`
      )[0].ok,
    ).toBe(true);
    expect(
      (
        await q`SELECT app.verify_guest_handoff(${tokenHash(raw)},7002,7002,now(),'Guest') AS ok`
      )[0].ok,
    ).toBe(false);
    await pg.exec("SET ROLE fe_server");
    expect(await beginGuestHandoff(p, pid)).toEqual({ id: h.id, url: null });
    const proof = await guestHandoffStatus(p, pid, h.id);
    expect(proof.conflicts).toHaveLength(1);
    await expect(
      guestHandoffStatus({ ...p, sessionId: randomUUID() }, pid, h.id),
    ).rejects.toBeDefined();
    await expect(
      completeGuestHandoff(p, pid, {
        handoffId: h.id,
        confirmAccount: true,
        choices: {},
      }),
    ).rejects.toMatchObject({ code: "RSVP_MERGE_CONFLICT" });
    await completeGuestHandoff(p, pid, {
      handoffId: h.id,
      confirmAccount: true,
      choices: {
        [String(e.id)]: {
          choice: "current",
          currentVersion: 1,
          telegramVersion: 1,
        },
      },
    });
    expect(
      (
        await q`SELECT count(*)::int AS n FROM app.rsvps WHERE event_id=${e.id}`
      )[0].n,
    ).toBe(1);
    expect(
      (
        await q`SELECT guest_identity_id FROM app.gift_reservations WHERE gift_id=${gift.id}`
      )[0].guest_identity_id,
    ).toBe(b.id);
    expect(
      (
        await q`SELECT guest_identity_id FROM app.guest_sessions WHERE id=${session.id}`
      )[0].guest_identity_id,
    ).toBe(b.id);
    await bridge.transaction((tx: unknown) =>
      planReminders(tx as Parameters<typeof planReminders>[0], String(e.id)),
    );
    expect(
      (
        await q`SELECT count(*)::int AS n FROM app.notifications WHERE type='reminder_24h'`
      )[0].n,
    ).toBe(1);
    const canonical = { ...p, guestIdentityId: String(b.id) };
    await setGuestSubscription(canonical, pid, false);
    expect(
      (
        await q`SELECT status FROM app.notifications WHERE type='reminder_24h'`
      )[0].status,
    ).toBe("cancelled");
    await setGuestSubscription(canonical, pid, true);
    expect(
      (
        await q`SELECT status FROM app.notifications WHERE type='reminder_24h'`
      )[0].status,
    ).toBe("pending");
    const [orgSession] =
      await q`INSERT INTO app.organizer_sessions(user_id,token_hash,expires_at) VALUES(${owner.id},${tokenHash(randomBytes(32).toString("base64url"))},now()+interval '1 day') RETURNING id`;
    const org = {
      kind: "organizer" as const,
      userId: String(owner.id),
      sessionId: String(orgSession.id),
    };
    const [change] =
      await q`INSERT INTO app.event_changes(event_id,event_version,actor_user_id,changes) VALUES(${e.id},1,${owner.id},${q.json({ venueName: { before: null, after: "New venue" }, address: { before: null, after: "New address" } })}) RETURNING id`;
    const key = randomUUID();
    await decideChange(org, String(e.id), String(change.id), "send", key);
    await decideChange(org, String(e.id), String(change.id), "send", key);
    expect(
      (
        await q`SELECT count(*)::int AS n FROM app.notifications WHERE type='event_changed'`
      )[0].n,
    ).toBe(1);
    await expect(
      decideChange(
        { ...org, userId: String(user.id) },
        String(e.id),
        String(change.id),
        "send",
        randomUUID(),
      ),
    ).rejects.toBeDefined();
    const fields = {
      title: "Updated title",
      eventType: "family" as const,
      eventDate: "2030-01-02",
      startTime: "15:00",
      endTime: null,
      timezone: "UTC",
      venueName: null,
      address: null,
    };
    await updateEvent(
      org,
      String(e.id),
      { expectedVersion: 1, fields },
      randomUUID(),
    );
    expect(
      (await q`SELECT schedule_version FROM app.events WHERE id=${e.id}`)[0]
        .schedule_version,
    ).toBe(1);
    await q`UPDATE app.notifications SET status='sent',provider_message_id=99 WHERE type='reminder_24h'`;
    await bridge.transaction((tx: unknown) =>
      planReminders(tx as Parameters<typeof planReminders>[0], String(e.id)),
    );
    expect(
      (
        await q`SELECT status FROM app.notifications WHERE type='reminder_24h'`
      )[0].status,
    ).toBe("sent");
    await updateEvent(
      org,
      String(e.id),
      { expectedVersion: 2, fields: { ...fields, startTime: "16:00" } },
      randomUUID(),
    );
    expect(
      (await q`SELECT schedule_version FROM app.events WHERE id=${e.id}`)[0]
        .schedule_version,
    ).toBe(2);
    expect(
      (
        await q`SELECT count(*)::int AS n FROM app.notifications WHERE type='reminder_24h'`
      )[0].n,
    ).toBe(2);
    await q`UPDATE app.rsvps SET status='no',adults_count=0,children_count=0 WHERE event_id=${e.id}`;
    await pg.exec("SET ROLE fe_worker");
    const jobs =
      await q`SELECT id,lease::text FROM app.claim_notifications(20)`;
    expect(jobs).toHaveLength(1);
    await pg.exec("SET ROLE fe_server");
    expect(
      (
        await q`SELECT status FROM app.notifications WHERE type='reminder_24h'`
      )[0].status,
    ).toBe("sent");
    await q`UPDATE app.notifications SET status='cancelled',locked_until=NULL WHERE type='event_changed'`;
    await q`UPDATE app.rsvps SET status='maybe',adults_count=1,children_count=0 WHERE event_id=${e.id}`;
    await bridge.transaction((tx: unknown) =>
      planReminders(tx as Parameters<typeof planReminders>[0], String(e.id)),
    );
    await q`UPDATE app.notifications SET scheduled_at=now()-interval '1 second',next_attempt_at=now()-interval '1 second' WHERE type='reminder_24h' AND status='pending'`;
    bridge.send.mockResolvedValue({ message_id: 100 });
    await pg.exec("SET ROLE fe_worker");
    expect(await deliver()).toEqual({ processed: 1, sent: 1 });
    expect(await deliver()).toEqual({ processed: 0, sent: 0 });
    expect(bridge.send).toHaveBeenCalledTimes(1);
    expect(bridge.send.mock.calls[0][1].text).toContain(
      "Напоминание о мероприятии",
    );
    expect(
      bridge.send.mock.calls[0][1].reply_markup.inline_keyboard[0][0].url,
    ).toBe("https://example.test/e/" + pid);
  } finally {
    await pg.close();
  }
}, 30000);

it("computes exact 24h across DST, date-only previous-day 09:00 and excludes overdue reminder", () => {
  expect(
    reminderAt(
      "2030-03-31",
      "12:00",
      "Europe/Berlin",
      Temporal.Instant.from("2030-01-01T00:00Z"),
    ),
  ).toBe("2030-03-30T10:00:00Z");
  expect(
    reminderAt(
      "2030-01-02",
      null,
      "Europe/Moscow",
      Temporal.Instant.from("2030-01-01T00:00Z"),
    ),
  ).toBe("2030-01-01T06:00:00Z");
  expect(
    reminderAt(
      "2030-01-02",
      "12:00",
      "UTC",
      Temporal.Instant.from("2030-01-01T12:00Z"),
    ),
  ).toBeNull();
});
