import { z } from "zod";
const uuid = z.uuid();
export const platform = z.enum(["telegram", "web", "pwa", "unknown"]);
export const relation = z.enum(["known_owner", "known_non_owner", "unknown"]);
const entry = z.enum([
  "direct",
  "my_events",
  "event",
  "share",
  "wishlist",
  "notification_settings",
  "unknown",
]);
export const operations = z.enum([
  "authentication",
  "event_create",
  "event_view",
  "invitation_copy",
  "rsvp_save",
  "wishlist_view",
  "gift_reserve",
]);
export const errorCode = z.enum([
  "VALIDATION_ERROR",
  "GIFT_ALREADY_RESERVED",
  "RSVP_VERSION_CONFLICT",
  "UNAUTHENTICATED",
  "EVENT_UNAVAILABLE",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "TIMEOUT",
  "NETWORK_ERROR",
  "COPY_FAILED",
  "UNKNOWN",
]);
export const specs = {
  app_entered: z.object({ entry_point: entry }),
  user_authenticated: z.object({
    auth_method: z.enum(["telegram_mini_app", "telegram_oidc"]),
    is_new_user: z.boolean().optional(),
  }),
  event_creation_started: z.object({ form_instance_id: uuid }),
  event_created: z.object({
    event_id: uuid,
    event_type: z.enum([
      "birthday",
      "kids_birthday",
      "anniversary",
      "party",
      "family",
      "other",
    ]),
    has_cover: z.boolean(),
    has_location: z.boolean(),
    origin_event_id: uuid.optional(),
    origin_first_seen_at: z.iso.datetime().optional(),
    form_instance_id: uuid.optional(),
    attempt_id: uuid.optional(),
  }),
  event_viewed: z.object({
    event_id: uuid,
    view_mode: z.enum(["public", "management"]),
    actor_relation: relation,
    navigation_id: uuid,
  }),
  share_initiated: z.object({
    event_id: uuid,
    share_channel: z.enum(["native", "telegram"]),
    attempt_id: uuid,
  }),
  share_result: z.object({
    event_id: uuid,
    share_channel: z.enum(["native", "telegram"]),
    attempt_id: uuid,
    outcome: z.enum(["ready", "cancelled", "unsupported", "failed"]),
    error_code: errorCode.optional(),
  }),
  invitation_link_copied: z.object({
    event_id: uuid,
    share_channel: z.literal("copy"),
    attempt_id: uuid,
  }),
  rsvp_started: z.object({
    event_id: uuid,
    mode: z.enum(["create", "edit"]),
    form_instance_id: uuid,
    initial_status: z.enum(["yes", "no", "maybe"]).optional(),
  }),
  rsvp_submitted: z.object({
    event_id: uuid,
    rsvp_id: uuid,
    rsvp_version: z.number().int().positive(),
    status: z.enum(["yes", "no", "maybe"]),
    actor_relation: relation,
    attempt_id: uuid.optional(),
  }),
  wishlist_viewed: z.object({
    event_id: uuid,
    surface: z.enum(["preview", "full", "management"]),
    is_empty: z.boolean(),
    navigation_id: uuid,
  }),
  gift_reserved: z.object({
    event_id: uuid,
    gift_id: uuid,
    reservation_id: uuid,
    actor_relation: relation,
    attempt_id: uuid.optional(),
  }),
  operation_failed: z.object({
    operation: operations,
    attempt_id: uuid,
    error_code: errorCode,
    outcome: z.enum(["failed", "unknown"]),
    event_id: uuid.optional(),
    http_status: z.number().int().min(400).max(599).optional(),
    request_id: uuid.optional(),
  }),
};
export type EventName = keyof typeof specs;
export type Properties<N extends EventName> = z.infer<(typeof specs)[N]>;
export const clientNames = [
  "app_entered",
  "event_creation_started",
  "event_viewed",
  "share_initiated",
  "share_result",
  "invitation_link_copied",
  "rsvp_started",
  "wishlist_viewed",
  "operation_failed",
] as const;
export const clientInput = z
  .object({
    name: z.enum(clientNames),
    id: uuid,
    occurredAt: z.iso.datetime(),
    platform,
    locator: z
      .discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("public"),
            id: z.string().regex(/^[\w-]{22}$/),
          })
          .strict(),
        z.object({ kind: z.literal("management"), id: uuid }).strict(),
      ])
      .optional(),
    properties: z.record(z.string(), z.unknown()),
  })
  .strict();
export function properties<N extends EventName>(
  name: N,
  value: unknown,
): Properties<N> {
  return specs[name].strict().parse(value) as Properties<N>;
}
