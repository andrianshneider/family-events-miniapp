import { expect, it } from "vitest";
import { parseProduct, productPrice } from "@/server/product/metadata";
import { publicAddress, productUrl } from "@/server/product/safe-fetch";
const parse = (html: string) =>
  parseProduct(Buffer.from(html), "https://shop.example/product");
it("reads a Product inside @graph, selects its offer, decodes entities and resolves images", () => {
  const p = parse(
    `<script type="application/ld+json">broken</script><script type="application/ld+json">{"@graph":[{"@type":"BreadcrumbList","name":"Wrong"},{"@type":"Product","name":"Phone","offers":{"price":"206890.00","priceCurrency":"RUB"},"image":{"url":"/photo.webp"}}]}</script><meta property="og:title" content="Wrong">`,
  );
  expect(p).toEqual({
    title: "Phone",
    amount: "206890.00",
    currency: "RUB",
    imageUrl: "https://shop.example/photo.webp",
  });
});
it("supports microdata and OpenGraph without scraping unrelated recommendations or scripts", () => {
  expect(
    parse(
      `<span itemprop="name">Breadcrumb</span><div itemscope itemtype="https://schema.org/Product"><h1 itemprop="name">Gift &amp; friends</h1><meta itemprop="price" content="1 299,50"><meta itemprop="priceCurrency" content="EUR"></div><meta property="og:image" content="../photo.png">`,
    ),
  ).toEqual({
    title: "Gift & friends",
    amount: "1299.50",
    currency: "EUR",
    imageUrl: "https://shop.example/photo.png",
  });
  expect(
    parse(
      `<meta property="og:title" content="A &amp; B"><meta property="product:price:amount" content="12.50"><meta property="product:price:currency" content="USD">`,
    ).amount,
  ).toBe("12.50");
});
it("preserves missing values, rejects unsupported currencies, image schemes and ambiguous ranges", () => {
  const p = parse(
    `<h1>Gift</h1><script type="application/ld+json">{"@type":"Product","offers":{"lowPrice":"10","highPrice":"100","priceCurrency":"GBP"},"image":"file:///etc/passwd"}</script>`,
  );
  expect(p.amount).toBeNull();
  expect(p.currency).toBeNull();
  expect(p.imageUrl).toBeNull();
  expect(parse("<p>No product</p>").title).toBeNull();
  expect(productPrice("0")).toBeNull();
  expect(productPrice("12–24")).toBeNull();
  expect(productPrice("1,234.56")).toBe("1234.56");
  expect(productPrice("1.234,56")).toBe("1234.56");
});
it.each([
  "127.0.0.1",
  "10.2.3.4",
  "172.16.0.1",
  "192.168.1.1",
  "169.254.169.254",
  "100.64.0.1",
  "0.0.0.0",
  "224.0.0.1",
  "::1",
  "::",
  "fc00::1",
  "fe80::1",
  "::ffff:127.0.0.1",
  "2001:db8::1",
])("blocks non-public address %s", (address) =>
  expect(publicAddress(address)).toBe(false),
);
it.each([
  "file:///etc/passwd",
  "https://u:p@shop.example",
  "http://127.1",
  "http://2130706433",
  "http://[::ffff:127.0.0.1]",
  "http://localhost",
  "http://service.internal",
  "https://shop.example:8080",
])("rejects unsafe product URL %s", (url) =>
  expect(() => productUrl(url)).toThrow(),
);
it("allows ordinary public HTTP/HTTPS without credentials", () => {
  expect(publicAddress("8.8.8.8")).toBe(true);
  expect(productUrl("https://shop.example/item#section").href).toBe(
    "https://shop.example/item",
  );
});
