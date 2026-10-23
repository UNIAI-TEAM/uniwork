-- Reports of a chat message or a person (store UGC policy: Apple 1.2, Google
-- Play user-generated content). One row per report a member files from a
-- conversation; the organization's owners and admins read it through the
-- audit trail (chat.report.created) until a moderation queue exists. The
-- reported message stays in chat_messages (deletion is soft), so a row keeps
-- only ids, the reason and the reporter's own words. No FOREIGN KEY
-- (migration lint): ChatService resolves the message, its room and the person
-- before it writes.
CREATE TABLE chat_reports (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  room_id         TEXT,
  message_id      TEXT,
  target_user_id  TEXT NOT NULL,
  reason          TEXT NOT NULL,
  details         TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'open',
  created_by      TEXT NOT NULL,
  created_by_kind TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_reports_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT chat_reports_reason_check
    CHECK (reason IN ('spam', 'harassment', 'hate', 'sexual', 'violence', 'self_harm', 'other')),
  CONSTRAINT chat_reports_status_check
    CHECK (status IN ('open', 'resolved')),
  CONSTRAINT chat_reports_message_pair_check
    CHECK ((message_id IS NULL) = (room_id IS NULL)),
  CONSTRAINT chat_reports_details_len_check
    CHECK (char_length(details) <= 1000)
);
