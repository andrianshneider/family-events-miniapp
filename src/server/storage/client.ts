import "server-only";
import { createClient } from "@supabase/supabase-js";
import { setting } from "../config";
export function storage() {
  return createClient(
    setting("SUPABASE_URL"),
    setting("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  ).storage;
}
export const mediaBucket = () =>
  process.env.SUPABASE_MEDIA_BUCKET ?? "event-media";
