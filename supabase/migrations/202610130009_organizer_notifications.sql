CREATE TABLE app.organizer_notification_handoffs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token_hash bytea NOT NULL UNIQUE CHECK(octet_length(token_hash)=32),
 user_id uuid NOT NULL REFERENCES app.users,organizer_session_id uuid NOT NULL REFERENCES app.organizer_sessions,event_id uuid NOT NULL REFERENCES app.events,
 mode text NOT NULL CHECK(mode IN('mini_app','bot_start')),state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','confirmed','cancelled','account_mismatch')),
 expires_at timestamptz NOT NULL,consumed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),CHECK(expires_at>created_at)
);
CREATE INDEX ON app.organizer_notification_handoffs(organizer_session_id,event_id,created_at DESC);
CREATE INDEX ON app.organizer_notification_handoffs(user_id,expires_at) WHERE state='pending';
ALTER TABLE app.organizer_notification_handoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY server_access ON app.organizer_notification_handoffs TO fe_server USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE,DELETE ON app.organizer_notification_handoffs TO fe_server;
REVOKE ALL ON app.organizer_notification_handoffs FROM PUBLIC;

-- Only the trusted Telegram update processor may establish consent using a bot update.
CREATE FUNCTION app.confirm_organizer_notification(p_hash bytea,p_telegram bigint,p_chat bigint,p_date timestamptz,p_source text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE h app.organizer_notification_handoffs%ROWTYPE;expected_telegram bigint;
BEGIN
 IF p_telegram<>p_chat OR p_source NOT IN('mini_app','bot_start') THEN RETURN false; END IF;
 IF p_hash IS NOT NULL THEN
  SELECT * INTO h FROM app.organizer_notification_handoffs WHERE token_hash=p_hash;
 ELSE
  SELECT x.* INTO h FROM app.organizer_notification_handoffs x JOIN app.users u ON u.id=x.user_id WHERE u.telegram_user_id=p_telegram AND x.mode='mini_app' AND x.state='pending' AND x.expires_at>now() AND x.created_at<=p_date+interval '5 seconds' ORDER BY x.created_at DESC LIMIT 1;
 END IF;
 IF NOT FOUND OR h.expires_at<=now() OR h.state NOT IN('pending','account_mismatch') OR p_date<h.created_at-interval '5 seconds' THEN RETURN false; END IF;
 SELECT telegram_user_id INTO expected_telegram FROM app.users WHERE id=h.user_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('organizer-notifications:'||h.user_id,0));
 IF expected_telegram<>p_telegram THEN UPDATE app.organizer_notification_handoffs SET state='account_mismatch' WHERE id=h.id; RETURN false; END IF;
 IF NOT EXISTS(SELECT FROM app.organizer_sessions WHERE id=h.organizer_session_id AND user_id=h.user_id AND revoked_at IS NULL AND expires_at>now()) THEN UPDATE app.organizer_notification_handoffs SET state='cancelled' WHERE id=h.id; RETURN false; END IF;
 PERFORM id FROM app.events WHERE id=h.event_id AND organizer_id=h.user_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN UPDATE app.organizer_notification_handoffs SET state='cancelled' WHERE id=h.id; RETURN false; END IF;
 IF EXISTS(SELECT FROM app.telegram_channels WHERE user_id=h.user_id AND delivery_state='blocked' AND last_verified_at>p_date) THEN RETURN false; END IF;
 SELECT * INTO h FROM app.organizer_notification_handoffs WHERE id=h.id FOR UPDATE;
 IF h.state NOT IN('pending','account_mismatch') OR h.expires_at<=now() THEN RETURN false; END IF;
 PERFORM id FROM app.organizer_sessions WHERE id=h.organizer_session_id AND user_id=h.user_id AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN UPDATE app.organizer_notification_handoffs SET state='cancelled' WHERE id=h.id; RETURN false; END IF;
 INSERT INTO app.telegram_channels(user_id,chat_id,permission_granted_at,permission_source,delivery_state,last_verified_at) VALUES(h.user_id,p_chat,now(),p_source,'ready',now())
 ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id,permission_granted_at=excluded.permission_granted_at,permission_source=excluded.permission_source,delivery_state='ready',last_verified_at=now();
 INSERT INTO app.notification_subscriptions(event_id,user_id,role,enabled,consented_at,revoked_at) VALUES(h.event_id,h.user_id,'organizer',true,now(),NULL)
 ON CONFLICT(event_id,user_id,role) DO UPDATE SET enabled=true,consented_at=now(),revoked_at=NULL;
 UPDATE app.organizer_notification_handoffs SET state='confirmed',consumed_at=now() WHERE id=h.id;
 RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION app.confirm_organizer_notification(bytea,bigint,bigint,timestamptz,text) TO fe_worker;

