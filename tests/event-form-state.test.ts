import { it, expect } from "vitest";
import { emptyEventFields, readEventForm } from "@/lib/event-form-state";
const user = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const savedAt = 10000000;
const fields = {
  ...emptyEventFields,
  title: "Незаконченная форма",
  description: "Текст\nс переносом",
};
const snapshot = JSON.stringify({
  userId: user,
  savedAt,
  fields,
  attempt: null,
});
it("restores unfinished fields only for the original account within the temporary retention period", () => {
  expect(readEventForm(snapshot, user, savedAt + 1000)?.fields).toEqual(fields);
  expect(readEventForm(snapshot, other, savedAt + 1000)).toBeNull();
  expect(readEventForm(snapshot, user, savedAt + 3600000)).toBeNull();
  expect(readEventForm(snapshot, user, savedAt - 1)).toBeNull();
  expect(readEventForm("broken JSON", user, savedAt)).toBeNull();
});
it("preserves the exact request key and payload for an uncertain creation result, rejects credentials in a form snapshot", () => {
  const attempt = {
    key: "key-uncertain-create-01",
    payload: {
      title: "Праздник",
      eventType: "family",
      eventDate: "2030-01-01",
      timezone: "UTC",
    },
  };
  expect(
    readEventForm(
      JSON.stringify({ userId: user, savedAt, fields, attempt }),
      user,
      savedAt,
    )?.attempt,
  ).toEqual(attempt);
  expect(
    readEventForm(
      JSON.stringify({
        userId: user,
        savedAt,
        fields,
        attempt: null,
        token: "not-a-form-field",
      }),
      user,
      savedAt,
    ),
  ).toBeNull();
  expect(
    readEventForm(
      JSON.stringify({
        userId: user,
        savedAt,
        fields,
        attempt: {
          ...attempt,
          payload: { ...attempt.payload, organizerId: other },
        },
      }),
      user,
      savedAt,
    ),
  ).toBeNull();
});
