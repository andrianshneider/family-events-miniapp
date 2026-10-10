import { z } from "zod";
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();
export const httpUrl = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (
        ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
      );
    } catch {
      return false;
    }
  }, "Требуется HTTP/HTTPS URL");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const eventInput = z
  .object({
    title: z.string().trim().min(3).max(80),
    eventType: z.enum([
      "birthday",
      "kids_birthday",
      "anniversary",
      "party",
      "family",
      "other",
    ]),
    eventDate: z.iso.date(),
    startTime: time.nullable().optional(),
    endTime: time.nullable().optional(),
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return v.includes("/") || v === "UTC";
      } catch {
        return false;
      }
    }),
    venueName: optionalText(200),
    address: optionalText(500),
    directions: optionalText(500),
    description: optionalText(1000),
    dressCode: optionalText(300),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    coverAssetId: z.uuid().nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.endTime && (!v.startTime || v.endTime <= v.startTime))
      ctx.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "Окончание должно быть позже начала.",
      });
    if ((v.latitude == null) !== (v.longitude == null))
      ctx.addIssue({
        code: "custom",
        path: ["latitude"],
        message: "Нужны обе координаты.",
      });
  });
export const rsvpInput = z
  .object({
    guestName: z.string().trim().min(2).max(60),
    status: z.enum(["yes", "no", "maybe"]),
    adultsCount: z.number().int(),
    childrenCount: z.number().int(),
    comment: optionalText(300),
    expectedVersion: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.status === "no"
        ? v.adultsCount !== 0 || v.childrenCount !== 0
        : v.adultsCount < 1 ||
          v.adultsCount > 20 ||
          v.childrenCount < 0 ||
          v.childrenCount > 20
    )
      ctx.addIssue({
        code: "custom",
        path: ["adultsCount"],
        message: "Некорректное количество гостей.",
      });
  });
export const giftInput = z
  .object({
    title: z.string().trim().min(2).max(120),
    externalUrl: httpUrl.nullable().optional(),
    amount: z
      .string()
      .regex(/^\d{1,10}(\.\d{1,2})?$/)
      .refine((v) => Number(v) > 0)
      .nullable()
      .optional(),
    currency: z.enum(["RUB", "EUR", "USD"]).nullable().optional(),
    comment: optionalText(300),
    imageAssetId: z.uuid().nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.amount == null) !== (v.currency == null))
      ctx.addIssue({
        code: "custom",
        path: ["currency"],
        message: "Укажите цену и валюту вместе.",
      });
  });
export const expectedVersionInput = z.object({
  expectedVersion: z.number().int().positive(),
});
export const mediaInput = z
  .object({
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    byteSize: z.number().int().min(1).max(10485760),
  })
  .strict();
