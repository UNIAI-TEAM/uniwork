-- One row per chat reminder message (H16): the server, not the browser, fires
-- it. next_fire_at is the next due time and NULL once a one-shot reminder has
-- fired or its message was deleted; the reminder worker claims due rows with
-- FOR UPDATE SKIP LOCKED and advances them in the transaction that emits
-- chat.reminder.due, so two pods never fire the same occurrence.
-- remind_at is the anchor every repeat counts from (occurrence steps in the
-- creator's timezone), so a monthly reminder on the 31st does not drift.
CREATE TABLE IF NOT EXISTS chat_reminders (
  message_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT '',
  room_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_kind TEXT NOT NULL DEFAULT 'human',
  repeat TEXT NOT NULL DEFAULT 'none',
  timezone TEXT NOT NULL,
  remind_at TIMESTAMPTZ NOT NULL,
  occurrence INT NOT NULL DEFAULT 0,
  next_fire_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
