-- One-use, browser-bound reauthentication after an explicit CSRF-protected logout.
-- It never authenticates API requests and cannot bypass initData freshness/signature.
ALTER TABLE app.mini_app_logins ADD COLUMN reauth_hash bytea CHECK(octet_length(reauth_hash)=32);
