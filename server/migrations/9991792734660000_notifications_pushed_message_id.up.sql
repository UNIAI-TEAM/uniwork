-- The newest chat message a notification row was pushed for (UNI-2141). A
-- chat row merges a room's (or a thread's) unread messages, and every one of
-- them now pushes on its own: pushed_at alone cannot tell the push of the
-- third message from a retry of the first. The push lane sends a message only
-- when its id (a ULID, so time-ordered) is past this one, which drops both a
-- redelivered push row and one the lane reaches after a newer message of the
-- room already went out. NULL means no message of the row was pushed yet, or
-- the row is not a chat message.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS pushed_message_id TEXT;
