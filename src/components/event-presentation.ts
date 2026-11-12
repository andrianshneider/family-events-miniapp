export const eventTypes = {
  birthday: "День рождения",
  kids_birthday: "Детский день рождения",
  anniversary: "Юбилей",
  party: "Вечеринка",
  family: "Семейное событие",
  other: "Другое",
} as const;
export function eventDateLabel(date: string) {
  const instant = new Date(date + "T12:00:00Z");
  if (Number.isNaN(instant.getTime())) return "Проверьте дату";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(instant);
}
