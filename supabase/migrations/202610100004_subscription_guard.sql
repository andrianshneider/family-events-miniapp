-- Enabling delivery requires both explicit consent (CHECK) and a verified ready channel.
CREATE OR REPLACE FUNCTION app.guard_subscription() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$ BEGIN
 IF NEW.role='organizer' AND NOT EXISTS(SELECT FROM app.events WHERE id=NEW.event_id AND organizer_id=NEW.user_id) THEN RAISE EXCEPTION 'invalid organizer subscription' USING ERRCODE='23514'; END IF;
 IF NEW.role='guest' AND NOT EXISTS(SELECT FROM app.guest_identities WHERE id=NEW.guest_identity_id AND linked_user_id=NEW.user_id AND merged_into_id IS NULL) THEN RAISE EXCEPTION 'invalid guest subscription' USING ERRCODE='23514'; END IF;
 IF NEW.enabled THEN
  IF NOT EXISTS(SELECT FROM app.events WHERE id=NEW.event_id AND deleted_at IS NULL) OR NOT EXISTS(SELECT FROM app.telegram_channels WHERE user_id=NEW.user_id AND delivery_state='ready' AND permission_granted_at IS NOT NULL) THEN RAISE EXCEPTION 'notification channel not ready' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION app.guard_subscription() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.guard_subscription() TO fe_server;
