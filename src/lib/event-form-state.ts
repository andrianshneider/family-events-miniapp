import { z } from "zod";
import { eventInput } from "./validation";
export const emptyEventFields = {
  title: "",
  eventType: "",
  eventDate: "",
  startTime: "",
  endTime: "",
  timezone: "UTC",
  venueName: "",
  address: "",
  directions: "",
  description: "",
  dressCode: "",
  coverAssetId: "",
};
export type EventFields = typeof emptyEventFields;
export type CreateAttempt = {
  key: string;
  payload: z.infer<typeof eventInput>;
};
const snapshot = z
  .object({
    userId: z.uuid(),
    savedAt: z.number().finite(),
    fields: z
      .object({
        title: z.string().max(80),
        eventType: z.string().max(32),
        eventDate: z.string().max(32),
        startTime: z.string().max(16),
        endTime: z.string().max(16),
        timezone: z.string().max(100),
        venueName: z.string().max(200),
        address: z.string().max(500),
        directions: z.string().max(500),
        description: z.string().max(1000),
        dressCode: z.string().max(300),
        coverAssetId: z.union([z.literal(""), z.uuid()]),
      })
      .strict(),
    attempt: z
      .object({ key: z.string().regex(/^[\w-]{16,128}$/), payload: eventInput })
      .strict()
      .nullable(),
  })
  .strict();
// This is a temporary form, not an auth credential or a cached private API response.
export function readEventForm(
  raw: string | null,
  userId: string,
  now = Date.now(),
) {
  if (!raw || raw.length > 20000) return null;
  try {
    const saved = snapshot.safeParse(JSON.parse(raw));
    if (
      !saved.success ||
      saved.data.userId !== userId ||
      now < saved.data.savedAt ||
      now - saved.data.savedAt >= 3600000
    )
      return null;
    return { fields: saved.data.fields, attempt: saved.data.attempt };
  } catch {
    return null;
  }
}
