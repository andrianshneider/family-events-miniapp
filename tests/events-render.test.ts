import { it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { EventsScreen } from "@/components/events-screen";
it("renders the first real event and profile in server HTML before client effects or API requests", () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const html = renderToString(
    createElement(EventsScreen, {
      initial: {
        profile: { id: "owner", displayName: "Organizer", avatarUrl: null },
        events: [
          {
            id: "event",
            title: "Server event",
            eventDate: "2027-01-01",
            eventType: "family",
            startTime: null,
            timezone: "UTC",
            venueName: null,
            coverUrl: null,
          },
        ],
        hasMore: false,
        nextCursor: null,
      },
    }),
  );
  expect(html).toContain("Server event");
  expect(html).toContain("Organizer");
  expect(html).not.toContain("Загружаем события");
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
