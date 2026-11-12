-- Source session may recover its short-lived link after refresh. Only ciphertext is retained.
ALTER TABLE app.auth_handoffs ADD COLUMN token_ciphertext bytea CHECK(token_ciphertext IS NULL OR octet_length(token_ciphertext)=71);
