import { it, expect, vi, beforeEach } from "vitest";
const { query, principal } = vi.hoisted(() => ({
  query: vi.fn(),
  principal: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({ db: () => query }));
vi.mock("@/server/auth/sessions", () => ({ organizer: principal }));
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
  expect(strings.join("?")).toContain("organizer_id=? AND deleted_at IS NULL");
  expect(values).toEqual(["trusted-user"]);
  expect(j.data.events).toHaveLength(100);
  expect(j.data.hasMore).toBe(true);
  expect(j.data.events[0]).not.toHaveProperty("organizer_id");
  expect(j.data.events[0]).not.toHaveProperty("description");
  expect(r.headers.get("cache-control")).toBe("private, no-store");
});
