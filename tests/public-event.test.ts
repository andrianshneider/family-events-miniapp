import { it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import sharp from "sharp";
const bridge = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  query: vi.fn(),
  image: new Uint8Array(),
}));
vi.mock("@/server/db/client", () => ({ db: () => bridge.query }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      bridge.cookies.has(name)
        ? { value: bridge.cookies.get(name) }
        : undefined,
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Error("TEST_NOT_FOUND");
  },
  redirect: (path: string) => {
    throw Error("TEST_REDIRECT:" + path);
  },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/server/storage/client", () => ({
  mediaBucket: () => "test",
  storage: () => ({
    from: () => ({
      download: async () => ({
        data: new Blob([bridge.image as BlobPart]),
        error: null,
      }),
    }),
  }),
}));
import { GET as publicGet } from "@/app/api/v1/public/events/[publicId]/route";
import { GET as coverGet } from "@/app/api/v1/public/events/[publicId]/cover/route";
import { GET as ogGet } from "@/app/api/v1/public/events/[publicId]/og/route";
import { GET as shareGet } from "@/app/api/v1/events/[eventId]/share/route";
import PublicPage, { generateMetadata } from "@/app/e/[publicId]/page";
import SharePage from "@/app/events/[eventId]/share/page";
import {
  publicEvent,
  canonicalEventUrl,
} from "@/server/services/public-events";
import { PublicEventScreen } from "@/components/public-event-screen";
import { tokenHash } from "@/server/auth/crypto";
import { returnPath } from "@/server/telegram/oidc";

