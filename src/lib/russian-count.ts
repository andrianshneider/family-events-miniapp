export function russianCount(
  value: number,
  forms: readonly [string, string, string],
) {
  const form = new Intl.PluralRules("ru").select(value);
  return `${value} ${forms[form === "one" ? 0 : form === "few" ? 1 : 2]}`;
}
export const adultsCount = (n: number) =>
  russianCount(n, ["взрослый", "взрослых", "взрослых"]);
export const childrenCount = (n: number) =>
  russianCount(n, ["ребёнок", "ребёнка", "детей"]);
export const peopleCount = (n: number) =>
  russianCount(n, ["человек", "человека", "человек"]);
export const responsesCount = (n: number) =>
  russianCount(n, ["ответ", "ответа", "ответов"]);
