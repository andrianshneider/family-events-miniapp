CREATE FUNCTION app.reserve_gift(p_public_id text,p_gift uuid,p_guest uuid) RETURNS TABLE(reservation_id uuid,gift_id uuid,reserved_at timestamptz) LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE e app.events%ROWTYPE;g app.gifts%ROWTYPE;r app.gift_reservations%ROWTYPE;
BEGIN
 SELECT * INTO e FROM app.events WHERE public_id=p_public_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_UNAVAILABLE' USING ERRCODE='P0002'; END IF;
 SELECT g1.* INTO g FROM app.gifts g1 JOIN app.wishlists w ON w.id=g1.wishlist_id WHERE g1.id=p_gift AND w.event_id=e.id AND g1.deleted_at IS NULL FOR UPDATE OF g1;
 IF NOT FOUND THEN RAISE EXCEPTION 'GIFT_UNAVAILABLE' USING ERRCODE='P0002'; END IF;
 IF NOT EXISTS(SELECT FROM app.guest_identities WHERE id=p_guest AND merged_into_id IS NULL AND display_name IS NOT NULL) THEN RAISE EXCEPTION 'GUEST_NAME_REQUIRED' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM app.gift_reservations WHERE app.gift_reservations.gift_id=p_gift AND status='active';
 IF FOUND THEN
  IF r.guest_identity_id<>p_guest THEN RAISE EXCEPTION 'GIFT_ALREADY_RESERVED' USING ERRCODE='23505'; END IF;
 ELSE
  INSERT INTO app.gift_reservations(gift_id,guest_identity_id) VALUES(p_gift,p_guest) RETURNING * INTO r;
 END IF;
 RETURN QUERY SELECT r.id,r.gift_id,r.reserved_at;
