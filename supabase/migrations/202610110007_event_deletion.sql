-- Preserve history and storage. Event first, then reservations, subscriptions and outbox.
CREATE OR REPLACE FUNCTION app.soft_delete_event(p_event uuid,p_owner uuid,p_version integer) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE v integer;
BEGIN
 SELECT version INTO v FROM app.events WHERE id=p_event AND organizer_id=p_owner AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_UNAVAILABLE' USING ERRCODE='P0002'; END IF;
 IF v<>p_version THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 UPDATE app.events SET deleted_at=now(),updated_at=now(),version=version+1 WHERE id=p_event;
 UPDATE app.gift_reservations r SET status='cancelled',cancelled_at=now(),cancel_reason='event_deleted',version=r.version+1 FROM app.gifts g JOIN app.wishlists w ON w.id=g.wishlist_id WHERE r.gift_id=g.id AND w.event_id=p_event AND r.status='active';
 UPDATE app.notification_subscriptions SET enabled=false,revoked_at=coalesce(revoked_at,now()),updated_at=now() WHERE event_id=p_event;
 UPDATE app.notifications n SET status='cancelled',locked_until=NULL FROM app.notification_subscriptions s WHERE n.subscription_id=s.id AND s.event_id=p_event AND n.status IN ('pending','processing');
END $$;
-- Serialize consent with deletion: a concurrent opt-in must recheck the locked event.
CREATE OR REPLACE FUNCTION app.guard_subscription() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE e app.events%ROWTYPE;
BEGIN
 SELECT * INTO e FROM app.events WHERE id=NEW.event_id FOR UPDATE;
 IF NOT FOUND OR (NEW.enabled AND e.deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'EVENT_UNAVAILABLE' USING ERRCODE='P0002'; END IF;
 IF NEW.role='organizer' AND e.organizer_id<>NEW.user_id THEN RAISE EXCEPTION 'invalid organizer subscription' USING ERRCODE='23514'; END IF;
 IF NEW.role='guest' AND NOT EXISTS(SELECT FROM app.guest_identities WHERE id=NEW.guest_identity_id AND linked_user_id=NEW.user_id AND merged_into_id IS NULL) THEN RAISE EXCEPTION 'invalid guest subscription' USING ERRCODE='23514'; END IF;
 IF NEW.enabled AND NOT EXISTS(SELECT FROM app.telegram_channels WHERE user_id=NEW.user_id AND delivery_state='ready' AND permission_granted_at IS NOT NULL) THEN RAISE EXCEPTION 'notification channel not ready' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION app.soft_delete_event(uuid,uuid,integer),app.guard_subscription() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.soft_delete_event(uuid,uuid,integer),app.guard_subscription() TO fe_server;
