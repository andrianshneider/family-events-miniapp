import "server-only";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { setting } from "../config";
export const token = () => randomBytes(32).toString("base64url");
export const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest();
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function csrf(sessionToken: string) {
  return createHmac("sha256", setting("SESSION_SECRET"))
    .update("csrf:" + sessionToken)
    .digest("base64url");
}
export function encrypt(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(setting("AUTH_ENCRYPTION_KEY"), "base64"),
      iv,
    );
  return Buffer.concat([
    iv,
    cipher.update(value, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
}
export function decrypt(value: Buffer) {
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(setting("AUTH_ENCRYPTION_KEY"), "base64"),
    value.subarray(0, 12),
  );
  cipher.setAuthTag(value.subarray(-16));
  return Buffer.concat([
    cipher.update(value.subarray(12, -16)),
    cipher.final(),
  ]).toString("utf8");
}
