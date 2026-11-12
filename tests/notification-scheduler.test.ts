import { it, expect, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
const bridge = vi.hoisted(() => ({
  transaction: vi.fn(),
  updates: vi.fn(),
  deliver: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({ transaction: bridge.transaction }));
vi.mock("@/server/telegram/updates", () => ({
  processUpdates: bridge.updates,
}));
vi.mock("@/server/notifications/worker", () => ({ deliver: bridge.deliver }));
import { schedulerCredential } from "@/server/notifications/scheduler-auth";
import { POST } from "@/app/api/internal/organizer-notifications/route";
const signed = (stamp: string, nonce = randomUUID(), payload: unknown = {}) =>
  new Request("https://example.test/api/internal/organizer-notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-scheduler-timestamp": stamp,
      "x-scheduler-nonce": nonce,
      "x-scheduler-signature": createHmac("sha256", process.env.CRON_SECRET!)
        .update(`organizer-notifications\n${stamp}\n${nonce}`)
        .digest("hex"),
    },
    body: JSON.stringify(payload),
  });
it("accepts only scoped HMAC proofs inside their lifetime and rejects tampering", () => {
  process.env.CRON_SECRET = "c".repeat(32);
  const now = 1800000000,
    nonce = randomUUID();
  expect(schedulerCredential(signed(String(now), nonce), now)).toEqual({
    stamp: String(now),
    nonce,
  });
  for (const t of [now - 121, now + 11])
    expect(() => schedulerCredential(signed(String(t)), now)).toThrow();
  const r = signed(String(now));
  r.headers.set("x-scheduler-nonce", randomUUID());
  expect(() => schedulerCredential(r, now)).toThrow();
  expect(() =>
    schedulerCredential(new Request("https://example.test"), now),
  ).toThrow();
});
it("consumes a proof once and rejects nonempty bodies before pipeline execution", async () => {
  process.env.CRON_SECRET = "c".repeat(32);
  const pg = await PGlite.create();
  try {
    await pg.exec("CREATE ROLE anon;CREATE ROLE authenticated;");
    for (const f of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pg.exec(await readFile("supabase/migrations/" + f, "utf8"));
    await pg.exec("SET ROLE fe_server");
    const adapter = (c: Pick<PGlite, "query">) =>
      Object.assign(
        async (strings: TemplateStringsArray, ...values: unknown[]) => {
          const text = strings.reduce(
            (a, p, i) => a + (i ? "$" + i : "") + p,
            "",
          );
          return (await c.query<Record<string, unknown>>(text, values)).rows;
        },
        { json: JSON.stringify },
      );
    bridge.transaction.mockImplementation(
      (work: (tx: unknown) => Promise<unknown>) =>
        pg.transaction((tx) => work(adapter(tx))),
    );
    bridge.updates.mockResolvedValue({ processed: 0 });
    bridge.deliver.mockResolvedValue({ processed: 0, sent: 0 });
    const stamp = String(Math.floor(Date.now() / 1000)),
      nonce = randomUUID();
    const first = await POST(signed(stamp, nonce)),
      again = await POST(signed(stamp, nonce));
    expect(first.status).toBe(200);
    expect((await again.json()).data).toEqual((await first.json()).data);
    expect(bridge.deliver).toHaveBeenCalledTimes(1);
    expect(bridge.updates).toHaveBeenCalledTimes(1);
    expect(
      (await POST(signed(stamp, randomUUID(), { chatId: "evil" }))).status,
    ).toBe(422);
  } finally {
    await pg.close();
  }
}, 30000);
