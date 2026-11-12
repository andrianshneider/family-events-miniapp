-- Technical Specification v1.0. Run once through the checksum migration runner.
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='fe_server') THEN CREATE ROLE fe_server NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='fe_worker') THEN CREATE ROLE fe_worker NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
END $$;
CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO fe_server,fe_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE app.users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), telegram_user_id bigint NOT NULL UNIQUE CHECK(telegram_user_id>0),
 display_name text NOT NULL CHECK(char_length(display_name) BETWEEN 1 AND 128), username text, avatar_url text,
 locale text NOT NULL DEFAULT 'ru', origin_event_id uuid, created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.organizer_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES app.users,token_hash bytea NOT NULL UNIQUE CHECK(octet_length(token_hash)=32),
 created_at timestamptz NOT NULL DEFAULT now(),last_seen_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,revoked_at timestamptz,
 CHECK(expires_at>created_at)
);
CREATE INDEX ON app.organizer_sessions(user_id,expires_at);
CREATE TABLE app.media_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_user_id uuid NOT NULL REFERENCES app.users,storage_path text NOT NULL UNIQUE,
 mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
 byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 10485760),width integer NOT NULL CHECK(width>0),height integer NOT NULL CHECK(height>0),
 state text NOT NULL CHECK(state IN ('pending','ready','deleted')),created_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,
 CHECK(width::bigint*height<=20000000), CHECK((state='deleted')=(deleted_at IS NOT NULL))
);
CREATE INDEX ON app.media_assets(owner_user_id);
CREATE INDEX ON app.media_assets(created_at) WHERE state='pending';
CREATE TABLE app.events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organizer_id uuid NOT NULL REFERENCES app.users,
 public_id text NOT NULL UNIQUE CHECK(public_id ~ '^[A-Za-z0-9_-]{22}$'),title text NOT NULL CHECK(char_length(trim(title)) BETWEEN 3 AND 80),
 event_type text NOT NULL CHECK(event_type IN ('birthday','kids_birthday','anniversary','party','family','other')),
 event_date date NOT NULL,start_time time,end_time time,timezone text NOT NULL,starts_at timestamptz,ends_at timestamptz,effective_at timestamptz NOT NULL,
 venue_name text CHECK(char_length(venue_name)<=200),address text CHECK(char_length(address)<=500),latitude numeric(9,6),longitude numeric(9,6),
 directions text CHECK(char_length(directions)<=500),description text CHECK(char_length(description)<=1000),dress_code text CHECK(char_length(dress_code)<=300),
 cover_asset_id uuid REFERENCES app.media_assets,version integer NOT NULL DEFAULT 1 CHECK(version>0),deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(end_time IS NULL OR (start_time IS NOT NULL AND end_time>start_time)),
 CHECK((latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)),
 CHECK((start_time IS NULL AND starts_at IS NULL AND ends_at IS NULL) OR (start_time IS NOT NULL AND starts_at IS NOT NULL)),
 CHECK((end_time IS NULL)=(ends_at IS NULL)),CHECK(ends_at IS NULL OR ends_at>starts_at)
);
ALTER TABLE app.users ADD CONSTRAINT users_origin_event_fk FOREIGN KEY(origin_event_id) REFERENCES app.events;
CREATE INDEX ON app.users(origin_event_id);
CREATE INDEX ON app.events(organizer_id,event_date) WHERE deleted_at IS NULL;
CREATE INDEX ON app.events(effective_at) WHERE deleted_at IS NULL;
CREATE INDEX ON app.events(cover_asset_id);
CREATE TABLE app.event_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES app.events,event_version integer NOT NULL CHECK(event_version>0),actor_user_id uuid NOT NULL REFERENCES app.users,
 changes jsonb NOT NULL CHECK(jsonb_typeof(changes)='object'),created_at timestamptz NOT NULL DEFAULT now(),
 notify_decision text NOT NULL DEFAULT 'pending' CHECK(notify_decision IN ('pending','send','skip')),decided_at timestamptz,
 UNIQUE(event_id,event_version),CHECK((notify_decision='pending')=(decided_at IS NULL))
);
CREATE INDEX ON app.event_changes(actor_user_id);
CREATE TABLE app.guest_identities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),linked_user_id uuid UNIQUE REFERENCES app.users,display_name text CHECK(char_length(display_name) BETWEEN 2 AND 60),
 origin_event_id uuid REFERENCES app.events,merged_into_id uuid REFERENCES app.guest_identities,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),CHECK(merged_into_id IS NULL OR merged_into_id<>id)
);
CREATE INDEX ON app.guest_identities(origin_event_id);
CREATE INDEX ON app.guest_identities(merged_into_id);
CREATE TABLE app.guest_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),guest_identity_id uuid NOT NULL REFERENCES app.guest_identities,token_hash bytea NOT NULL UNIQUE CHECK(octet_length(token_hash)=32),
 created_at timestamptz NOT NULL DEFAULT now(),last_seen_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,revoked_at timestamptz,CHECK(expires_at>created_at)
);
CREATE INDEX ON app.guest_sessions(guest_identity_id,expires_at);
CREATE TABLE app.auth_handoffs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token_hash bytea NOT NULL UNIQUE CHECK(octet_length(token_hash)=32),guest_identity_id uuid NOT NULL REFERENCES app.guest_identities,
 event_id uuid NOT NULL REFERENCES app.events,expires_at timestamptz NOT NULL,consumed_at timestamptz,confirmed_user_id uuid REFERENCES app.users,
 created_at timestamptz NOT NULL DEFAULT now(),CHECK(expires_at>created_at)
);
CREATE INDEX ON app.auth_handoffs(guest_identity_id);
CREATE INDEX ON app.auth_handoffs(event_id);
CREATE INDEX ON app.auth_handoffs(confirmed_user_id);
CREATE INDEX ON app.auth_handoffs(expires_at);
CREATE TABLE app.auth_transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),state_hash bytea NOT NULL UNIQUE CHECK(octet_length(state_hash)=32),nonce_hash bytea NOT NULL CHECK(octet_length(nonce_hash)=32),
 pkce_verifier_ciphertext bytea NOT NULL,guest_session_id uuid REFERENCES app.guest_sessions,return_path text NOT NULL,
 expires_at timestamptz NOT NULL,consumed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),CHECK(expires_at>created_at)
);
CREATE INDEX ON app.auth_transactions(guest_session_id);
CREATE INDEX ON app.auth_transactions(expires_at);
CREATE TABLE app.rsvps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES app.events,guest_identity_id uuid NOT NULL REFERENCES app.guest_identities,
 guest_name text NOT NULL CHECK(char_length(trim(guest_name)) BETWEEN 2 AND 60),status text NOT NULL CHECK(status IN ('yes','no','maybe')),
 adults_count smallint NOT NULL,children_count smallint NOT NULL,comment text CHECK(char_length(comment)<=300),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(event_id,guest_identity_id),
 CHECK((status='no' AND adults_count=0 AND children_count=0) OR (status IN ('yes','maybe') AND adults_count BETWEEN 1 AND 20 AND children_count BETWEEN 0 AND 20))
);
CREATE INDEX ON app.rsvps(event_id,status);
CREATE INDEX ON app.rsvps(guest_identity_id,event_id);
CREATE TABLE app.wishlists (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL UNIQUE REFERENCES app.events,hide_reserver_identity boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.gifts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),wishlist_id uuid NOT NULL REFERENCES app.wishlists,title text NOT NULL CHECK(char_length(trim(title)) BETWEEN 2 AND 120),
 external_url text,amount numeric(12,2),currency char(3),comment text CHECK(char_length(comment)<=300),image_asset_id uuid REFERENCES app.media_assets,
 sort_order integer NOT NULL DEFAULT 0,version integer NOT NULL DEFAULT 1 CHECK(version>0),deleted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((amount IS NULL AND currency IS NULL) OR (amount IS NOT NULL AND currency IS NOT NULL AND amount>0 AND currency IN ('RUB','EUR','USD')))
);
CREATE INDEX ON app.gifts(wishlist_id,sort_order,created_at) WHERE deleted_at IS NULL;
CREATE INDEX ON app.gifts(image_asset_id);
CREATE TABLE app.gift_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),gift_id uuid NOT NULL REFERENCES app.gifts,guest_identity_id uuid NOT NULL REFERENCES app.guest_identities,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),reserved_at timestamptz NOT NULL DEFAULT now(),cancelled_at timestamptz,
 cancel_reason text CHECK(cancel_reason IN ('guest_cancelled','gift_deleted','event_deleted','identity_merge')),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 CHECK((status='active' AND cancelled_at IS NULL AND cancel_reason IS NULL) OR (status='cancelled' AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL))
);
CREATE UNIQUE INDEX uq_gift_active_reservation ON app.gift_reservations(gift_id) WHERE status='active';
CREATE INDEX ON app.gift_reservations(guest_identity_id,reserved_at) WHERE status='active';
CREATE TABLE app.telegram_channels (
 user_id uuid PRIMARY KEY REFERENCES app.users,chat_id bigint NOT NULL UNIQUE,permission_granted_at timestamptz,
 permission_source text CHECK(permission_source IN ('mini_app','oidc','bot_start')),delivery_state text NOT NULL DEFAULT 'unknown' CHECK(delivery_state IN ('unknown','ready','blocked')),
 last_verified_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.notification_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES app.events,user_id uuid NOT NULL REFERENCES app.users,
 role text NOT NULL CHECK(role IN ('organizer','guest')),guest_identity_id uuid REFERENCES app.guest_identities,enabled boolean NOT NULL DEFAULT false,
 consented_at timestamptz,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(event_id,user_id,role),
 CHECK((role='organizer' AND guest_identity_id IS NULL) OR (role='guest' AND guest_identity_id IS NOT NULL)),CHECK(NOT enabled OR (consented_at IS NOT NULL AND revoked_at IS NULL))
);
CREATE INDEX ON app.notification_subscriptions(user_id);
CREATE INDEX ON app.notification_subscriptions(guest_identity_id);
CREATE TABLE app.notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),subscription_id uuid NOT NULL REFERENCES app.notification_subscriptions,
 type text NOT NULL CHECK(type IN ('rsvp_new','rsvp_changed','event_changed','reminder_24h')),trigger_key text NOT NULL,payload jsonb NOT NULL,
 scheduled_at timestamptz NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),next_attempt_at timestamptz NOT NULL,locked_until timestamptz,sent_at timestamptz,
 provider_message_id bigint,last_error_code text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(subscription_id,type,trigger_key)
);
CREATE INDEX ON app.notifications(next_attempt_at,scheduled_at) WHERE status='pending';
CREATE INDEX ON app.notifications(locked_until) WHERE status='processing';
CREATE TABLE app.analytics_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL CHECK(name IN ('user_authenticated','event_creation_started','event_created','event_edited','event_shared','event_opened','rsvp_started','rsvp_submitted','rsvp_changed','wishlist_opened','gift_created','gift_reserved','gift_unreserved','notification_opt_in_started','notification_opt_in_completed','guest_became_organizer')),
 event_id uuid REFERENCES app.events,guest_identity_id uuid REFERENCES app.guest_identities,user_id uuid REFERENCES app.users,anonymous_visitor_id uuid,client_event_id uuid UNIQUE,
 properties jsonb NOT NULL DEFAULT '{}',occurred_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.analytics_events(name,occurred_at);
