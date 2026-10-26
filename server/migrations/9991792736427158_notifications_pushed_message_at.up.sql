-- When the chat message in pushed_message_id was written (UNI-2141). A row's
-- messages are ordered as the room orders them, by (created_at, id): ids are
-- ULIDs minted on each API node's clock, so a node running a little behind
-- gives a later message a lower id, and ordering by the id alone would drop
-- that message's push for good. created_at is the database's clock. NULL
-- while no message of the row was pushed.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS pushed_message_at TIMESTAMPTZ;
