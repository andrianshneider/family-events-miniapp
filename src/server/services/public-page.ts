import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { limit } from "../auth/rate-limit";
import { setting } from "../config";
import { publicEvent, validPublicId } from "./public-events";
// Metadata and page share a request-local read and rate-limit hit, never a shared Event cache.
export const publicPageEvent = cache(async (publicId: string) => {
  validPublicId(publicId);
  await limit(
    new Request(setting("APP_URL"), { headers: await headers() }),
    "public",
    Number(process.env.PUBLIC_READ_RATE_LIMIT ?? 120),
  );
  return publicEvent(publicId);
});
