-- The chat change log of ADR 0039 (draft, phase 1): one row per change to a
-- chat message (created, updated - an edit, a reaction, a vote, a pin, a
-- thread's reply count - or deleted), numbered by a sequence of its own per
-- organization. A client that saw changes up to N asks GET .../chat/sync
-- ?since=N and reads only what it missed, instead of refetching every page it
-- has loaded on each reconnect, and finds a frame the socket lost while it
-- stayed up. Rooms live in an organization (DMs and groups belong to no one
-- workspace), so the sequence is the organization's.
--
-- chat_change_heads holds each organization's last sequence. The writer
-- (ChatService.recordChatChange) bumps it and inserts the change in one
-- transaction; the head row's lock orders the writers, so sequence order is
-- commit order and a reader never sees N+1 before N. Rows are a projection:
-- they hold ids only (the reader re-reads the message through the room's
-- authorization), the writer trims all but the newest chatChangeRetention of
-- an organization, and a client further behind is told to reload. No FOREIGN
-- KEY (migration lint).
CREATE TABLE chat_changes (
  organization_id TEXT NOT NULL,
  seq             BIGINT NOT NULL,
  room_id         TEXT NOT NULL,
  message_id      TEXT NOT NULL,
  kind            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, seq),
  CONSTRAINT chat_changes_kind_check CHECK (kind IN ('created', 'updated', 'deleted'))
);

CREATE TABLE chat_change_heads (
  organization_id TEXT NOT NULL PRIMARY KEY,
  seq             BIGINT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
