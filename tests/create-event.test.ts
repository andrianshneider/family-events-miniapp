import { it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { createHmac } from "node:crypto";
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
  redirect: (path: string) => {
    throw Error("TEST_REDIRECT:" + path);
  },
  useRouter: () => ({ push: vi.fn() }),
}));
import { POST as miniLogin } from "@/app/api/auth/telegram/mini-app/route";
import { POST as create, GET as list } from "@/app/api/v1/events/route";
import {
  GET as detail,
  PATCH as update,
} from "@/app/api/v1/events/[eventId]/route";
import EditPage from "@/app/events/[eventId]/edit/page";
import EventPage from "@/app/events/[eventId]/page";
import { csrf } from "@/server/auth/crypto";
import { returnPath } from "@/server/telegram/oidc";

it("creates real events atomically and enforces validation, idempotency and ownership through actual handlers", async () => {
  process.env.APP_URL = "https://example.test";
  process.env.TELEGRAM_BOT_TOKEN = "123:test";
  process.env.SESSION_SECRET = "s".repeat(32);
  process.env.RATE_LIMIT_SECRET = "r".repeat(32);
  process.env.AUTH_RATE_LIMIT = "100";
  process.env.VERCEL = "0";
  const pg = await PGlite.create();
  const adapter = (client: Pick<PGlite, "query">) =>
    Object.assign(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.reduce(
          (text, part, index) => text + (index ? "$" + index : "") + part,
          "",
        );
        return (await client.query(sql, values)).rows;
      },
      { json: (value: unknown) => JSON.stringify(value) },
    );
  const query = adapter(pg);
  bridge.query.mockImplementation(query);
  bridge.transaction.mockImplementation(
    (work: (tx: unknown) => Promise<unknown>) =>
      pg.transaction((tx) => work(adapter(tx))),
  );
  async function login(id: number) {
    const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id, first_name: "Тест" }),
    });
    const secret = createHmac("sha256", "WebAppData")
      .update("123:test")
      .digest();
    params.set(
      "hash",
      createHmac("sha256", secret)
        .update(
          [...params.entries()]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([k, v]) => k + "=" + v)
            .join("\n"),
        )
        .digest("hex"),
    );
    const response = await miniLogin(
      new Request("https://example.test/api/auth/telegram/mini-app", {
        method: "POST",
        headers: {
          Origin: "https://example.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ initData: params.toString() }),
      }),
    );
    expect(response.status).toBe(200);
    const raw = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("__Host-fe_org="))!
      .split(";")[0]
      .split("=")[1];
    bridge.cookies.set("__Host-fe_org", raw);
    return { raw, id: (await response.json()).data.id as string };
  }
  const minimal = {
    title: "Семейный праздник",
    eventType: "family",
    eventDate: "2030-01-01",
    timezone: "Europe/Moscow",
  };
  const post = (
    payload: unknown,
    key = "key-create-event-0001",
    withCsrf = true,
  ) =>
    create(
      new Request("https://example.test/api/v1/events", {
        method: "POST",
        headers: {
          Origin: "https://example.test",
          "Content-Type": "application/json",
          "Idempotency-Key": key,
          ...(withCsrf
            ? {
                "x-csrf-token": csrf(bridge.cookies.get("__Host-fe_org") ?? ""),
              }
            : {}),
        },
        body: JSON.stringify(payload),
      }),
    );
  const get = (id: string) =>
    detail(new Request("https://example.test/api/v1/events/" + id), {
      params: Promise.resolve({ eventId: id }),
    });
  const patch = (
    id: string,
    fields: unknown,
    expectedVersion = 1,
    key = "key-edit-event-00001",
    withCsrf = true,
  ) =>
    update(
      new Request("https://example.test/api/v1/events/" + id, {
        method: "PATCH",
        headers: {
          Origin: "https://example.test",
          "Content-Type": "application/json",
          "Idempotency-Key": key,
          ...(withCsrf
            ? {
                "x-csrf-token": csrf(bridge.cookies.get("__Host-fe_org") ?? ""),
              }
            : {}),
        },
        body: JSON.stringify({ fields, expectedVersion }),
      }),
      { params: Promise.resolve({ eventId: id }) },
    );
  try {
    await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    for (const file of (await readdir("supabase/migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort())
      await pg.exec(await readFile("supabase/migrations/" + file, "utf8"));
    await pg.exec("SET ROLE fe_server");
    expect((await post(minimal)).status).toBe(401);
    const owner = await login(101);
    expect((await post(minimal, "key-no-csrf-00001", false)).status).toBe(403);
    expect((await post({ ...minimal, organizerId: "attacker" })).status).toBe(
      422,
    );
    for (const payload of [
      { ...minimal, title: " " },
      { ...minimal, eventType: "invalid" },
      { ...minimal, eventDate: "2020-01-01" },
      { ...minimal, timezone: "Invalid/Zone" },
      { ...minimal, endTime: "19:00" },
      { ...minimal, startTime: "23:00", endTime: "01:00" },
      {
        ...minimal,
        eventDate: "2030-03-31",
        timezone: "Europe/Berlin",
        startTime: "02:30",
      },
    ])
      expect((await post(payload)).status).toBe(422);
    const created = await post(minimal);
    expect(created.status).toBe(201);
    const first = (await created.json()).data;
    expect(first.publicId).toMatch(/^[\w-]{22}$/);
    const repeated = (await (await post(minimal)).json()).data;
    expect(repeated).toEqual(first);
    expect(
      (await post({ ...minimal, title: "Изменённое название" })).status,
    ).toBe(409);
    const [counts] =
      (await query`SELECT (SELECT count(*)::int FROM app.events) AS events,(SELECT count(*)::int FROM app.wishlists) AS wishlists,(SELECT count(*)::int FROM app.analytics_events WHERE name='event_created') AS analytics`) as {
        events: number;
        wishlists: number;
        analytics: number;
      }[];
    expect(counts).toEqual({ events: 1, wishlists: 1, analytics: 1 });
    const read = await get(first.id);
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("private, no-store");
    expect((await read.json()).data).toMatchObject({
      id: first.id,
      title: minimal.title,
      coverUrl: null,
      wishlist: { surprise: true, gifts: 0 },
      responses: { yes: 0, no: 0, maybe: 0 },
    });
    const page = await EventPage({
      params: Promise.resolve({ eventId: first.id }),
      searchParams: Promise.resolve({}),
    });
    expect(page.props.initialEvent.id).toBe(first.id);
    const all = (
      await (
        await list(new Request("https://example.test/api/v1/events"))
      ).json()
    ).data;
    expect(all.events.map((event: { id: string }) => event.id)).toEqual([
      first.id,
    ]);
    expect(all.events[0].coverUrl).toBeNull();
    const [instant] =
      (await query`SELECT starts_at,ends_at,effective_at::text FROM app.events WHERE id=${first.id}`) as {
        starts_at: null;
        ends_at: null;
        effective_at: string;
      }[];
    expect(instant.starts_at).toBeNull();
    expect(instant.ends_at).toBeNull();
    expect(new Date(instant.effective_at).toISOString()).toBe(
      "2029-12-31T21:00:00.000Z",
    );
    bridge.cookies.delete("__Host-fe_org");
    const other = await login(202);
    expect((await get(first.id)).status).toBe(404);
    await expect(
      EventPage({
        params: Promise.resolve({ eventId: first.id }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("TEST_NOT_FOUND");
    const [asset] =
      (await query`INSERT INTO app.media_assets(owner_user_id,storage_path,mime_type,byte_size,width,height,state) VALUES(${other.id},'ready/test-other','image/webp',100,10,10,'ready') RETURNING id`) as {
        id: string;
      }[];
    bridge.cookies.set("__Host-fe_org", owner.raw);
    expect(
      (
        await post(
          { ...minimal, coverAssetId: asset.id },
          "key-foreign-cover-01",
        )
      ).status,
    ).toBe(422);
    const [pendingAsset] =
      (await query`INSERT INTO app.media_assets(owner_user_id,storage_path,mime_type,byte_size,width,height,state) VALUES(${owner.id},'pending/test-owner','image/webp',100,10,10,'pending') RETURNING id`) as {
        id: string;
      }[];
    expect(
      (
        await post(
          { ...minimal, coverAssetId: pendingAsset.id },
          "key-pending-cover-01",
        )
      ).status,
    ).toBe(422);
    await query`UPDATE app.media_assets SET state='ready' WHERE id=${pendingAsset.id}`;
    const full = {
      ...minimal,
      title: "Полное событие",
      startTime: "18:00",
      endTime: "21:00",
      venueName: "Дом",
      address: "Москва",
      description: "Описание\nс переносом",
      directions: "Со двора",
      dressCode: "Светлая одежда",
      coverAssetId: pendingAsset.id,
    };
    const second = (await (await post(full, "key-full-event-00001")).json())
      .data;
    expect((await (await get(second.id)).json()).data).toMatchObject({
      title: full.title,
      startTime: "18:00",
      endTime: "21:00",
      description: full.description,
      coverUrl: `/api/v1/events/${second.id}/cover`,
    });
    const refreshedList = (
      await (
        await list(new Request("https://example.test/api/v1/events"))
      ).json()
    ).data.events;
    expect(
      refreshedList.find((event: { id: string }) => event.id === second.id)
        .coverUrl,
    ).toBe(`/api/v1/events/${second.id}/cover`);
    bridge.cookies.set("__Host-fe_org", other.raw);
    const otherList = (
      await (
        await list(new Request("https://example.test/api/v1/events"))
      ).json()
    ).data.events;
    expect(
      otherList.some((event: { id: string }) => event.id === second.id),
    ).toBe(false);
    bridge.cookies.set("__Host-fe_org", owner.raw);
    await pg.exec(
      "RESET ROLE; CREATE FUNCTION app.test_fail_wishlist() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$; CREATE TRIGGER test_failure BEFORE INSERT ON app.wishlists FOR EACH ROW EXECUTE FUNCTION app.test_fail_wishlist(); SET ROLE fe_server;",
    );
    const failed = await post(minimal, "key-rollback-event-01");
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain("test failure");
    expect(await query`SELECT id FROM app.events`).toHaveLength(2);
    expect(
      await query`SELECT id FROM app.api_idempotency WHERE key='key-rollback-event-01'`,
    ).toHaveLength(0);
    await pg.exec(
      "RESET ROLE; DROP TRIGGER test_failure ON app.wishlists; DROP FUNCTION app.test_fail_wishlist(); SET ROLE fe_server;",
    );
    const pair = await Promise.all([
      post(minimal, "key-concurrent-00001"),
      post(minimal, "key-concurrent-00001"),
    ]);
    expect(pair.map((response) => response.status)).toEqual([201, 201]);
    expect((await pair[0].json()).data).toEqual((await pair[1].json()).data);
    expect(await query`SELECT id FROM app.events`).toHaveLength(3);
    const editPage = await EditPage({
      params: Promise.resolve({ eventId: second.id }),
    });
    expect(editPage.props.editing.fields.coverAssetId).toBe(pendingAsset.id);
    expect(editPage.props.editing.version).toBe(1);
    expect(
      (await patch(second.id, full, 1, "key-edit-csrf-00001", false)).status,
    ).toBe(403);
    expect(
      (await patch(second.id, { ...full, organizerId: "forged" })).status,
    ).toBe(422);
    expect((await patch(second.id, { ...full, endTime: "17:00" })).status).toBe(
      422,
    );
    expect(
      (
        await patch(second.id, {
          ...full,
          eventDate: "2030-03-31",
          timezone: "Europe/Berlin",
          startTime: "02:30",
        })
      ).status,
    ).toBe(422);
    expect(
      (await patch(second.id, { ...full, coverAssetId: asset.id })).status,
    ).toBe(422);
    bridge.cookies.set("__Host-fe_org", other.raw);
    expect((await patch(second.id, full)).status).toBe(404);
    await expect(
      EditPage({ params: Promise.resolve({ eventId: second.id }) }),
    ).rejects.toThrow("TEST_NOT_FOUND");
    bridge.cookies.set("__Host-fe_org", owner.raw);
    const changed = {
      ...full,
      title: "Обновлённое событие",
      venueName: "Новое место",
      coverAssetId: null,
    };
    const saved = await patch(second.id, changed);
    expect(saved.status).toBe(200);
    const edited = (await saved.json()).data;
    expect(edited.version).toBe(2);
    expect(edited.changeId).toBeTruthy();
    expect((await (await patch(second.id, changed)).json()).data).toEqual(
      edited,
    );
    expect((await (await get(second.id)).json()).data).toMatchObject({
      title: changed.title,
      coverUrl: null,
      version: 2,
    });
    expect(
      (await patch(second.id, full, 1, "key-edit-stale-00001")).status,
    ).toBe(409);
    const [record] =
      await query`SELECT changes,notify_decision FROM app.event_changes WHERE event_id=${second.id}`;
    expect(record).toMatchObject({
      changes: { venueName: { before: "Дом", after: "Новое место" } },
      notify_decision: "skip",
    });
    expect(
      await query`SELECT id FROM app.wishlists WHERE event_id=${second.id}`,
    ).toHaveLength(1);
    expect(
      (
        await patch(
          second.id,
          {
            ...changed,
            eventDate: "2020-01-01",
            coverAssetId: pendingAsset.id,
          },
          2,
          "key-edit-past-00001",
        )
      ).status,
    ).toBe(200);
    expect((await (await get(second.id)).json()).data).toMatchObject({
      coverAssetId: pendingAsset.id,
      version: 3,
      isPast: true,
    });
    const parallel = await Promise.all([
      patch(
        second.id,
        { ...full, title: "Первое сохранение" },
        3,
        "key-edit-parallel-01",
      ),
      patch(
        second.id,
        { ...full, title: "Второе сохранение" },
        3,
        "key-edit-parallel-02",
      ),
    ]);
    expect(parallel.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await (await get(second.id)).json()).data.version).toBe(4);
    await pg.exec(
      "RESET ROLE; CREATE FUNCTION app.test_fail_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$; CREATE TRIGGER test_change_failure BEFORE INSERT ON app.event_changes FOR EACH ROW EXECUTE FUNCTION app.test_fail_change(); SET ROLE fe_server;",
    );
    expect(
      (
        await patch(
          second.id,
          { ...full, venueName: "Несохранённое" },
          4,
          "key-edit-rollback-01",
        )
      ).status,
    ).toBe(500);
    expect((await (await get(second.id)).json()).data.version).toBe(4);
    expect(
      await query`SELECT id FROM app.api_idempotency WHERE key='key-edit-rollback-01'`,
    ).toHaveLength(0);
    await pg.exec(
      "RESET ROLE; DROP TRIGGER test_change_failure ON app.event_changes; DROP FUNCTION app.test_fail_change(); SET ROLE fe_server;",
    );
    await query`UPDATE app.events SET deleted_at=now() WHERE id=${first.id}`;
    expect((await patch(first.id, minimal)).status).toBe(404);
    expect((await get(first.id)).status).toBe(404);
    await expect(
      EventPage({
        params: Promise.resolve({ eventId: first.id }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("TEST_NOT_FOUND");
    bridge.cookies.delete("__Host-fe_org");
    expect((await patch(second.id, full)).status).toBe(401);
    await expect(
      EditPage({ params: Promise.resolve({ eventId: second.id }) }),
    ).rejects.toThrow("TEST_REDIRECT:/login?returnTo=");
    expect((await get(second.id)).status).toBe(401);
    expect(returnPath("/events/new")).toBe("/events/new");
    expect(returnPath("//attacker.test/events/new")).toBe("/events");
    expect(returnPath(`/events/${second.id}/edit`)).toBe(
      `/events/${second.id}/edit`,
    );
    expect(returnPath(`/events/${second.id}/edit?redirect=evil`)).toBe(
      "/events",
    );
  } finally {
    bridge.cookies.clear();
    await pg.close();
  }
}, 30000);
