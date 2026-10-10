import { Temporal } from "@js-temporal/polyfill";
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { validateInitData } from "@/server/telegram/init-data";
import { eventTimes, reminderAt } from "@/server/services/time";
import { returnPath } from "@/server/telegram/oidc";
import { encrypt, decrypt, csrf } from "@/server/auth/crypto";
import { httpUrl, eventInput, rsvpInput, giftInput } from "@/lib/validation";
const bot = "123:test";
const now = 1800000000;
function signed(age = 0) {
  const p = new URLSearchParams({
    auth_date: String(now - age),
    user: JSON.stringify({ id: 123456, first_name: "Иван" }),
  });
  const secret = createHmac("sha256", "WebAppData").update(bot).digest();
  p.set(
    "hash",
    createHmac("sha256", secret)
      .update(
        [...p.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => k + "=" + v)
          .join("\n"),
      )
      .digest("hex"),
  );
  return p.toString();
}
describe("Telegram trust boundary", () => {
  it("accepts signed data and maps string ID", () =>
    expect(validateInitData(signed(), bot, now).telegramId).toBe("123456"));
  it("rejects forgery, expiry, future and duplicate fields", () => {
    for (const raw of [
      signed().replace("123456", "999999"),
      signed(301),
      signed(-1),
      signed() + "&auth_date=" + now,
    ])
      expect(() => validateInitData(raw, bot, now)).toThrow();
  });
});
describe("timezones", () => {
  it("rejects DST gap and fold", () => {
    for (const date of ["2026-03-29", "2026-10-25"])
      expect(() => eventTimes(date, "02:30", null, "Europe/Berlin")).toThrow();
  });
  it("handles date-only event and previous-day 09:00 reminder", () => {
    expect(
      eventTimes("2027-01-01", null, null, "Europe/Moscow").effectiveAt,
    ).toBe("2026-12-31T21:00:00Z");
    expect(
      reminderAt(
        "2027-01-01",
        null,
        "Europe/Moscow",
        Temporal.Instant.from("2026-10-10T00:00:00Z"),
      ),
    ).toBe("2026-12-31T06:00:00Z");
  });
});
describe("validation", () => {
  it("rejects unsafe URLs and credentials", () => {
    for (const url of [
      "javascript:alert(1)",
      "file:///secret",
      "data:text/html,x",
      "https://user:pass@example.com",
    ])
      expect(httpUrl.safeParse(url).success).toBe(false);
  });
  it("rejects mismatched currency and invalid no counts", () => {
    expect(giftInput.safeParse({ title: "Gift", amount: "10" }).success).toBe(
      false,
    );
    expect(
      rsvpInput.safeParse({
        guestName: "Guest",
        status: "no",
        adultsCount: 1,
        childrenCount: 0,
        expectedVersion: null,
      }).success,
    ).toBe(false);
  });
  it("does not accept midnight crossing or forged authority", () => {
    expect(
      eventInput.safeParse({
        title: "Party",
        eventType: "party",
        eventDate: "2027-01-01",
        timezone: "Europe/Moscow",
        startTime: "23:00",
        endTime: "01:00",
        organizerId: "fake",
      }).success,
    ).toBe(false);
  });
  it("allowlists redirects", () => {
    for (const p of [
      "https://evil.com",
      "//evil.com",
      "/events/../evil",
      "/\\evil",
    ])
      expect(returnPath(p)).toBe("/events");
  });
});
describe("credential storage", () => {
  it("encrypts roundtrip and fails tampering", () => {
    process.env.AUTH_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
    const bytes = encrypt("private-verifier");
    expect(decrypt(bytes)).toBe("private-verifier");
    bytes[15] ^= 1;
    expect(() => decrypt(bytes)).toThrow();
  });
  it("binds CSRF to current session", () => {
    process.env.SESSION_SECRET = "x".repeat(32);
    expect(csrf("a")).not.toBe(csrf("b"));
  });
});
