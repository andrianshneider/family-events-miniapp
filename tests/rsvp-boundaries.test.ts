import { it, expect } from "vitest";
import { rsvpInput } from "@/lib/validation";
const base = {
  guestName: "Анна",
  status: "yes",
  adultsCount: 1,
  childrenCount: 0,
  comment: null,
  expectedVersion: null,
};
it("counts RSVP Unicode code points like PostgreSQL, trims names and enforces each status and integer boundary", () => {
  expect(rsvpInput.safeParse({ ...base, guestName: "😊" }).success).toBe(false);
  expect(
    rsvpInput.parse({ ...base, guestName: " 😊😊 ", comment: "😊".repeat(300) })
      .guestName,
  ).toBe("😊😊");
  expect(
    rsvpInput.safeParse({ ...base, guestName: "😊".repeat(60) }).success,
  ).toBe(true);
  expect(
    rsvpInput.safeParse({ ...base, guestName: "😊".repeat(61) }).success,
  ).toBe(false);
  expect(
    rsvpInput.safeParse({ ...base, comment: "😊".repeat(301) }).success,
  ).toBe(false);
  for (const status of ["yes", "maybe"]) {
    expect(
      rsvpInput.safeParse({
        ...base,
        status,
        adultsCount: 20,
        childrenCount: 20,
      }).success,
    ).toBe(true);
    for (const [field, value] of [
      ["adultsCount", 0],
      ["adultsCount", 21],
      ["childrenCount", -1],
      ["childrenCount", 21],
      ["childrenCount", 1.5],
      ["adultsCount", NaN],
    ])
      expect(
        rsvpInput.safeParse({ ...base, status, [field]: value }).success,
      ).toBe(false);
  }
  expect(
    rsvpInput.safeParse({
      ...base,
      status: "no",
      adultsCount: 0,
      childrenCount: 0,
    }).success,
  ).toBe(true);
  expect(rsvpInput.safeParse({ ...base, status: "no" }).success).toBe(false);
  expect(
    rsvpInput.safeParse({ ...base, guestIdentityId: "forged" }).success,
  ).toBe(false);
});