END $$;
CREATE FUNCTION app.cancel_reservation(p_public_id text,p_gift uuid,p_guest uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE eid uuid;
BEGIN
 SELECT id INTO eid FROM app.events WHERE public_id=p_public_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_UNAVAILABLE' USING ERRCODE='P0002'; END IF;
 PERFORM g.id FROM app.gifts g JOIN app.wishlists w ON w.id=g.wishlist_id WHERE g.id=p_gift AND w.event_id=eid AND g.deleted_at IS NULL FOR UPDATE OF g;
 IF NOT FOUND THEN RAISE EXCEPTION 'GIFT_UNAVAILABLE' USING ERRCODE='P0002'; END IF;
 UPDATE app.gift_reservations SET status='cancelled',cancelled_at=now(),cancel_reason='guest_cancelled',version=version+1 WHERE gift_id=p_gift AND guest_identity_id=p_guest AND status='active';
END $$;
CREATE FUNCTION app.soft_delete_event(p_event uuid,p_owner uuid,p_version integer) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,app AS $$
DECLARE v integer;
BEGIN
 SELECT version INTO v FROM app.events WHERE id=p_event AND organizer_id=p_owner AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_UNAVAILABLE' USING ERRCODE='P0002'; END IF;
 IF v<>p_version THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 UPDATE app.events SET deleted_at=now(),version=version+1 WHERE id=p_event;
 UPDATE app.gift_reservations r SET status='cancelled',cancelled_at=now(),cancel_reason='event_deleted',version=r.version+1 FROM app.gifts g JOIN app.wishlists w ON w.id=g.wishlist_id WHERE r.gift_id=g.id AND w.event_id=p_event AND r.status='active';
 UPDATE app.notification_subscriptions SET enabled=false,revoked_at=now() WHERE event_id=p_event;
 UPDATE app.notifications n SET status='cancelled',locked_until=NULL FROM app.notification_subscriptions s WHERE n.subscription_id=s.id AND s.event_id=p_event AND n.status IN ('pending','processing');
END $$;
GRANT EXECUTE ON FUNCTION app.reserve_gift(text,uuid,uuid),app.cancel_reservation(text,uuid,uuid),app.soft_delete_event(uuid,uuid,integer) TO fe_server;
-- Worker has EXECUTE only, no direct table access; fixed search_path and no caller-supplied SQL.
CREATE FUNCTION app.claim_notifications(p_limit integer) RETURNS TABLE(id uuid,chat_id bigint,payload jsonb,attempt integer,lease timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 UPDATE app.notifications SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,locked_until=NULL WHERE status='processing' AND locked_until<now();
 UPDATE app.notifications n SET status='cancelled' FROM app.notification_subscriptions s JOIN app.events e ON e.id=s.event_id LEFT JOIN app.telegram_channels c ON c.user_id=s.user_id
 WHERE n.subscription_id=s.id AND n.status='pending' AND (NOT s.enabled OR e.deleted_at IS NOT NULL OR c.delivery_state IS DISTINCT FROM 'ready' OR c.permission_granted_at IS NULL OR
 (n.type='reminder_24h' AND (n.trigger_key<>('event:'||e.id||':schedule:'||e.version) OR NOT EXISTS(SELECT FROM app.rsvps r WHERE r.event_id=e.id AND r.guest_identity_id=s.guest_identity_id AND r.status IN ('yes','maybe')))));
 RETURN QUERY WITH due AS (
 SELECT n.id FROM app.notifications n WHERE n.status='pending' AND n.scheduled_at<=now() AND n.next_attempt_at<=now() AND n.attempts<5 ORDER BY n.next_attempt_at,n.id LIMIT greatest(1,least(p_limit,20)) FOR UPDATE SKIP LOCKED
 ),claimed AS (
 UPDATE app.notifications n SET status='processing',attempts=n.attempts+1,locked_until=now()+interval '2 minutes' FROM due WHERE n.id=due.id RETURNING n.*
 ) SELECT n.id,c.chat_id,n.payload,n.attempts,n.locked_until FROM claimed n JOIN app.notification_subscriptions s ON s.id=n.subscription_id JOIN app.telegram_channels c ON c.user_id=s.user_id;
END $$;
CREATE FUNCTION app.notification_deliverable(p_id uuid,p_lease timestamptz) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
SELECT EXISTS(SELECT FROM app.notifications n JOIN app.notification_subscriptions s ON s.id=n.subscription_id JOIN app.events e ON e.id=s.event_id JOIN app.telegram_channels c ON c.user_id=s.user_id
 WHERE n.id=p_id AND n.status='processing' AND n.locked_until=p_lease AND n.locked_until>now() AND s.enabled AND e.deleted_at IS NULL AND c.delivery_state='ready' AND c.permission_granted_at IS NOT NULL
 AND (n.type<>'reminder_24h' OR (n.trigger_key=('event:'||e.id||':schedule:'||e.version) AND EXISTS(SELECT FROM app.rsvps r WHERE r.event_id=e.id AND r.guest_identity_id=s.guest_identity_id AND r.status IN ('yes','maybe')))));
$$;
CREATE FUNCTION app.finish_notification(p_id uuid,p_lease timestamptz,p_message_id bigint,p_error text,p_retry_seconds integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 IF p_error='403' THEN
  UPDATE app.telegram_channels c SET delivery_state='blocked',last_verified_at=now() FROM app.notification_subscriptions s JOIN app.notifications n ON n.subscription_id=s.id WHERE n.id=p_id AND c.user_id=s.user_id;
 END IF;
 UPDATE app.notifications SET status=CASE WHEN p_message_id IS NOT NULL THEN 'sent' WHEN p_error IN ('403','CANCELLED') THEN 'cancelled' WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
 provider_message_id=p_message_id,sent_at=CASE WHEN p_message_id IS NOT NULL THEN now() ELSE NULL END,last_error_code=p_error,
 next_attempt_at=now()+make_interval(secs=>greatest(1,least(p_retry_seconds,86400))),locked_until=NULL
 WHERE id=p_id AND status='processing' AND locked_until=p_lease;
END $$;
GRANT EXECUTE ON FUNCTION app.claim_notifications(integer),app.notification_deliverable(uuid,timestamptz),app.finish_notification(uuid,timestamptz,bigint,text,integer) TO fe_worker;
