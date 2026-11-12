import { it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { SignJWT, generateKeyPair, exportJWK } from "jose";
const bridge = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  query: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = bridge.cookies.get(name);
      return value ? { value } : undefined;
    },
  }),
}));
vi.mock("@/server/db/client", () => ({
  db: () => bridge.query,
  transaction: bridge.transaction,
}));
import { POST as miniLogin } from "@/app/api/auth/telegram/mini-app/route";
import { GET as events } from "@/app/api/v1/events/route";
import { GET as me } from "@/app/api/v1/me/route";
import { GET as start } from "@/app/api/auth/telegram/start/route";
import { GET as callback } from "@/app/api/auth/telegram/callback/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { tokenHash, csrf } from "@/server/auth/crypto";
import { ownedEvent } from "@/server/db/authorization";
import type { Transaction } from "@/server/db/client";

it("runs organizer authentication, identity linking, pagination, isolation and session lifecycle against PostgreSQL", async () => {
  process.env.APP_URL = "https://example.test";
  process.env.TELEGRAM_BOT_TOKEN = "123:test";
  process.env.TELEGRAM_CLIENT_ID = "123";
  process.env.TELEGRAM_CLIENT_SECRET = "test";
  process.env.AUTH_ENCRYPTION_KEY = Buffer.alloc(32, 2).toString("base64");
  process.env.SESSION_SECRET = "s".repeat(32);
  process.env.RATE_LIMIT_SECRET = "r".repeat(32);
  process.env.AUTH_RATE_LIMIT = "100";
  process.env.VERCEL = "0";
  const pg = await PGlite.create();
  const adapter =
    (client: Pick<PGlite, "query">) =>
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.reduce(
        (text, part, index) => text + (index ? "$" + index : "") + part,
        "",
      );
      return (await client.query(sql, values)).rows;
    };
  const query = adapter(pg);
  bridge.query.mockImplementation(query);
  bridge.transaction.mockImplementation(
    (work: (tx: unknown) => Promise<unknown>) =>
      pg.transaction((tx) => work(adapter(tx))),
  );
  const request = (path: string) => new Request("https://example.test" + path);
  function signed(id: number, age = 0) {
    const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000) - age),
      query_id: "test-" + id,
      user: JSON.stringify({ id, first_name: "Организатор" }),
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
            .map(([key, value]) => key + "=" + value)
            .join("\n"),
        )
        .digest("hex"),
    );
    return params.toString();
  }
  const postMini = (raw: string) =>
    miniLogin(
      new Request("https://example.test/api/auth/telegram/mini-app", {
        method: "POST",
        headers: {
          Origin: "https://example.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ initData: raw }),
      }),
    );
  function accept(response: Response, name: string) {
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith(name + "="));
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=lax");
    bridge.cookies.set(name, cookie!.split(";")[0].slice(name.length + 1));
  }
  try {
    await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    for (const file of (await readdir("supabase/migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort())
      await pg.exec(await readFile("supabase/migrations/" + file, "utf8"));
    await pg.exec("SET ROLE fe_server");
    expect((await events(request("/api/v1/events"))).status).toBe(401);
    expect((await postMini(signed(111, 301))).status).toBe(401);
    expect((await postMini(signed(111).replace("111", "222"))).status).toBe(
      401,
    );
    expect((await postMini("malformed")).status).toBe(401);
    const raw = signed(111);
    const first = await postMini(raw);
    expect(first.status).toBe(200);
    const userId = (await first.json()).data.id;
    accept(first, "__Host-fe_org");
    const firstToken = bridge.cookies.get("__Host-fe_org")!;
    expect(
      (await (await events(request("/api/v1/events"))).json()).data.events,
    ).toEqual([]);
    expect((await (await me(request("/api/v1/me"))).json()).data.id).toBe(
      userId,
    );
    const retry = await postMini(
      new URLSearchParams(
        [...new URLSearchParams(raw).entries()].reverse(),
      ).toString(),
    );
    expect(retry.status).toBe(200);
    accept(retry, "__Host-fe_org");
    expect(bridge.cookies.get("__Host-fe_org")).toBe(firstToken);
    bridge.cookies.delete("__Host-fe_org");
    expect((await postMini(raw)).status).toBe(401);
    bridge.cookies.set("__Host-fe_org", firstToken);

    const miniLogout = await logout(
      new Request("https://example.test/api/auth/logout", {
        method: "POST",
        headers: {
          Origin: "https://example.test",
          "x-csrf-token": csrf(firstToken),
        },
      }),
    );
    expect(miniLogout.status).toBe(200);
    accept(miniLogout, "__Host-fe_reauth");
    const grant = bridge.cookies.get("__Host-fe_reauth")!;
    bridge.cookies.delete("__Host-fe_org");
    expect((await me(request("/api/v1/me"))).status).toBe(401);
    bridge.cookies.set("__Host-fe_reauth", "x".repeat(43));
    expect((await postMini(raw)).status).toBe(401);
    bridge.cookies.set("__Host-fe_reauth", grant);
    expect((await postMini(signed(111, 301))).status).toBe(401);
    const relogin = await postMini(raw);
    expect(relogin.status).toBe(200);
    expect((await relogin.clone().json()).data.id).toBe(userId);
    accept(relogin, "__Host-fe_org");
    const reloginToken = bridge.cookies.get("__Host-fe_org")!;
    expect(reloginToken).not.toBe(firstToken);
    bridge.cookies.delete("__Host-fe_org");
    expect((await postMini(raw)).status).toBe(401);
    bridge.cookies.set("__Host-fe_org", reloginToken);

    const oidcStart = await start(request("/api/auth/telegram/start"));
    expect(oidcStart.status).toBe(307);
    accept(oidcStart, "__Host-fe_oidc");
    const url = new URL(oidcStart.headers.get("location")!);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "slice";
    const jwt = await new SignJWT({
      id: 111,
      name: "Организатор",
      nonce: url.searchParams.get("nonce"),
    })
      .setProtectedHeader({ alg: "RS256", kid: "slice" })
      .setSubject("oidc-sub-is-not-telegram-id")
      .setIssuer("https://oauth.telegram.org")
      .setAudience("123")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, options?: RequestInit) => {
        if (String(input).includes("jwks"))
          return Response.json({ keys: [jwk] });
        const verifier = new URLSearchParams(
          options!.body as URLSearchParams,
        ).get("code_verifier")!;
        expect(tokenHash(verifier).toString("base64url")).toBe(
          url.searchParams.get("code_challenge"),
        );
        return Response.json({ id_token: jwt });
      }),
    );
    const oidc = await callback(
      request(
        "/api/auth/telegram/callback?code=test&state=" +
          url.searchParams.get("state"),
      ),
    );
    expect(oidc.status).toBe(307);
    expect(oidc.headers.get("location")).toBe("https://example.test/events");
    accept(oidc, "__Host-fe_org");
    expect((await (await me(request("/api/v1/me"))).json()).data.id).toBe(
      userId,
    );
    expect(
      await query`SELECT id FROM app.users WHERE telegram_user_id=111`,
    ).toHaveLength(1);
    const replay = await callback(
      request(
        "/api/auth/telegram/callback?code=test&state=" +
          url.searchParams.get("state"),
      ),
    );
    expect(replay.status).toBe(307);
    expect(replay.headers.get("location")).toBe(
      "https://example.test/login?error=telegram",
    );
    const cancelled = await callback(
      request("/api/auth/telegram/callback?error=access_denied"),
    );
    expect(cancelled.headers.get("location")).toBe(
      "https://example.test/login?error=telegram",
    );
    const [other] =
      (await query`INSERT INTO app.users(telegram_user_id,display_name) VALUES(222,'Другой') RETURNING id`) as {
        id: string;
      }[];
    await pg.query(
      "INSERT INTO app.events(organizer_id,public_id,title,event_type,event_date,timezone,effective_at) SELECT $1,lpad(n::text,22,'0'),'Моё событие '||n,'family','2027-01-01','UTC','2027-01-01T00:00Z' FROM generate_series(1,105) n",
      [userId],
    );
    const [foreign] =
      (await query`INSERT INTO app.events(organizer_id,public_id,title,event_type,event_date,timezone,effective_at) VALUES(${other.id},'xxxxxxxxxxxxxxxxxxxxxx','Чужое событие','family','2027-01-01','UTC','2027-01-01T00:00Z') RETURNING id`) as {
        id: string;
      }[];
    await query`UPDATE app.events SET deleted_at=now() WHERE public_id='0000000000000000000001'`;
    const page = await events(
      request("/api/v1/events?organizer_id=" + other.id),
    );
    expect(page.headers.get("cache-control")).toBe("private, no-store");
    const one = (await page.json()).data;
    const two = (
      await (
        await events(request("/api/v1/events?cursor=" + one.nextCursor))
      ).json()
    ).data;
    expect(one.events).toHaveLength(100);
    expect(two.events).toHaveLength(4);
    expect(two.nextCursor).toBeNull();
    expect(
      new Set([...one.events, ...two.events].map((event) => event.id)).size,
    ).toBe(104);
    expect(
      [...one.events, ...two.events].some((event) => event.id === foreign.id),
    ).toBe(false);
    expect(
      (await events(request("/api/v1/events?cursor=invalid"))).status,
    ).toBe(422);
    await expect(
      ownedEvent(
        query as unknown as Transaction,
        { kind: "organizer", userId, sessionId: "unused" },
        foreign.id,
      ),
    ).rejects.toMatchObject({ status: 404 });
    const currentToken = bridge.cookies.get("__Host-fe_org")!;
    bridge.cookies.set("__Host-fe_org", firstToken);
    expect((await me(request("/api/v1/me"))).status).toBe(401);
    bridge.cookies.set("__Host-fe_org", currentToken);
    expect((await me(request("/api/v1/me"))).status).toBe(200);
    expect((await me(request("/api/v1/me"))).status).toBe(200);
    await query`UPDATE app.organizer_sessions SET expires_at=now()-interval '1 second',created_at=now()-interval '31 days' WHERE token_hash=${tokenHash(currentToken)}`;
    expect((await me(request("/api/v1/me"))).status).toBe(401);
    await query`UPDATE app.organizer_sessions SET expires_at=now()+interval '1 day' WHERE token_hash=${tokenHash(currentToken)}`;
    const outRequest = (withCsrf: boolean) =>
      new Request("https://example.test/api/auth/logout", {
        method: "POST",
        headers: {
          Origin: "https://example.test",
          ...(withCsrf ? { "x-csrf-token": csrf(currentToken) } : {}),
        },
      });
    expect((await logout(outRequest(false))).status).toBe(403);
    expect((await logout(outRequest(true))).status).toBe(200);
    expect((await me(request("/api/v1/me"))).status).toBe(401);
    expect((await events(request("/api/v1/events"))).status).toBe(401);
  } finally {
    vi.unstubAllGlobals();
    bridge.cookies.clear();
    await pg.close();
  }
}, 30000);