CREATE INDEX ON app.analytics_events(event_id,occurred_at);
CREATE INDEX ON app.analytics_events(guest_identity_id);
CREATE INDEX ON app.analytics_events(user_id);
CREATE TABLE app.api_idempotency (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),principal_key text NOT NULL,route text NOT NULL,key text NOT NULL,request_hash bytea NOT NULL CHECK(octet_length(request_hash)=32),
 response_status integer,response_body jsonb,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(principal_key,route,key)
);
CREATE INDEX ON app.api_idempotency(expires_at);
-- Operational tables. The raw Telegram payload is encrypted; never logged.
CREATE TABLE app.telegram_updates (
 bot_id bigint NOT NULL,update_id bigint NOT NULL,payload_ciphertext bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','processed','failed')),attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),locked_until timestamptz,
 PRIMARY KEY(bot_id,update_id)
);
CREATE TABLE app.rate_limits (
 key_hash bytea NOT NULL CHECK(octet_length(key_hash)=32),window_start timestamptz NOT NULL,hits integer NOT NULL CHECK(hits>0),PRIMARY KEY(key_hash,window_start)
);
CREATE FUNCTION app.touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$ BEGIN NEW.updated_at=now();RETURN NEW;END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['users','events','guest_identities','rsvps','wishlists','gifts','telegram_channels','notification_subscriptions'] LOOP
  EXECUTE format('CREATE TRIGGER touch_updated_at BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()',t);
 END LOOP;
