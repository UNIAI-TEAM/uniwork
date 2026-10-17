-- The session a push subscription was registered from (the access token's
-- `sid`: a native device session family, or a browser session). Revoking a
-- device closes the subscriptions of its family, so a lost phone stops showing
-- message previews (UNI-1838 security review). NULL for rows registered before
-- this column existed.
ALTER TABLE push_subscriptions ADD COLUMN session_id TEXT;