-- A re-enabled subscription must never send old queued answers after opt-out/blocking.
CREATE OR REPLACE FUNCTION app.record_telegram_channel(p_telegram_user bigint,p_chat bigint,p_blocked boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE uid uuid;
BEGIN
 IF p_telegram_user<>p_chat THEN RETURN; END IF;
 SELECT id INTO uid FROM app.users WHERE telegram_user_id=p_telegram_user;
 IF uid IS NULL THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('organizer-notifications:'||uid,0));
 IF p_blocked THEN
  UPDATE app.telegram_channels SET delivery_state='blocked',permission_granted_at=NULL,last_verified_at=now() WHERE user_id=uid;
  UPDATE app.notification_subscriptions SET enabled=false,revoked_at=now() WHERE user_id=uid;
  UPDATE app.organizer_notification_handoffs SET state='cancelled' WHERE user_id=uid AND state IN('pending','account_mismatch');
  UPDATE app.notifications n SET status='cancelled',locked_until=NULL FROM app.notification_subscriptions s WHERE n.subscription_id=s.id AND s.user_id=uid AND n.status IN('pending','processing');
 ELSE
  INSERT INTO app.telegram_channels(user_id,chat_id,permission_granted_at,permission_source,delivery_state,last_verified_at) VALUES(uid,p_chat,now(),'bot_start','ready',now())
  ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id,permission_granted_at=excluded.permission_granted_at,permission_source='bot_start',delivery_state='ready',last_verified_at=now();
 END IF;
END $$;

-- Reject late /start or block updates that precede a newer verified channel state.
CREATE FUNCTION app.record_telegram_channel_at(p_telegram bigint,p_chat bigint,p_blocked boolean,p_date timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE uid uuid;
BEGIN
 IF p_telegram<>p_chat OR p_date>now()+interval '10 seconds' THEN RETURN; END IF;
 SELECT id INTO uid FROM app.users WHERE telegram_user_id=p_telegram;
 IF uid IS NULL THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('organizer-notifications:'||uid,0));
 IF EXISTS(SELECT FROM app.telegram_channels WHERE user_id=uid AND last_verified_at>p_date) THEN RETURN; END IF;
 PERFORM app.record_telegram_channel(p_telegram,p_chat,p_blocked);
 UPDATE app.telegram_channels SET last_verified_at=p_date WHERE user_id=uid;
END $$;
GRANT EXECUTE ON FUNCTION app.record_telegram_channel_at(bigint,bigint,boolean,timestamptz) TO fe_worker;

