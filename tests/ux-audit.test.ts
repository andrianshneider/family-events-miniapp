import { it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  childrenCount,
  adultsCount,
  peopleCount,
  responsesCount,
} from "@/lib/russian-count";
import { PublicEventScreen } from "@/components/public-event-screen";
import { ShareEventScreen } from "@/components/share-event-screen";
import { GuestSummary } from "@/components/guest-summary";
import { rsvpInput } from "@/lib/validation";
import type { PublicEvent } from "@/lib/invitation";
import { vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const event: PublicEvent = {
  publicId: "test",
  title: "Семейная встреча",
  eventType: "family",
  eventDate: "2027-11-07",
  startTime: null,
  endTime: null,
  timezone: "Europe/Moscow",
  isPast: false,
  venueName: null,
  address: "Адрес встречи",
  directions: "Как найти",
  description: "Длинное описание".repeat(50),
  dressCode: null,
  coverUrl: null,
  routeUrl: null,
  version: 1,
};
it("places the single answer before address, gifts and long information without an empty cover", () => {
  const html = renderToString(
    createElement(PublicEventScreen, { initialEvent: event }),
  );
  expect(html.indexOf("rsvp-heading")).toBeLessThan(
    html.indexOf("Адрес встречи"),
  );
  expect(html.indexOf("Адрес встречи")).toBeLessThan(
    html.indexOf("Длинное описание"),
  );
  expect(html.match(/id="rsvp-heading"/g)).toHaveLength(1);
  expect(html).not.toContain('class="event-cover public-cover"');
});
it("places sharing controls before preview and labels same-tab navigation honestly", () => {
  const html = renderToString(
    createElement(ShareEventScreen, {
      eventId: "test",
      initial: { event, publicUrl: "https://example.test/e/test" },
    }),
  );
  expect(html.indexOf("invitation-controls")).toBeLessThan(
    html.indexOf("invitation-preview"),
  );
  expect(html).toContain("Открыть приглашение");
  expect(html).not.toContain("приглашение ↗");
});
it("distinguishes confirmed participants and responses", () => {
  const html = renderToString(
    createElement(GuestSummary, {
      summary: {
        responses: { yes: 1, no: 4, maybe: 3, total: 8 },
        confirmed: { adults: 2, children: 1 },
      },
    }),
  );
  expect(html.replaceAll("<!-- -->", "")).toContain("Ожидаем 3 человека");
  expect(html).toContain("1 ребёнок");
  expect(html).toContain("Всего ответов: ");
  expect(html).not.toContain("семей");
});
it("declines counts including teen exceptions", () => {
  expect([1, 2, 5, 11, 21].map(childrenCount)).toEqual([
    "1 ребёнок",
    "2 ребёнка",
    "5 детей",
    "11 детей",
    "21 ребёнок",
  ]);
  expect(adultsCount(1)).toBe("1 взрослый");
  expect(peopleCount(5)).toBe("5 человек");
  expect(responsesCount(22)).toBe("22 ответа");
});
it("validates 300 Unicode code points after Cyrillic, emoji and IME text insertion without silent truncation", () => {
  const base = {
    guestName: "Анна",
    status: "yes",
    adultsCount: 1,
    childrenCount: 0,
    expectedVersion: null,
  };
  for (const text of [
    "я".repeat(300),
    "😊".repeat(300),
    "漢".repeat(300),
    "я😊".repeat(150),
  ]) {
    expect(rsvpInput.parse({ ...base, comment: text }).comment).toBe(text);
    expect(
      rsvpInput.parse({ ...base, comment: " " + text + " " }).comment,
    ).toBe(text);
    expect(rsvpInput.safeParse({ ...base, comment: text + "я" }).success).toBe(
      false,
    );
  }
});