it("serves a sanitized real event and OG without identity, closes all public reads after deletion and protects sharing", async () => {
  process.env.APP_URL = "https://example.test";
  process.env.APP_ENV = "local";
  process.env.VERCEL = "0";
  process.env.RATE_LIMIT_SECRET = "r".repeat(32);
  process.env.PUBLIC_READ_RATE_LIMIT = "120";
  const pg = await PGlite.create();
  const query = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.reduce(
        (text, part, index) => text + (index ? "$" + index : "") + part,
        "",
      );
      return (
        await pg.query<Record<string, string | number | null>>(sql, values)
      ).rows;
    },
    { json: JSON.stringify },
  );
  bridge.query.mockImplementation(query);
  const request = (id: string) =>
    [
      new Request(
        "https://untrusted.test/ignored?public_url=https://attacker.test",
      ),
      { params: Promise.resolve({ publicId: id }) },
    ] as const;
  const sharing = (id: string) =>
    shareGet(new Request("https://untrusted.test/"), {
      params: Promise.resolve({ eventId: id }),
    });
  try {
    await pg.exec("CREATE ROLE anon;CREATE ROLE authenticated;");
    for (const file of (await readdir("supabase/migrations"))
      .filter((v) => v.endsWith(".sql"))
      .sort())
      await pg.exec(await readFile("supabase/migrations/" + file, "utf8"));
    await pg.exec("SET ROLE fe_server");
    const users =
      await query`INSERT INTO app.users(telegram_user_id,display_name,username) VALUES(1001,'PRIVATE_ORGANIZER_NAME','PRIVATE_USERNAME'),(1002,'OTHER_OWNER','OTHER_USERNAME') RETURNING id`;
    const publicId = randomBytes(16).toString("base64url");
    const [event] =
      await query`INSERT INTO app.events(organizer_id,public_id,title,event_type,event_date,timezone,effective_at) VALUES(${users[0].id},${publicId},'Встреча семьи','family','2030-01-01','Europe/Moscow','2029-12-31T21:00Z') RETURNING id`;
    const [wishlist] =
      await query`INSERT INTO app.wishlists(event_id) VALUES(${event.id}) RETURNING id`;
    const [guest] =
      await query`INSERT INTO app.guest_identities(display_name) VALUES('PRIVATE_GUEST_NAME') RETURNING id`;
    await query`INSERT INTO app.rsvps(event_id,guest_identity_id,guest_name,status,adults_count,children_count,comment) VALUES(${event.id},${guest.id},'PRIVATE_GUEST_NAME','yes',2,1,'PRIVATE_GUEST_COMMENT')`;
    const [gift] =
      await query`INSERT INTO app.gifts(wishlist_id,title) VALUES(${wishlist.id},'PRIVATE_GIFT') RETURNING id`;
    await query`SELECT * FROM app.reserve_gift(${publicId},${gift.id},${guest.id})`;
    bridge.cookies.clear();
    const response = await publicGet(...request(publicId));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.getSetCookie()).toHaveLength(0);
    const dto = (await response.json()).data;
    expect(Object.keys(dto).sort()).toEqual(
      [
        "publicId",
        "title",
        "eventType",
        "eventDate",
        "startTime",
        "endTime",
        "timezone",
        "isPast",
        "venueName",
        "address",
        "directions",
        "description",
        "dressCode",
        "coverUrl",
        "routeUrl",
        "version",
      ].sort(),
    );
    expect(dto).toMatchObject({
      title: "Встреча семьи",
      coverUrl: null,
      routeUrl: null,
      startTime: null,
      venueName: null,
    });
    const html = renderToString(
      createElement(PublicEventScreen, { initialEvent: dto }),
    );
    expect(html).toContain("Встреча семьи");
    expect(html).not.toContain("Построить маршрут");
    expect(html).not.toContain("Дресс-код");
    expect(html).not.toContain("Вишлист");
    for (const privateValue of [
      "PRIVATE_",
      String(users[0].id),
      String(guest.id),
      String(gift.id),
    ]) {
      expect(html).not.toContain(privateValue);
      expect(JSON.stringify(dto)).not.toContain(privateValue);
    }
    expect(await query`SELECT id FROM app.guest_sessions`).toHaveLength(0);
    expect(await query`SELECT id FROM app.organizer_sessions`).toHaveLength(0);
    expect(await query`SELECT id FROM app.guest_identities`).toHaveLength(1);
    expect((await publicGet(...request("bad"))).status).toBe(404);
    expect((await publicGet(...request("x".repeat(22)))).status).toBe(404);
    expect((await coverGet(...request("bad"))).status).toBe(404);
    const fallbackOg = await ogGet(...request(publicId));
    expect(fallbackOg.status).toBe(200);
    const fallbackBuffer = Buffer.from(await fallbackOg.arrayBuffer());
    expect(await sharp(fallbackBuffer).metadata()).toMatchObject({
      width: 1200,
      height: 630,
      format: "png",
    });
    const meta = await generateMetadata({
      params: Promise.resolve({ publicId }),
    });
    expect(meta.alternates?.canonical).toBe(
      "https://example.test/e/" + publicId,
    );
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(JSON.stringify(meta)).not.toContain("PRIVATE_");
    expect(JSON.stringify(meta)).toContain(`/og?v=1`);
    expect(JSON.stringify(meta)).not.toContain("untrusted");
    expect(
      (await PublicPage({ params: Promise.resolve({ publicId }) })).props
        .initialEvent.title,
    ).toBe(dto.title);
    expect((await sharing(String(event.id))).status).toBe(401);
    const tokens = ["o".repeat(43), "t".repeat(43)];
    for (let i = 0; i < users.length; i++)
      await query`INSERT INTO app.organizer_sessions(user_id,token_hash,expires_at) VALUES(${users[i].id},${tokenHash(tokens[i])},now()+interval '1 day')`;
    bridge.cookies.set("__Host-fe_org", tokens[1]);
    expect((await sharing(String(event.id))).status).toBe(404);
    await expect(
      SharePage({ params: Promise.resolve({ eventId: String(event.id) }) }),
    ).rejects.toThrow("TEST_NOT_FOUND");
    expect((await publicGet(...request(publicId))).status).toBe(200); // Unrelated organizer cookie has no effect on public read.
    bridge.cookies.set("__Host-fe_org", tokens[0]);
    const share = (await (await sharing(String(event.id))).json()).data;
    expect(share.publicUrl).toBe(canonicalEventUrl(publicId));
    expect(share.event).toEqual(dto);
    expect(
      (
        await SharePage({
          params: Promise.resolve({ eventId: String(event.id) }),
        })
      ).props.initial.publicUrl,
    ).toBe(share.publicUrl);
    expect(returnPath(`/events/${event.id}/share`)).toBe(
      `/events/${event.id}/share`,
    );
    expect(
      returnPath(`/events/${event.id}/share?public_url=https://bad.test`),
    ).toBe("/events");
    await query`UPDATE app.organizer_sessions SET revoked_at=now() WHERE user_id=${users[0].id}`;
    expect((await sharing(String(event.id))).status).toBe(401);
    expect((await publicGet(...request(publicId))).status).toBe(200);
    bridge.image = new Uint8Array(
      await sharp({
        create: { width: 100, height: 70, channels: 3, background: "#7952c7" },
      })
        .webp()
        .toBuffer(),
    );
    const [asset] =
      await query`INSERT INTO app.media_assets(owner_user_id,storage_path,mime_type,byte_size,width,height,state) VALUES(${users[0].id},'ready/test.webp','image/webp',${bridge.image.length},100,70,'ready') RETURNING id`;
    await query`UPDATE app.events SET title='<script>alert(1)</script> & семья',venue_name='Дом',address='https://attacker.test/?x=<script>',latitude=55.75,longitude=37.62,start_time='18:00',end_time='21:00',starts_at='2029-12-31T15:00Z',ends_at='2029-12-31T18:00Z',directions='Со двора',description='Описание',dress_code='Светлое',cover_asset_id=${asset.id},version=2 WHERE id=${event.id}`;
    const full = await publicEvent(publicId);
    expect(full.startTime).toBe("18:00");
    expect(full.routeUrl).toBe(
      "https://www.google.com/maps/search/?api=1&query=55.75%2C37.62",
    );
    const fullHtml = renderToString(
      createElement(PublicEventScreen, { initialEvent: full }),
    );
    expect(fullHtml).toContain("&lt;script&gt;");
    expect(fullHtml).not.toContain("<script>alert");
    expect(fullHtml).toContain('rel="noopener noreferrer"');
    const imageResponse = await ogGet(...request(publicId));
    expect(imageResponse.status).toBe(200);
    const ogBytes = Buffer.from(await imageResponse.arrayBuffer());
    expect(await sharp(ogBytes).metadata()).toMatchObject({
      width: 1200,
      height: 630,
      format: "png",
    });
    expect((await coverGet(...request(publicId))).status).toBe(200);
    expect(canonicalEventUrl(publicId)).toBe(share.publicUrl);
    await query`SELECT app.soft_delete_event(${event.id},${users[0].id},2)`;
    for (const handler of [publicGet, coverGet, ogGet])
      expect((await handler(...request(publicId))).status).toBe(404);
    await expect(
      PublicPage({ params: Promise.resolve({ publicId }) }),
    ).rejects.toThrow("TEST_NOT_FOUND");
    const deletedMeta = await generateMetadata({
      params: Promise.resolve({ publicId }),
    });
    expect(deletedMeta.title).toBe("Это мероприятие недоступно");
    expect(deletedMeta.openGraph).toBeUndefined();
    expect(JSON.stringify(deletedMeta)).not.toContain("alert(1)");
    await query`UPDATE app.organizer_sessions SET revoked_at=NULL WHERE user_id=${users[0].id}`;
    expect((await sharing(String(event.id))).status).toBe(404);
    process.env.PUBLIC_READ_RATE_LIMIT = "1";
    expect((await publicGet(...request("x".repeat(22)))).status).toBe(429);
  } finally {
    bridge.cookies.clear();
    process.env.PUBLIC_READ_RATE_LIMIT = "120";
    await pg.close();
  }
}, 30000);