END $$;
CREATE FUNCTION app.guard_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$ BEGIN
 IF TG_OP='UPDATE' AND (NEW.public_id<>OLD.public_id OR NEW.organizer_id<>OLD.organizer_id) THEN RAISE EXCEPTION 'immutable event identity' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=NEW.timezone) THEN RAISE EXCEPTION 'invalid timezone' USING ERRCODE='23514'; END IF;
 IF NEW.cover_asset_id IS NOT NULL THEN
  PERFORM id FROM app.media_assets WHERE id=NEW.cover_asset_id AND owner_user_id=NEW.organizer_id AND state='ready' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid cover asset' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_event BEFORE INSERT OR UPDATE ON app.events FOR EACH ROW EXECUTE FUNCTION app.guard_event();
CREATE FUNCTION app.guard_gift() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$ DECLARE owner_id uuid; BEGIN
 SELECT e.organizer_id INTO owner_id FROM app.wishlists w JOIN app.events e ON e.id=w.event_id WHERE w.id=NEW.wishlist_id;
 IF NEW.image_asset_id IS NOT NULL THEN
  PERFORM id FROM app.media_assets WHERE id=NEW.image_asset_id AND owner_user_id=owner_id AND state='ready' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid gift asset' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_gift BEFORE INSERT OR UPDATE ON app.gifts FOR EACH ROW EXECUTE FUNCTION app.guard_gift();
