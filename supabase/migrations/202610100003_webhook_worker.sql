CREATE FUNCTION app.claim_telegram_updates(p_limit integer) RETURNS TABLE(bot_id bigint,update_id bigint,payload_ciphertext bytea,lease timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 UPDATE app.telegram_updates SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,locked_until=NULL WHERE status='processing' AND locked_until<now();
 RETURN QUERY WITH due AS (SELECT u.bot_id,u.update_id FROM app.telegram_updates u WHERE u.status='pending' AND u.next_attempt_at<=now() AND u.attempts<5 ORDER BY u.created_at LIMIT greatest(1,least(p_limit,20)) FOR UPDATE SKIP LOCKED)
 UPDATE app.telegram_updates u SET status='processing',attempts=u.attempts+1,locked_until=now()+interval '2 minutes' FROM due d WHERE u.bot_id=d.bot_id AND u.update_id=d.update_id RETURNING u.bot_id,u.update_id,u.payload_ciphertext,u.locked_until;
END $$;
CREATE FUNCTION app.finish_telegram_update(p_bot bigint,p_update bigint,p_lease timestamptz,p_success boolean) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 UPDATE app.telegram_updates SET status=CASE WHEN p_success THEN 'processed' WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,next_attempt_at=now()+interval '1 minute',locked_until=NULL
 WHERE bot_id=p_bot AND update_id=p_update AND status='processing' AND locked_until=p_lease;
$$;
CREATE FUNCTION app.record_telegram_channel(p_telegram_user bigint,p_chat bigint,p_blocked boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE uid uuid;
BEGIN
 -- Called only by trusted processor of authenticated Telegram webhook updates.
 SELECT id INTO uid FROM app.users WHERE telegram_user_id=p_telegram_user;
 IF uid IS NULL THEN RETURN; END IF;
 IF p_blocked THEN
  UPDATE app.telegram_channels SET delivery_state='blocked',last_verified_at=now() WHERE user_id=uid;
 ELSE
  INSERT INTO app.telegram_channels(user_id,chat_id,permission_granted_at,permission_source,delivery_state,last_verified_at)
  VALUES(uid,p_chat,now(),'bot_start','ready',now())
  ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id,permission_granted_at=excluded.permission_granted_at,permission_source='bot_start',delivery_state='ready',last_verified_at=now();
 END IF;
 -- Does not opt in or enable any event subscription.
END $$;
GRANT EXECUTE ON FUNCTION app.claim_telegram_updates(integer),app.finish_telegram_update(bigint,bigint,timestamptz,boolean),app.record_telegram_channel(bigint,bigint,boolean) TO fe_worker;
