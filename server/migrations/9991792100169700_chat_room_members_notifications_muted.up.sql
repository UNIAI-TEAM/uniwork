-- A member's "mute notifications" for a room, read when a chat notification
-- is delivered so it holds on every device (UNI-1697).
ALTER TABLE chat_room_members
  ADD COLUMN IF NOT EXISTS notifications_muted BOOLEAN NOT NULL DEFAULT false;
