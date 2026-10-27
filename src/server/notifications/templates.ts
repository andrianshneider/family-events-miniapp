import type { z } from "zod";
import type { rsvpInput } from "@/lib/validation";
const statuses: Record<string, string> = {
  yes: "Буду",
  no: "Не буду",
  maybe: "Пока не знаю",
};
const positions: Record<string, string> = {
  yes: "будет",
  no: "не будет",
  maybe: "пока не знает, придёт ли",
};
const word = (n: number, forms: readonly string[]) =>
  forms[
    n % 100 >= 11 && n % 100 <= 14
      ? 2
      : n % 10 === 1
        ? 0
        : n % 10 >= 2 && n % 10 <= 4
          ? 1
          : 2
  ];
const people = (adults: number, kids: number) =>
  `${adults} ${word(adults, ["взрослый", "взрослых", "взрослых"])} · ${kids} ${word(kids, ["ребёнок", "ребёнка", "детей"])}`;
export function organizerRsvpMessage(
  title: string,
  next: z.infer<typeof rsvpInput>,
  old?: Record<string, unknown>,
) {
  if (!old)
    return `🎉 ${next.guestName} ${next.status === "maybe" ? "пока не знает, придёт ли на мероприятие" : positions[next.status] + " на мероприятии"}\n${title}${next.status === "no" ? "" : "\n" + people(next.adultsCount, next.childrenCount)}`;
  const lines = [`🔄 ${next.guestName} изменил(а) ответ`, title];
  if (old.status !== next.status)
    lines.push(
      `Было: ${statuses[String(old.status)]}`,
      `Теперь: ${statuses[next.status]}`,
    );
  else lines.push(`Ответ: ${statuses[next.status]}`);
  if (old.guest_name !== next.guestName)
    lines.push(`Имя: ${String(old.guest_name)} → ${next.guestName}`);
  if (
    old.adults_count !== next.adultsCount ||
    old.children_count !== next.childrenCount
  )
    lines.push(
      `Гости: ${people(Number(old.adults_count), Number(old.children_count))} → ${people(next.adultsCount, next.childrenCount)}`,
    );
  if (((old.comment as string | null) ?? null) !== next.comment)
    lines.push(
      next.comment ? `Комментарий: ${next.comment}` : "Комментарий удалён.",
    );
  return lines.join("\n");
}
