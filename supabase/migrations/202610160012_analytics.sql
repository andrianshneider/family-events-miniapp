-- Existing incomplete rows remain legacy/excluded; no invented historical attribution.
ALTER TABLE app.analytics_events DROP CONSTRAINT analytics_events_name_check;
ALTER TABLE app.analytics_events ADD CONSTRAINT analytics_events_name_check CHECK(name IN ('app_entered','user_authenticated','event_creation_started','event_created','event_viewed','share_initiated','share_result','invitation_link_copied','rsvp_started','rsvp_submitted','wishlist_viewed','gift_reserved','operation_failed','$identify','event_edited','event_shared','event_opened','rsvp_changed','wishlist_opened','gift_created','gift_unreserved','notification_opt_in_started','notification_opt_in_completed','guest_became_organizer'));
ALTER TABLE app.users ADD COLUMN analytics_denied_at timestamptz;
ALTER TABLE app.users ADD COLUMN origin_first_seen_at timestamptz;
ALTER TABLE app.guest_identities ADD COLUMN origin_first_seen_at timestamptz;
CREATE TABLE app.analytics_visitors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),consent_group uuid NOT NULL DEFAULT gen_random_uuid(),had_organizer_session boolean NOT NULL DEFAULT false,token_hash bytea NOT NULL UNIQUE CHECK(octet_length(token_hash)=32),
 traffic_class text NOT NULL DEFAULT 'unknown' CHECK(traffic_class IN('external','staff','synthetic','unknown')),
 last_platform text NOT NULL DEFAULT 'unknown' CHECK(last_platform IN('telegram','web','pwa','unknown')),
 consent boolean NOT NULL DEFAULT false,consented_at timestamptz,revoked_at timestamptz,
 user_id uuid REFERENCES app.users,guest_identity_id uuid REFERENCES app.guest_identities,
 origin_event_id uuid REFERENCES app.events,origin_first_seen_at timestamptz,
 suppress_guest_identification boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT consent OR (consented_at IS NOT NULL AND revoked_at IS NULL))
);
ALTER TABLE app.analytics_visitors ENABLE ROW LEVEL SECURITY;
CREATE POLICY server_access ON app.analytics_visitors TO fe_server USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE,DELETE ON app.analytics_visitors TO fe_server;
REVOKE ALL ON app.analytics_visitors FROM anon,authenticated,fe_worker;
ALTER TABLE app.analytics_events ADD COLUMN visitor_id uuid REFERENCES app.analytics_visitors;
ALTER TABLE app.analytics_events ADD COLUMN distinct_id uuid;
ALTER TABLE app.analytics_events ADD COLUMN schema_version text;
ALTER TABLE app.analytics_events ADD COLUMN delivery_status text NOT NULL DEFAULT 'legacy' CHECK(delivery_status IN ('legacy','pending','processing','sent','suppressed','failed'));
ALTER TABLE app.analytics_events ADD COLUMN attempts integer NOT NULL DEFAULT 0;
ALTER TABLE app.analytics_events ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE app.analytics_events ADD COLUMN locked_until timestamptz;
ALTER TABLE app.analytics_events ADD COLUMN lease_id uuid;
ALTER TABLE app.analytics_events ADD COLUMN sent_at timestamptz;
ALTER TABLE app.analytics_events ADD COLUMN last_error_code text;
CREATE INDEX analytics_delivery ON app.analytics_events(next_attempt_at) WHERE delivery_status IN ('pending','processing');
-- Classifications are explicit internal registry entries, never inferred from user names.
CREATE TABLE app.analytics_traffic (
 user_id uuid PRIMARY KEY REFERENCES app.users,classification text NOT NULL CHECK(classification IN ('external','staff','synthetic','unknown'))
);
ALTER TABLE app.analytics_traffic ENABLE ROW LEVEL SECURITY;
CREATE POLICY server_access ON app.analytics_traffic TO fe_server USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE,DELETE ON app.analytics_traffic TO fe_server;
REVOKE ALL ON app.analytics_traffic FROM anon,authenticated,fe_worker;
