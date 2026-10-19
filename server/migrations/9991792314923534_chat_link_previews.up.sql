-- Link previews (UNI-1908 F3, ADR 0035). The server reads the card of the
-- first http(s) URL a chat message names, once per URL per organization, and
-- keeps the picture in UniWork storage (file purpose chat_link_preview), so a
-- viewer's device never contacts the linked site.
--
-- chat_link_previews is the organization's cache, one row per normalized URL
-- (url_hash = sha256 of it; the unique index is its own migration). status is
-- ok (a card to show), failed (unreadable, not HTML, no card; retried after an
-- hour) or blocked (refused by the address guard; nothing was sent). The rows
-- are infrastructure written by the slow-lane consumer, never by a person, so
-- they carry no created_by. No FOREIGN KEY (migration lint): FileService
-- holds image_file_id through ChatLinkPreviewImageProvider.
CREATE TABLE chat_link_previews (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  url_hash         TEXT NOT NULL,
  url              TEXT NOT NULL,
  status           TEXT NOT NULL,
  title            TEXT NOT NULL DEFAULT '',
  description      TEXT NOT NULL DEFAULT '',
  site_name        TEXT NOT NULL DEFAULT '',
  image_file_id    TEXT,
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chat_link_previews_status_check CHECK (status IN ('ok', 'failed', 'blocked'))
);

-- Which preview a message shows: one per message, its first URL only. A
-- message's room is kept so a timeline reads its previews by room.
CREATE TABLE chat_message_link_previews (
  message_id       TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  room_id          TEXT NOT NULL,
  preview_id       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