CREATE OR REPLACE FUNCTION app.claim_notifications(p_limit integer) RETURNS TABLE(id uuid,chat_id bigint,payload jsonb,attempt integer,lease timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 UPDATE app.notifications SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,locked_until=NULL WHERE status='processing' AND locked_until<now();
 UPDATE app.notifications n SET status='cancelled' FROM app.notification_subscriptions s JOIN app.events e ON e.id=s.event_id LEFT JOIN app.telegram_channels c ON c.user_id=s.user_id
 WHERE n.subscription_id=s.id AND n.status='pending' AND (NOT s.enabled OR s.consented_at IS NULL OR s.revoked_at IS NOT NULL OR e.deleted_at IS NOT NULL OR c.delivery_state IS DISTINCT FROM 'ready' OR c.permission_granted_at IS NULL);
 RETURN QUERY WITH due AS (
 SELECT n.id FROM app.notifications n WHERE n.status='pending' AND n.type IN('rsvp_new','rsvp_changed') AND n.scheduled_at<=now() AND n.next_attempt_at<=now() AND n.attempts<5 ORDER BY n.next_attempt_at,n.id LIMIT greatest(1,least(p_limit,20)) FOR UPDATE SKIP LOCKED
 ),claimed AS (UPDATE app.notifications n SET status='processing',attempts=n.attempts+1,locked_until=now()+interval '2 minutes' FROM due WHERE n.id=due.id RETURNING n.*)
 SELECT n.id,c.chat_id,n.payload,n.attempts,n.locked_until FROM claimed n JOIN app.notification_subscriptions s ON s.id=n.subscription_id JOIN app.telegram_channels c ON c.user_id=s.user_id;
END $$;
CREATE OR REPLACE FUNCTION app.notification_deliverable(p_id uuid,p_lease timestamptz) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
SELECT EXISTS(SELECT FROM app.notifications n JOIN app.notification_subscriptions s ON s.id=n.subscription_id JOIN app.events e ON e.id=s.event_id JOIN app.telegram_channels c ON c.user_id=s.user_id WHERE n.id=p_id AND n.type IN('rsvp_new','rsvp_changed') AND n.status='processing' AND n.locked_until=p_lease AND n.locked_until>now() AND s.enabled AND s.consented_at IS NOT NULL AND s.revoked_at IS NULL AND e.deleted_at IS NULL AND c.delivery_state='ready' AND c.permission_granted_at IS NOT NULL);
$$;
CREATE OR REPLACE FUNCTION app.finish_notification(p_id uuid,p_lease timestamptz,p_message_id bigint,p_error text,p_retry_seconds integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE uid uuid;
BEGIN
 SELECT s.user_id INTO uid FROM app.notifications n JOIN app.notification_subscriptions s ON s.id=n.subscription_id WHERE n.id=p_id;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('organizer-notifications:'||uid,0));
 SELECT s.user_id INTO uid FROM app.notifications n JOIN app.notification_subscriptions s ON s.id=n.subscription_id WHERE n.id=p_id AND n.status='processing' AND n.locked_until=p_lease FOR UPDATE OF n;
 IF NOT FOUND THEN RETURN; END IF;
 IF p_error='403' THEN
  UPDATE app.telegram_channels SET delivery_state='blocked',permission_granted_at=NULL,last_verified_at=now() WHERE user_id=uid;
  UPDATE app.notification_subscriptions SET enabled=false,revoked_at=now() WHERE user_id=uid;
  UPDATE app.notifications n SET status='cancelled',locked_until=NULL FROM app.notification_subscriptions s WHERE n.subscription_id=s.id AND s.user_id=uid AND n.id<>p_id AND n.status IN('pending','processing');
 END IF;
 UPDATE app.notifications SET status=CASE WHEN p_message_id IS NOT NULL THEN 'sent' WHEN p_error IN('403','CANCELLED') THEN 'cancelled' WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,provider_message_id=p_message_id,sent_at=CASE WHEN p_message_id IS NOT NULL THEN now() ELSE NULL END,last_error_code=p_error,next_attempt_at=now()+make_interval(secs=>greatest(1,least(p_retry_seconds,86400))),locked_until=NULL WHERE id=p_id AND status='processing' AND locked_until=p_lease;
END $$;
-- Later-created functions inherited PostgreSQL default PUBLIC EXECUTE; retain only explicit role grants.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
