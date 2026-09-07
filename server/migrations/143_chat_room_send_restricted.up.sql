ALTER TABLE chat_room_members
  ADD COLUMN IF NOT EXISTS send_restricted BOOLEAN NOT NULL DEFAULT false;
