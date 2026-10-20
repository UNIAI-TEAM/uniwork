-- Dial-in by phone (UNI-2029, scribe spec §5.4 B10, §6.2). dial_in_pin is the
-- 6-digit PIN a caller enters; the default draws it from gen_random_uuid()
-- (a strong random source) for every new meeting, and meetings not yet over
-- get one now — ended ones never take a call. sip_dispatch_rule_id is the
-- LiveKit SIP dispatch rule that routes the PIN into the room while the
-- meeting is in progress; NULL when there is none.
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS dial_in_pin TEXT;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS sip_dispatch_rule_id TEXT;
ALTER TABLE meetings ALTER COLUMN dial_in_pin
  SET DEFAULT lpad(((('x' || substr(md5(gen_random_uuid()::text), 1, 8))::bit(32)::bigint) % 1000000)::text, 6, '0');
UPDATE meetings SET dial_in_pin = DEFAULT
WHERE dial_in_pin IS NULL AND status IN ('SCHEDULED', 'IN_PROGRESS');
