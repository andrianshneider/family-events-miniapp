import "server-only";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import ipaddr from "ipaddr.js";

export function publicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export function productUrl(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    value.length > 2048 ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw Error("Unsafe URL");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    ipaddr.isValid(host)
      ? !publicAddress(host)
      : !host.includes(".") ||
        /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
  )
    throw Error("Unsafe host");
  url.hash = "";
  return url;
}
async function resolvePublic(host: string, timeout: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = await Promise.race([
      lookup(host.replace(/^\[|\]$/g, ""), { all: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("DNS timeout")), timeout);
      }),
    ]);
    if (!records.length || records.some((r) => !publicAddress(r.address)))
      throw Error("Unsafe address");
    return records.find((r) => r.family === 4) ?? records[0];
  } finally {
    clearTimeout(timer);
  }
}
/** No cookies, redirects validated independently, DNS pinned to the checked address. */
export async function fetchProductResource(
  value: string,
  kind: "html" | "image",
  deadline = Date.now() + 18000,
) {
  let url = productUrl(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const remaining = () => Math.max(1, Math.min(6000, deadline - Date.now()));
    if (Date.now() >= deadline) throw Error("Timeout");
    const address = await resolvePublic(url.hostname, remaining());
    if (Date.now() >= deadline) throw Error("Timeout");
    const result = await new Promise<{
      redirect?: string;
      bytes: Buffer;
      type: string;
    }>((resolve, reject) => {
      const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        url,
        {
          agent: false,
          headers: {
            "User-Agent": "FamilyEvents/1.0 (product preview)",
            Accept:
              kind === "html"
                ? "text/html,application/xhtml+xml"
                : "image/jpeg,image/png,image/webp",
            "Accept-Encoding": "identity",
          },
          lookup: (_hostname, options, callback) => {
            if (options.all) callback(null, [address]);
            else callback(null, address.address, address.family);
          },
        },
        (res) => {
          const type = String(res.headers["content-type"] ?? "")
            .split(";")[0]
            .toLowerCase();
          if (
            [301, 302, 303, 307, 308].includes(res.statusCode ?? 0) &&
            res.headers.location
          ) {
            res.destroy();
            resolve({
              redirect: res.headers.location,
              bytes: Buffer.alloc(0),
              type,
            });
            return;
          }
          const max = kind === "html" ? 2 * 1024 * 1024 : 8 * 1024 * 1024;
          const allowed =
            kind === "html"
              ? ["text/html", "application/xhtml+xml"]
              : ["image/jpeg", "image/png", "image/webp"];
          if (
            res.statusCode !== 200 ||
            !allowed.includes(type) ||
            (res.headers["content-encoding"] &&
              res.headers["content-encoding"] !== "identity") ||
            Number(res.headers["content-length"] ?? 0) > max
          ) {
            res.destroy();
            reject(Error("Unsupported response"));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > max) {
              res.destroy();
              reject(Error("Response too large"));
            } else chunks.push(chunk);
          });
          res.on("end", () => resolve({ bytes: Buffer.concat(chunks), type }));
          res.on("error", reject);
          res.on("aborted", () => reject(Error("Response interrupted")));
        },
      );
      const timer = setTimeout(
        () => req.destroy(Error("Timeout")),
        remaining(),
      );
      req.on("close", () => clearTimeout(timer));
      req.on("error", reject);
      req.end();
    });
    if (!result.redirect) return { ...result, url: url.href };
    url = productUrl(new URL(result.redirect, url).href);
  }
  throw Error("Too many redirects");
}
