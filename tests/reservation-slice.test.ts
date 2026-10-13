import { it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
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
import {
  POST,
  DELETE,
} from "@/app/api/v1/public/events/[publicId]/gifts/[giftId]/reservation/route";
import { GET } from "@/app/api/v1/public/events/[publicId]/my-reservations/route";
import { tokenHash, csrf } from "@/server/auth/crypto";
import { readWishlist } from "@/server/services/wishlists";
import { reserveInput } from "@/lib/reservation-validation";
it("validates guest names using trimmed Unicode code points and rejects forged ownership", () => {
  expect(reserveInput.parse({ guestName: " 😊😊 " }).guestName).toBe("😊😊");
  for (const x of [
    { guestName: "a" },
    { guestName: "😊".repeat(61) },
    { guestIdentityId: randomUUID() },
    { isMine: true },
  ])
    expect(reserveInput.safeParse(x).success).toBe(false);
});
it("exercises actual reservation handlers, permissions, ownership, receipts, refresh, privacy and stale cancellation against PostgreSQL", async () => {
  process.env.APP_URL = "https://example.test";
  process.env.APP_ENV = "local";
  process.env.VERCEL = "0";
  process.env.SESSION_SECRET = "s".repeat(32);
  process.env.RATE_LIMIT_SECRET = "r".repeat(32);
  process.env.GUEST_WRITE_SESSION_RATE_LIMIT = "200";
  process.env.GUEST_WRITE_IP_RATE_LIMIT = "400";
  process.env.PUBLIC_READ_RATE_LIMIT = "400";
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
  const pid = randomBytes(16).toString("base64url"),
    pid2 = randomBytes(16).toString("base64url"),
    raws = [
      randomBytes(32).toString("base64url"),
      randomBytes(32).toString("base64url"),
    ];
  let actor = 0;
  const req = (
    method = "GET",
    body?: unknown,
    key = randomUUID(),
    token = csrf(raws[actor]),
  ) =>
    new Request("https://example.test/api/reservation", {
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
        await q`SELECT has_function_privilege('anon','app.reserve_gift(text,uuid,uuid)','EXECUTE') AS ok`
      )[0].ok,
    ).toBe(false);
    await pg.exec("SET ROLE fe_server");
    const [u] =
      await q`INSERT INTO app.users(telegram_user_id,display_name) VALUES(7001,'Owner') RETURNING id`;
    const [event] =
      await q`INSERT INTO app.events(organizer_id,public_id,title,event_type,event_date,timezone,effective_at) VALUES(${u.id},${pid},'Reservation test','family','2030-01-01','UTC','2030-01-01T00:00Z') RETURNING id`;
    const [other] =
      await q`INSERT INTO app.events(organizer_id,public_id,title,event_type,event_date,timezone,effective_at) VALUES(${u.id},${pid2},'Other event','family','2030-01-01','UTC','2030-01-01T00:00Z') RETURNING id`;
    const [w] =
      await q`INSERT INTO app.wishlists(event_id) VALUES(${event.id}) RETURNING id`;
    await q`INSERT INTO app.wishlists(event_id) VALUES(${other.id})`;
    const [g] =
      await q`INSERT INTO app.gifts(wishlist_id,title) VALUES(${w.id},'Plant') RETURNING id`;
    const gp = {
        params: Promise.resolve({ publicId: pid, giftId: String(g.id) }),
      },
      cp = { params: Promise.resolve({ publicId: pid }) };
    const none = await GET(req(), cp);
    expect((await none.json()).data.sessionState).toBe("none");
    expect(await q`SELECT id FROM app.guest_identities`).toHaveLength(0);
    expect((await POST(req("POST", {}), gp)).status).toBe(401);
    const guests =
      await q`INSERT INTO app.guest_identities DEFAULT VALUES RETURNING id`;
    const [b] =
      await q`INSERT INTO app.guest_identities DEFAULT VALUES RETURNING id`;
    guests.push(b);
    for (let i = 0; i < 2; i++)
      await q`INSERT INTO app.guest_sessions(guest_identity_id,token_hash,expires_at) VALUES(${guests[i].id},${tokenHash(raws[i])},now()+interval '1 day')`;
    bridge.cookies.set("__Host-fe_guest", raws[0]);
    expect((await POST(req("POST", {}, randomUUID(), "bad"), gp)).status).toBe(
      403,
    );
    expect((await POST(req("POST", {}), gp)).status).toBe(422);
    expect(
      (await POST(req("POST", { guestName: "Anna", isMine: true }), gp)).status,
    ).toBe(422);
    expect(
      (
        await POST(req("POST", { guestName: "Anna" }), {
          params: Promise.resolve({ publicId: pid2, giftId: String(g.id) }),
        })
      ).status,
    ).toBe(404);
    const key = randomUUID(),
      body = { guestName: "Anna" };
    const first = await POST(req("POST", body, key), gp);
    expect(first.status).toBe(201);
    const r = (await first.json()).data.reservation;
    expect(
      (await (await POST(req("POST", body, key), gp)).json()).data.reservation,
    ).toEqual(r);
    expect(
      (await POST(req("POST", { guestName: "Different" }, key), gp)).status,
    ).toBe(409);
    expect(await q`SELECT id FROM app.rsvps`).toHaveLength(0);
    expect(
      await q`SELECT id FROM app.gift_reservations WHERE status='active'`,
    ).toHaveLength(1);
    expect(
      await q`SELECT id FROM app.analytics_events WHERE name='gift_reserved'`,
    ).toHaveLength(1);
    const refresh = (await (await GET(req(), cp)).json()).data;
    expect(refresh.reservations).toEqual([r]);
    expect(refresh.defaultName).toBe("Anna");
    actor = 1;
    bridge.cookies.set("__Host-fe_guest", raws[1]);
    const conflict = await POST(req("POST", body), gp);
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("GIFT_ALREADY_RESERVED");
    expect((await (await GET(req(), cp)).json()).data.reservations).toEqual([]);
    expect(
      (await DELETE(req("DELETE", { reservationId: r.reservationId }), gp))
        .status,
    ).toBe(404);
    const pub = await readWishlist(pid),
      own = await readWishlist(
        String(event.id),
        {},
        {
          kind: "organizer",
          userId: String(u.id),
          sessionId: randomUUID(),
        },
      );
    expect(pub.gifts[0].reserved).toBe(true);
    for (const v of [pub, own]) {
      const s = JSON.stringify(v);
      expect(s).not.toContain("Anna");
      expect(s).not.toContain(String(guests[0].id));
      expect(s).not.toContain(r.reservationId);
    }
    actor = 0;
    bridge.cookies.set("__Host-fe_guest", raws[0]);
    const cancelKey = randomUUID();
    expect(
      (
        await DELETE(
          req("DELETE", { reservationId: r.reservationId }, cancelKey),
          gp,
        )
      ).status,
    ).toBe(200);
    expect((await (await GET(req(), cp)).json()).data.reservations).toEqual([]);
    expect(
      (
        await q`SELECT cancel_reason FROM app.gift_reservations WHERE id=${r.reservationId}`
      )[0].cancel_reason,
    ).toBe("guest_cancelled");
    await q`INSERT INTO app.rsvps(event_id,guest_identity_id,guest_name,status,adults_count,children_count) VALUES(${event.id},${guests[0].id},'RSVP name','maybe',1,0)`;
    const again = (await (await POST(req("POST", {}), gp)).json()).data
      .reservation;
    expect(again.reservationId).not.toBe(r.reservationId);
    expect((await (await GET(req(), cp)).json()).data.defaultName).toBe(
      "RSVP name",
    );
    expect((await q`SELECT status FROM app.rsvps`)[0].status).toBe("maybe");
    // Both a receipt replay and a fresh delayed cancel targeting the old reservation preserve the new one.
    for (const k of [cancelKey, randomUUID()])
      expect(
        (await DELETE(req("DELETE", { reservationId: r.reservationId }, k), gp))
          .status,
      ).toBe(200);
    expect(
      (await q`SELECT id FROM app.gift_reservations WHERE status='active'`)[0]
        .id,
    ).toBe(again.reservationId);
    // More than one private page; no truncation and no records of a different guest.
    await q`INSERT INTO app.gifts(wishlist_id,title) SELECT ${w.id},'Paged gift '||n FROM generate_series(1,101) n`;
    await q`INSERT INTO app.gift_reservations(gift_id,guest_identity_id) SELECT id,${guests[0].id} FROM app.gifts WHERE wishlist_id=${w.id} AND title LIKE 'Paged gift %'`;
    const page1 = (await (await GET(req(), cp)).json()).data;
    expect(page1.reservations).toHaveLength(100);
    expect(page1.nextCursor).toBeTruthy();
    const pageRequest = new Request(
      "https://example.test/api/reservations?cursor=" + page1.nextCursor,
    );
    const page2 = (await (await GET(pageRequest, cp)).json()).data;
    expect(page2.reservations).toHaveLength(2);
    expect(
      new Set(
        [...page1.reservations, ...page2.reservations].map(
          (x: { reservationId: string }) => x.reservationId,
        ),
      ).size,
    ).toBe(102);
    // Failure inside the reservation transaction rolls back name, reservation, analytics and receipt.
    const [failedGift] =
      await q`INSERT INTO app.gifts(wishlist_id,title) VALUES(${w.id},'Rollback gift') RETURNING id`;
    await pg.exec(
      "RESET ROLE; CREATE FUNCTION app.fail_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$; CREATE TRIGGER fail_reservation BEFORE INSERT ON app.gift_reservations FOR EACH ROW EXECUTE FUNCTION app.fail_reservation(); SET ROLE fe_server;",
    );
    actor = 1;
    bridge.cookies.set("__Host-fe_guest", raws[1]);
    const failedKey = randomUUID();
    const failed = await POST(
      req("POST", { guestName: "Failed name" }, failedKey),
      {
        params: Promise.resolve({
          publicId: pid,
          giftId: String(failedGift.id),
        }),
      },
    );
    expect(failed.status).toBe(500);
    expect(
      await q`SELECT id FROM app.gift_reservations WHERE gift_id=${failedGift.id}`,
    ).toHaveLength(0);
    expect(
      await q`SELECT id FROM app.api_idempotency WHERE key=${failedKey}`,
    ).toHaveLength(0);
    expect(
      (
        await q`SELECT display_name FROM app.guest_identities WHERE id=${guests[1].id}`
      )[0].display_name,
    ).toBeNull();
    await pg.exec(
      "RESET ROLE; DROP TRIGGER fail_reservation ON app.gift_reservations; DROP FUNCTION app.fail_reservation(); SET ROLE fe_server;",
    );
    actor = 0;
    bridge.cookies.set("__Host-fe_guest", raws[0]);
    await q`UPDATE app.guest_sessions SET revoked_at=now() WHERE guest_identity_id=${guests[0].id}`;
    expect(
      (await DELETE(req("DELETE", { reservationId: again.reservationId }), gp))
        .status,
    ).toBe(401);
    expect((await (await GET(req(), cp)).json()).data.sessionState).toBe(
      "lost",
    );
    expect((await (await GET(req(), cp)).json()).data.reservations).toEqual([]);
    await q`UPDATE app.events SET deleted_at=now() WHERE id=${event.id}`;
    expect((await GET(req(), cp)).status).toBe(404);
  } finally {
    bridge.cookies.clear();
    await pg.close();
  }
}, 30000);
