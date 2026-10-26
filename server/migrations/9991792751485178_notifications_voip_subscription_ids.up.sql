-- The PushKit tokens (push_subscriptions ids) a call's ring reached as a VoIP
-- push (ADR 0038), on that ring's notification row. The ring's end goes to
-- these and nothing else, once: the push lane takes the list when it sends the
-- end, so a token the ring never reached, a retried ring_closed row or the
-- call's own end later never makes an iPhone report a call that is not
-- ringing there. NULL on every other row.
ALTER TABLE notifications ADD COLUMN voip_subscription_ids TEXT[];
