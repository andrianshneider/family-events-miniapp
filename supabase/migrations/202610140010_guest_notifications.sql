ALTER TABLE app.events ADD COLUMN schedule_version integer NOT NULL DEFAULT 1 CHECK(schedule_version>0);
ALTER TABLE app.auth_handoffs ADD COLUMN guest_session_id uuid REFERENCES app.guest_sessions;
ALTER TABLE app.auth_handoffs ADD COLUMN state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','verified','completed','cancelled'));
CREATE INDEX ON app.auth_handoffs(guest_session_id,event_id,created_at DESC);
-- A trusted bot update verifies the account; only the source browser may complete the binding.
CREATE FUNCTION app.verify_guest_handoff(p_hash bytea,p_telegram bigint,p_chat bigint,p_date timestamptz,p_name text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE h app.auth_handoffs%ROWTYPE;uid uuid;
BEGIN
 IF p_telegram<>p_chat OR p_date>now()+interval '10 seconds' THEN RETURN false; END IF;
 SELECT * INTO h FROM app.auth_handoffs WHERE token_hash=p_hash FOR UPDATE;
 IF NOT FOUND OR h.state<>'pending' OR h.expires_at<=now() OR p_date<h.created_at-interval '5 seconds' OR NOT EXISTS(SELECT FROM app.guest_sessions WHERE id=h.guest_session_id AND revoked_at IS NULL AND expires_at>now()) OR NOT EXISTS(SELECT FROM app.events WHERE id=h.event_id AND deleted_at IS NULL) THEN RETURN false; END IF;
 INSERT INTO app.users(telegram_user_id,display_name) VALUES(p_telegram,left(coalesce(nullif(p_name,''),'Гость Telegram'),128)) ON CONFLICT(telegram_user_id) DO UPDATE SET telegram_user_id=excluded.telegram_user_id RETURNING id INTO uid;
 PERFORM pg_advisory_xact_lock(hashtextextended('organizer-notifications:'||uid,0));
 IF EXISTS(SELECT FROM app.telegram_channels WHERE user_id=uid AND delivery_state='blocked' AND last_verified_at>p_date) THEN RETURN false; END IF;
 INSERT INTO app.telegram_channels(user_id,chat_id,permission_granted_at,permission_source,delivery_state,last_verified_at) VALUES(uid,p_chat,p_date,'bot_start','ready',p_date) ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id,permission_granted_at=excluded.permission_granted_at,permission_source='bot_start',delivery_state='ready',last_verified_at=excluded.last_verified_at;
 UPDATE app.auth_handoffs SET confirmed_user_id=uid,state='verified' WHERE id=h.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.verify_guest_handoff(bytea,bigint,bigint,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.verify_guest_handoff(bytea,bigint,bigint,timestamptz,text) TO fe_worker;
CREATE OR REPLACE FUNCTION app.notification_deliverable(p_id uuid,p_lease timestamptz) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
SELECT EXISTS(SELECT FROM app.notifications n JOIN app.notification_subscriptions s ON s.id=n.subscription_id JOIN app.events e ON e.id=s.event_id JOIN app.telegram_channels c ON c.user_id=s.user_id WHERE n.id=p_id AND n.status='processing' AND n.locked_until=p_lease AND n.locked_until>now() AND s.enabled AND s.consented_at IS NOT NULL AND s.revoked_at IS NULL AND e.deleted_at IS NULL AND c.delivery_state='ready' AND c.permission_granted_at IS NOT NULL
AND (n.type<>'event_changed' OR EXISTS(SELECT FROM app.event_changes ec WHERE ec.event_id=e.id AND n.trigger_key='change:'||ec.id AND ec.notify_decision='send' AND ec.event_version=(SELECT max(event_version) FROM app.event_changes WHERE event_id=e.id)))
AND ((n.type IN('rsvp_new','rsvp_changed') AND s.role='organizer') OR (n.type IN('event_changed','reminder_24h') AND s.role='guest' AND EXISTS(SELECT FROM app.guest_identities g JOIN app.rsvps r ON r.guest_identity_id=g.id AND r.event_id=e.id WHERE g.id=s.guest_identity_id AND g.linked_user_id=s.user_id AND g.merged_into_id IS NULL AND (n.type<>'reminder_24h' OR (r.status IN('yes','maybe') AND n.trigger_key='event:'||e.id||':schedule:'||e.schedule_version AND (CASE WHEN e.starts_at IS NOT NULL THEN e.starts_at ELSE ((e.event_date::text||' 23:59:59')::timestamp AT TIME ZONE e.timezone) END)>now()))))));
$$;
CREATE OR REPLACE FUNCTION app.claim_notifications(p_limit integer) RETURNS TABLE(id uuid,chat_id bigint,payload jsonb,attempt integer,lease timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 UPDATE app.notifications SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,locked_until=NULL WHERE status='processing' AND locked_until<now();
 UPDATE app.notifications n SET status='cancelled',locked_until=NULL FROM app.notification_subscriptions s JOIN app.events e ON e.id=s.event_id LEFT JOIN app.telegram_channels c ON c.user_id=s.user_id WHERE n.subscription_id=s.id AND n.status='pending' AND (NOT s.enabled OR s.consented_at IS NULL OR s.revoked_at IS NOT NULL OR e.deleted_at IS NOT NULL OR c.delivery_state IS DISTINCT FROM 'ready' OR c.permission_granted_at IS NULL OR (n.type='reminder_24h' AND (n.trigger_key<>'event:'||e.id||':schedule:'||e.schedule_version OR NOT EXISTS(SELECT FROM app.rsvps r WHERE r.event_id=e.id AND r.guest_identity_id=s.guest_identity_id AND r.status IN('yes','maybe')))));
 RETURN QUERY WITH due AS(SELECT n.id FROM app.notifications n WHERE n.status='pending' AND n.scheduled_at<=now() AND n.next_attempt_at<=now() AND n.attempts<5 ORDER BY n.next_attempt_at,n.id LIMIT greatest(1,least(p_limit,20)) FOR UPDATE SKIP LOCKED),claimed AS(UPDATE app.notifications n SET status='processing',attempts=n.attempts+1,locked_until=now()+interval '2 minutes' FROM due WHERE n.id=due.id RETURNING n.*)
 SELECT n.id,c.chat_id,n.payload,n.attempts,n.locked_until FROM claimed n JOIN app.notification_subscriptions s ON s.id=n.subscription_id JOIN app.telegram_channels c ON c.user_id=s.user_id;
END $$;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
