import { z } from "zod";
export const reserveInput = z
  .object({
    guestName: z
      .string()
      .trim()
      .refine(
        (v) => [...v].length >= 2 && [...v].length <= 60,
        "Введите имя от 2 до 60 символов.",
      )
      .optional(),
  })
  .strict();
// The target is a specific reservation, preventing a delayed old cancel from removing a new choice.
export const cancelInput = z.object({ reservationId: z.uuid() }).strict();
