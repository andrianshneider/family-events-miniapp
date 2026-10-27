-- Functions created after foundation inherited PostgreSQL's default PUBLIC EXECUTE.
-- They are SECURITY INVOKER and app tables remain private; remove the unnecessary grant.
REVOKE EXECUTE ON FUNCTION app.reserve_gift(text,uuid,uuid),app.cancel_reservation(text,uuid,uuid) FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE EXECUTE ON FUNCTION app.reserve_gift(text,uuid,uuid),app.cancel_reservation(text,uuid,uuid) FROM %I',r);
  END IF;
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.reserve_gift(text,uuid,uuid),app.cancel_reservation(text,uuid,uuid) TO fe_server;
