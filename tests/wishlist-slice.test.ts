import { it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
const bridge = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  query: vi.fn(),
  transaction: vi.fn(),
  download: vi.fn(),
  signed: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      bridge.cookies.has(name)
        ? { value: bridge.cookies.get(name) }
        : undefined,
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/db/client", () => ({
  db: () => bridge.query,
  transaction: bridge.transaction,
}));
vi.mock("@/server/storage/client", () => ({
  mediaBucket: () => "event-media",
  storage: () => ({
    from: () => ({ download: bridge.download, createSignedUrl: bridge.signed }),
  }),
}));
import {
  GET as list,
  PATCH as toggle,
} from "@/app/api/v1/events/[eventId]/wishlist/route";
import { POST as create } from "@/app/api/v1/events/[eventId]/gifts/route";
import {
  GET as own,
  PATCH as edit,
  DELETE as remove,
} from "@/app/api/v1/events/[eventId]/gifts/[giftId]/route";
import { GET as publicList } from "@/app/api/v1/public/events/[publicId]/wishlist/route";
import { GET as publicDetail } from "@/app/api/v1/public/events/[publicId]/gifts/[giftId]/route";
import { GET as image } from "@/app/api/v1/public/events/[publicId]/gifts/[giftId]/image/route";
import { GET as ownerImage } from "@/app/api/v1/events/[eventId]/gifts/[giftId]/image/route";
import { GET as media } from "@/app/api/v1/media/[assetId]/route";
import { readWishlist, readGift } from "@/server/services/wishlists";
import { tokenHash, csrf } from "@/server/auth/crypto";
import { giftInput } from "@/lib/validation";
import { returnPath } from "@/server/telegram/oidc";
import { WishlistScreen } from "@/components/wishlist-screen";
import { GiftDetailScreen } from "@/components/gift-detail-screen";
it("validates optional fields and decimal/Unicode boundaries without floating point money", () => {
  expect(giftInput.parse({ title: "😊😊" }).title).toBe("😊😊");
  for (const fields of [
    { title: "😊" },
    { title: "😊".repeat(121) },
    { title: "aa", comment: "😊".repeat(301) },
    { title: "aa", amount: "0", currency: "RUB" },
    { title: "aa", amount: "1.001", currency: "USD" },
    { title: "aa", amount: "10000000000.00", currency: "USD" },
    { title: "aa", amount: "1" },
    { title: "aa", currency: "USD" },
    { title: "aa", externalUrl: "javascript:alert(1)" },
    { title: "aa", externalUrl: "https://user:pass@example.test" },
  ])
    expect(giftInput.safeParse(fields).success).toBe(false);
  expect(
    giftInput.safeParse({
      title: "aa",
      amount: "9999999999.99",
      currency: "RUB",
      comment: "😊".repeat(300),
    }).success,
  ).toBe(true);
});
it("runs gift ownership, CRUD, surprise, deletion confirmation, pagination and media through restricted PostgreSQL and actual handlers", async () => {
  process.env.APP_URL = "https://example.test";
  process.env.APP_ENV = "local";
  process.env.VERCEL = "0";
  process.env.SESSION_SECRET = "s".repeat(32);
  process.env.RATE_LIMIT_SECRET = "r".repeat(32);
  process.env.GIFT_WRITE_RATE_LIMIT = "200";
  process.env.PUBLIC_READ_RATE_LIMIT = "400";
  const pg = await PGlite.create();
  const adapter = (client: Pick<PGlite, "query">) =>
    Object.assign(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.reduce(
          (text, part, index) => text + (index ? "$" + index : "") + part,
          "",
        );
        return (await client.query<Record<string, unknown>>(sql, values)).rows;
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
    otherPid = randomBytes(16).toString("base64url"),
    orgRaw = randomBytes(32).toString("base64url"),
    foreignRaw = randomBytes(32).toString("base64url");
  const req = (
    path: string,
    method = "GET",
    body?: unknown,
    key: string = randomUUID(),
    token = csrf(orgRaw),
  ) =>
    new Request("https://example.test" + path, {
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
    await pg.exec("SET ROLE fe_server");
    const users =
      await q`INSERT INTO app.users(telegram_user_id,display_name) VALUES(4001,'Owner'),(4002,'Foreign') RETURNING id`;
    const [e] =
      await q`INSERT INTO app.events(organizer_id,public_id,title,event_type,event_date,timezone,effective_at) VALUES(${users[0].id},${pid},'Wishlist test','family','2030-01-01','UTC','2030-01-01T00:00Z') RETURNING id`;
    const [other] =
      await q`INSERT INTO app.events(organizer_id,public_id,title,event_type,event_date,timezone,effective_at) VALUES(${users[1].id},${otherPid},'Other event','family','2030-01-01','UTC','2030-01-01T00:00Z') RETURNING id`;
    await q`INSERT INTO app.wishlists(event_id) VALUES(${e.id}),(${other.id})`;
    await q`INSERT INTO app.organizer_sessions(user_id,token_hash,expires_at) VALUES(${users[0].id},${tokenHash(orgRaw)},now()+interval '1 day'),(${users[1].id},${tokenHash(foreignRaw)},now()+interval '1 day')`;
    const eventId = String(e.id),
      params = { params: Promise.resolve({ eventId }) },
      publicParams = { params: Promise.resolve({ publicId: pid }) };
    const gparams = (id: string) => ({
        params: Promise.resolve({ eventId, giftId: id }),
      }),
      pubg = (id: string) => ({
        params: Promise.resolve({ publicId: pid, giftId: id }),
      });
    const empty = await publicList(req("/public/wishlist"), publicParams);
    expect(empty.status).toBe(200);
    expect(empty.headers.get("set-cookie")).toBeNull();
    expect((await empty.json()).data.total).toBe(0);
    expect(await q`SELECT id FROM app.guest_identities`).toHaveLength(0);
    expect(
      (await create(req("/gifts", "POST", { title: "Подарок" }), params))
        .status,
    ).toBe(401);
    bridge.cookies.set("__Host-fe_org", orgRaw);
    expect(
      (
        await create(
          req("/gifts", "POST", { title: "Подарок" }, randomUUID(), "bad"),
          params,
        )
      ).status,
    ).toBe(403);
    for (const bad of [
      { title: "a" },
      { title: "Valid", organizerId: users[0].id },
      { title: "Valid", amount: "0", currency: "RUB" },
      { title: "Valid", externalUrl: "data:text/html,evil" },
    ])
      expect((await create(req("/gifts", "POST", bad), params)).status).toBe(
        422,
      );
    const payload = {
        title: "  😊 Подарок  ",
        amount: "10.50",
        currency: "RUB",
        comment: "  Детали\nподарка  ",
        externalUrl: "https://example.test/item",
      },
      key = randomUUID();
    const created = await create(req("/gifts", "POST", payload, key), params);
    expect(created.status).toBe(201);
    const saved = (await created.json()).data,
      gid = saved.id;
    expect(
      (await (await create(req("/gifts", "POST", payload, key), params)).json())
        .data,
    ).toEqual(saved);
    expect(
      (
        await create(
          req("/gifts", "POST", { ...payload, title: "Other" }, key),
          params,
        )
      ).status,
    ).toBe(409);
    expect(
      await q`SELECT id FROM app.gifts WHERE wishlist_id=(SELECT id FROM app.wishlists WHERE event_id=${eventId})`,
    ).toHaveLength(1);
    expect(
      await q`SELECT id FROM app.analytics_events WHERE name='gift_created'`,
    ).toHaveLength(1);
    const [guest] =
      await q`INSERT INTO app.guest_identities(display_name) VALUES('Secret reserver') RETURNING id`;
    await q`SELECT app.reserve_gift(${pid},${gid},${guest.id})`;
    const owner = (await (await list(req("/wishlist"), params)).json()).data;
    expect(owner.hideReserverIdentity).toBe(true);
    expect(owner.reservedTotal).toBe(1);
    expect(JSON.stringify(owner)).not.toContain("Secret reserver");
    expect(owner.gifts[0]).not.toHaveProperty("reserverDisplayName");
    const offBody = {
        expectedVersion: owner.version,
        hideReserverIdentity: false,
      },
      offKey = randomUUID();
    expect(
      (await toggle(req("/wishlist", "PATCH", offBody, offKey), params)).status,
    ).toBe(200);
    expect(
      (await toggle(req("/wishlist", "PATCH", offBody, offKey), params)).status,
    ).toBe(200);
    expect(
      (
        await toggle(
          req("/wishlist", "PATCH", { ...offBody, hideReserverIdentity: true }),
          params,
        )
      ).status,
    ).toBe(409);
    const exposed = (await (await list(req("/wishlist"), params)).json()).data;
    expect(exposed.gifts[0].reserverDisplayName).toBe("Secret reserver");
    const publicRevisionBeforeName = (await readWishlist(pid)).revision;
    await q`UPDATE app.guest_identities SET display_name='Renamed reserver' WHERE id=${guest.id}`;
    const ownerAfterName = (await (await list(req("/wishlist"), params)).json())
      .data;
    expect(ownerAfterName.revision).not.toBe(exposed.revision);
    expect((await readWishlist(pid)).revision).toBe(publicRevisionBeforeName);
    await q`UPDATE app.guest_identities SET display_name='Secret reserver' WHERE id=${guest.id}`;
    const [delta] =
      await q`INSERT INTO app.gifts(wishlist_id,title) VALUES((SELECT id FROM app.wishlists WHERE event_id=${other.id}),'Reservation delta') RETURNING id`;
    await q`SELECT app.reserve_gift(${otherPid},${delta.id},${guest.id})`;
    const beforeDelta = await readWishlist(otherPid);
    await q`SELECT app.cancel_reservation(${otherPid},${delta.id},${guest.id})`;
    await q`SELECT app.reserve_gift(${otherPid},${delta.id},${guest.id})`;
    const afterDelta = await readWishlist(otherPid);
    expect(afterDelta.reservedTotal).toBe(beforeDelta.reservedTotal);
    expect(afterDelta.revision).not.toBe(beforeDelta.revision);
    const pub = (
      await (await publicList(req("/wishlist"), publicParams)).json()
    ).data;
    expect(JSON.stringify(pub)).not.toContain("Secret reserver");
    expect(pub).not.toHaveProperty("hideReserverIdentity");
    expect(pub.gifts[0]).not.toHaveProperty("imageAssetId");
    expect(Object.keys(pub.gifts[0]).sort()).toEqual(
      [
        "id",
        "title",
        "externalUrl",
        "amount",
        "currency",
        "comment",
        "imageUrl",
        "reserved",
        "version",
      ].sort(),
    );
    const html = renderToString(
      createElement(WishlistScreen, { eventKey: pid, initial: pub }),
    );
    expect(html).toContain("Подарок");
    expect(html).not.toContain("Secret reserver");
    expect(html).not.toContain("Выбрать подарок");
    const detail = (await (await publicDetail(req("/gift"), pubg(gid))).json())
      .data;
    expect(
      renderToString(
        createElement(GiftDetailScreen, {
          publicId: pid,
          giftId: gid,
          initial: detail,
        }),
      ),
    ).toContain("Детали");
    bridge.cookies.set("__Host-fe_org", foreignRaw);
    expect((await list(req("/wishlist"), params)).status).toBe(404);
    expect((await own(req("/gift"), gparams(gid))).status).toBe(404);
    expect(
      (
        await create(
          req(
            "/gifts",
            "POST",
            { title: "Mine?" },
            randomUUID(),
            csrf(foreignRaw),
          ),
          params,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await publicDetail(req("/gift"), {
          params: Promise.resolve({ publicId: otherPid, giftId: gid }),
        })
      ).status,
    ).toBe(404);
    bridge.cookies.set("__Host-fe_org", orgRaw);
    const [pendingAsset] =
      await q`INSERT INTO app.media_assets(owner_user_id,storage_path,mime_type,byte_size,width,height,state) VALUES(${users[0].id},'pending/test','image/webp',100,10,10,'pending') RETURNING id`;
    expect(
      (
        await edit(
          req("/gift", "PATCH", {
            expectedVersion: 1,
            fields: { ...payload, imageAssetId: pendingAsset.id },
          }),
          gparams(gid),
        )
      ).status,
    ).toBe(422);
    const [foreignAsset] =
      await q`INSERT INTO app.media_assets(owner_user_id,storage_path,mime_type,byte_size,width,height,state) VALUES(${users[1].id},'ready/foreign.webp','image/webp',100,10,10,'ready') RETURNING id`;
    expect(
      (
        await edit(
          req("/gift", "PATCH", {
            expectedVersion: 1,
            fields: { ...payload, imageAssetId: foreignAsset.id },
          }),
          gparams(gid),
        )
      ).status,
    ).toBe(422);
    const [asset] =
      await q`INSERT INTO app.media_assets(owner_user_id,storage_path,mime_type,byte_size,width,height,state) VALUES(${users[0].id},'ready/test.webp','image/webp',100,10,10,'ready') RETURNING id`;
    const fields = {
      ...payload,
      title: "Изменённый подарок",
      imageAssetId: asset.id,
    };
    expect(
      (
        await edit(
          req("/gift", "PATCH", { expectedVersion: 1, fields }),
          gparams(gid),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await edit(
          req("/gift", "PATCH", {
            expectedVersion: 1,
            fields: { title: "Stale" },
          }),
          gparams(gid),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await edit(
          req("/gift", "PATCH", { expectedVersion: 2, fields }),
          gparams(gid),
        )
      ).status,
    ).toBe(200);
    expect((await readGift(pid, gid)).version).toBe(2);
    expect(
      await q`SELECT id FROM app.gift_reservations WHERE gift_id=${gid} AND status='active'`,
    ).toHaveLength(1);
    const webp = await sharp({
      create: { width: 1200, height: 900, channels: 3, background: "purple" },
    })
      .webp()
      .toBuffer();
    bridge.download.mockResolvedValue({
      data: new Blob([new Uint8Array(webp)]),
      error: null,
    });
    bridge.signed.mockResolvedValue({
      data: { signedUrl: "https://storage.example.test/image" },
      error: null,
    });
    const img = await image(req("/image"), pubg(gid));
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/webp");
    expect(
      (await sharp(Buffer.from(await img.arrayBuffer())).metadata()).width,
    ).toBeLessThanOrEqual(640);
    expect((await ownerImage(req("/image"), gparams(gid))).status).toBe(200);
    expect(
      (
        await remove(
          req("/gift", "DELETE", { expectedVersion: 2 }),
          gparams(gid),
        )
      ).status,
    ).toBe(409);
    expect(
      await q`SELECT id FROM app.gift_reservations WHERE gift_id=${gid} AND status='active'`,
    ).toHaveLength(1);
    // Force failure after cancelling the reservation: both mutations and receipt must roll back.
    await pg.exec(
      "RESET ROLE;CREATE FUNCTION app.test_gift_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER test_gift_failure BEFORE UPDATE ON app.gifts FOR EACH ROW EXECUTE FUNCTION app.test_gift_failure();SET ROLE fe_server;",
    );
    expect(
      (
        await remove(
          req(
            "/gift",
            "DELETE",
            { expectedVersion: 2, confirmReserved: true },
            "rollback-gift-0001",
          ),
          gparams(gid),
        )
      ).status,
    ).toBe(500);
    expect(
      await q`SELECT id FROM app.gift_reservations WHERE gift_id=${gid} AND status='active'`,
    ).toHaveLength(1);
    expect(
      await q`SELECT id FROM app.api_idempotency WHERE key='rollback-gift-0001'`,
    ).toHaveLength(0);
    await pg.exec(
      "RESET ROLE;DROP TRIGGER test_gift_failure ON app.gifts;SET ROLE fe_server;",
    );
    const delKey = randomUUID(),
      delBody = { expectedVersion: 2, confirmReserved: true };
    expect(
      (await remove(req("/gift", "DELETE", delBody, delKey), gparams(gid)))
        .status,
    ).toBe(200);
    expect(
      (await remove(req("/gift", "DELETE", delBody, delKey), gparams(gid)))
        .status,
    ).toBe(200);
    expect(
      (
        await q`SELECT status,cancel_reason FROM app.gift_reservations WHERE gift_id=${gid}`
      )[0],
    ).toMatchObject({ status: "cancelled", cancel_reason: "gift_deleted" });
    expect((await publicDetail(req("/gift"), pubg(gid))).status).toBe(404);
    expect((await image(req("/image"), pubg(gid))).status).toBe(404);
    expect(
      (
        await media(req("/media"), {
          params: Promise.resolve({ assetId: String(asset.id) }),
        })
      ).status,
    ).toBe(404);
    // Shared asset stays readable through another active gift.
    const another = await create(
      req("/gifts", "POST", { title: "Shared", imageAssetId: asset.id }),
      params,
    );
    expect(another.status).toBe(201);
    expect(
      (
        await media(req("/media"), {
          params: Promise.resolve({ assetId: String(asset.id) }),
        })
      ).status,
    ).toBe(307);
    expect(
      (await q`SELECT state FROM app.media_assets WHERE id=${asset.id}`)[0]
        .state,
    ).toBe("ready");
    for (let n = 0; n < 23; n++)
      await q`INSERT INTO app.gifts(wishlist_id,title,created_at) VALUES((SELECT id FROM app.wishlists WHERE event_id=${eventId}),${"Paging " + n},${"2026-10-12T00:00:00." + String(123400 + n) + "Z"})`;
    let cursor: string | null = null;
    const ids = new Set<string>();
    do {
      const page = await readWishlist(pid, {
        limit: 7,
        ...(cursor ? { cursor } : {}),
      });
      expect(page.total).toBe(24);
      for (const g of page.gifts) {
        expect(ids.has(g.id)).toBe(false);
        ids.add(g.id);
      }
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids.size).toBe(24);
    const page = await readWishlist(pid, { limit: 1 });
    await expect(
      readWishlist(otherPid, { cursor: page.nextCursor! }),
    ).rejects.toMatchObject({ status: 422 });
    expect(returnPath(`/events/${eventId}/wishlist`)).toBe(
      `/events/${eventId}/wishlist`,
    );
    expect(returnPath(`/events/${eventId}/wishlist?url=https://bad.test`)).toBe(
      "/events",
    );
    const [now] = await q`SELECT version FROM app.events WHERE id=${eventId}`;
    await q`SELECT app.soft_delete_event(${eventId},${users[0].id},${now.version})`;
    expect((await publicList(req("/wishlist"), publicParams)).status).toBe(404);
    expect((await list(req("/wishlist"), params)).status).toBe(404);
    expect(
      (await create(req("/gifts", "POST", { title: "Closed" }), params)).status,
    ).toBe(404);
    expect(
      (await remove(req("/gift", "DELETE", delBody, delKey), gparams(gid)))
        .status,
    ).toBe(200);
  } finally {
    bridge.cookies.clear();
    await pg.close();
  }
}, 30000);
