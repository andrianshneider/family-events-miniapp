-- Atomically claim signed initData; store hashes only, never the Telegram payload.
CREATE TABLE app.mini_app_logins (
 digest bytea PRIMARY KEY CHECK(octet_length(digest)=32),
 session_hash bytea CHECK(octet_length(session_hash)=32),
 expires_at timestamptz NOT NULL
);
CREATE INDEX ON app.mini_app_logins(expires_at);
ALTER TABLE app.mini_app_logins ENABLE ROW LEVEL SECURITY;
CREATE POLICY server_access ON app.mini_app_logins TO fe_server USING(true) WITH CHECK(true);
REVOKE ALL ON app.mini_app_logins FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON app.mini_app_logins TO fe_server;