CREATE FUNCTION app.guard_subscription() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$ BEGIN
 IF NEW.role='organizer' AND NOT EXISTS(SELECT FROM app.events WHERE id=NEW.event_id AND organizer_id=NEW.user_id) THEN RAISE EXCEPTION 'invalid organizer subscription' USING ERRCODE='23514'; END IF;
 IF NEW.role='guest' AND NOT EXISTS(SELECT FROM app.guest_identities WHERE id=NEW.guest_identity_id AND linked_user_id=NEW.user_id AND merged_into_id IS NULL) THEN RAISE EXCEPTION 'invalid guest subscription' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_subscription BEFORE INSERT OR UPDATE ON app.notification_subscriptions FOR EACH ROW EXECUTE FUNCTION app.guard_subscription();
-- No anon/authenticated policies. Server is a trusted BFF role, never given to a browser.
DO $$ DECLARE t record;r text; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='app' LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t.tablename);
  EXECUTE format('CREATE POLICY server_access ON app.%I TO fe_server USING(true) WITH CHECK(true)',t.tablename);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO fe_server',t.tablename);
 END LOOP;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON SCHEMA app FROM %I',r);
   EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA app FROM %I',r);
   EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM %I',r);
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.touch_updated_at(),app.guard_event(),app.guard_gift(),app.guard_subscription() TO fe_server;
