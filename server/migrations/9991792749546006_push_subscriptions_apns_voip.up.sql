-- An iPhone's PushKit token (ADR 0038): the server sends it VoIP pushes
-- straight to APNs, so CallKit can ring a locked phone. transport says how a
-- row is delivered when its endpoint does not: 'apns_voip' is that token
-- (endpoint holds it in hex), NULL is a Web Push endpoint or an Expo token,
-- told apart by their shape as before. apns_environment ('production' |
-- 'sandbox') picks the APNs host the token belongs to, and apns_bundle_id the
-- app it was issued for (the push's topic is "<bundle id>.voip").
ALTER TABLE push_subscriptions
  ADD COLUMN transport TEXT,
  ADD COLUMN apns_environment TEXT,
  ADD COLUMN apns_bundle_id TEXT;
