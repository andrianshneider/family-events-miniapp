import "server-only";
import { loadBuffer } from "cheerio";
import { productUrl } from "./safe-fetch";
type RecordValue = Record<string, unknown>;
const record = (v: unknown): RecordValue =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as RecordValue) : {};
const text = (v: unknown) =>
  typeof v === "string"
    ? v
        .replace(/[\u0000-\u001f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
export function productPrice(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  let s = String(value).replace(/[\s\u00a0\u202f]/g, "");
  if (s.includes(",") && s.includes("."))
    s =
      s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
  else if (s.includes(","))
    s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s) || !/[1-9]/.test(s)) return null;
  return s;
}
export function parseProduct(bytes: Buffer, baseUrl: string) {
  const $ = loadBuffer(bytes);
  const meta = (name: string) =>
    text(
      $("meta")
        .filter(
          (_, e) =>
            $(e).attr("property") === name || $(e).attr("name") === name,
        )
        .first()
        .attr("content"),
    );
  const products: RecordValue[] = [];
  let visited = 0;
  function walk(value: unknown, depth = 0) {
    if (++visited > 2500 || depth > 12) return;
    if (Array.isArray(value)) {
      value.forEach((v) => walk(v, depth + 1));
      return;
    }
    const obj = record(value);
    const types = Array.isArray(obj["@type"]) ? obj["@type"] : [obj["@type"]];
    if (
      types.some((t) => typeof t === "string" && /(?:^|[/#])Product$/.test(t))
    )
      products.push(obj);
    for (const [key, v] of Object.entries(obj))
      if (key !== "offers" && key !== "image") walk(v, depth + 1);
  }
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      walk(JSON.parse($(el).text()));
    } catch {
      /* A broken block must not hide other metadata. */
    }
  });
  const product = products[0] ?? {};
  const scope = $('[itemscope][itemtype$="/Product"]').first();
  const item = (name: string) => {
    const el = scope.find(`[itemprop="${name}"]`).first();
    return text(
      el.attr("content") ?? el.attr("src") ?? el.attr("href") ?? el.text(),
    );
  };
  const title = [
    text(product.name),
    item("name"),
    text($("h1").first().text()),
    meta("og:title"),
    text($("title").text()),
  ].find(Boolean);
  const offer = record(
    Array.isArray(product.offers) ? product.offers[0] : product.offers,
  );
  const priceSpec = record(offer.priceSpecification);
  const rawCurrency =
    text(offer.priceCurrency ?? priceSpec.priceCurrency) ||
    item("priceCurrency") ||
    meta("product:price:currency") ||
    meta("og:price:currency");
  const amount = productPrice(
    offer.price ??
      priceSpec.price ??
      (item("price") ||
        meta("product:price:amount") ||
        meta("og:price:amount")),
  );
  const currency = ["RUB", "EUR", "USD"].includes(rawCurrency.toUpperCase())
    ? (rawCurrency.toUpperCase() as "RUB" | "EUR" | "USD")
    : null;
  const rawImage = Array.isArray(product.image)
    ? product.image[0]
    : product.image;
  const image =
    text(
      typeof rawImage === "object"
        ? (record(rawImage).url ?? record(rawImage).contentUrl)
        : rawImage,
    ) ||
    item("image") ||
    meta("og:image") ||
    meta("twitter:image");
  let imageUrl: string | null = null;
  try {
    if (image) imageUrl = productUrl(new URL(image, baseUrl).href).href;
  } catch {
    /* Never return an unsafe image URL. */
  }
  return {
    title: title ? [...title].slice(0, 120).join("") : null,
    amount: currency ? amount : null,
    currency: amount ? currency : null,
    imageUrl,
  };
}
