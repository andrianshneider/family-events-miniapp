import { it, expect, vi, beforeEach } from "vitest";
const { query, principal, sign } = vi.hoisted(() => ({
  query: vi.fn(),
  principal: vi.fn(),
  sign: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({ db: () => query }));
vi.mock("@/server/auth/sessions", () => ({
  organizer: principal,
  organizerProfile: async () => ({
    principal: await principal(),
    profile: { id: "trusted-user", displayName: "Test" },
  }),
}));
vi.mock("@/server/storage/client", () => ({
  mediaBucket: () => "test",
  storage: () => ({ from: () => ({ createSignedUrls: sign }) }),
}));
import { GET } from "@/app/api/v1/events/route";
import { AppError } from "@/server/errors";
beforeEach(() => {
  query.mockReset();
  principal.mockReset();
});
it("requires an organizer session before querying events", async () => {
  principal.mockRejectedValue(new AppError(401, "UNAUTHENTICATED", "Войдите."));
  const r = await GET(new Request("https://example.test/api/v1/events"));
  expect(r.status).toBe(401);
  expect(query).not.toHaveBeenCalled();
});
it("binds owner from the session, excludes deleted events and returns a bounded projection", async () => {
  principal.mockResolvedValue({
    userId: "trusted-user",
    kind: "organizer",
    sessionId: "s",
  });
  query.mockResolvedValue(
    Array.from({ length: 101 }, (_, i) => ({
      id: String(i),
      title: "Праздник",
      event_type: "family",
      event_date: "2026-10-10",
      start_time: null,
      timezone: "Europe/Moscow",
      venue_name: null,
      organizer_id: "private",
      description: "private",
    })),
  );
  const r = await GET(
    new Request("https://example.test/api/v1/events?organizer_id=attacker"),
  );
  const j = await r.json();
  const [strings, ...values] = query.mock.calls[0];
  expect(strings.join("?")).toContain(
    "e.organizer_id=? AND e.deleted_at IS NULL",
  );
  expect(values).toEqual(["trusted-user"]);
  expect(j.data.events).toHaveLength(100);
  expect(j.data.hasMore).toBe(true);
  expect(j.data.events[0]).not.toHaveProperty("organizer_id");
  expect(j.data.events[0]).not.toHaveProperty("description");
  expect(r.headers.get("cache-control")).toBe("private, no-store");
});

it("signs authorized thumbnail paths in one batch, without exposing original paths", async () => {
  principal.mockResolvedValue({ userId: "trusted-user" });
  query.mockResolvedValue([
    {
      id: "a",
      title: "First",
      event_date: "2027-01-01",
      storage_path: "ready/owner/a/image.webp",
    },
    {
      id: "b",
      title: "Second",
      event_date: "2027-01-01",
      storage_path: "ready/owner/b/image.webp",
    },
  ]);
  sign.mockResolvedValue({
    data: [
      {
        path: "ready/owner/a/image.thumb.webp",
        signedUrl: "https://storage.test/thumb-a",
      },
      {
        path: "ready/owner/b/image.thumb.webp",
        signedUrl: "https://storage.test/thumb-b",
      },
    ],
    error: null,
  });
  const r = await GET(new Request("https://example.test/api/v1/events"));
  const j = await r.json();
  expect(sign).toHaveBeenCalledTimes(1);
  expect(sign).toHaveBeenCalledWith(
    ["ready/owner/a/image.thumb.webp", "ready/owner/b/image.thumb.webp"],
    120,
  );
  expect(j.data.events[0].coverUrl).toBe("https://storage.test/thumb-a");
  expect(j.data.events[0]).not.toHaveProperty("storage_path");
  expect(r.headers.get("server-timing")).toContain("storage_sign;dur=");
});
