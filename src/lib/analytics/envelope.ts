import { z } from "zod";
export const envelope = z.object({
  schema_version: z.literal("1.0"),
  analytics_event_id: z.uuid(),
  occurred_at: z.iso.datetime(),
  environment: z.enum(["local", "development", "staging", "production"]),
  app_version: z.string().regex(/^(?:[a-f\d]{7,40}|unknown)$/i),
  source: z.enum(["client", "server"]),
  platform: z.enum(["telegram", "web", "pwa", "server", "unknown"]),
  origin_platform: z.enum(["telegram", "web", "pwa", "unknown"]),
  participant_role: z.enum(["organizer", "guest", "anonymous", "system"]),
  is_authenticated: z.boolean(),
  traffic_class: z.enum(["external", "staff", "synthetic", "unknown"]),
  clock_skew: z.boolean().optional(),
});
