-- Saved signatures (UNI-925 B6): a person's reusable signature images kept
-- server-side so they follow the account instead of a browser profile. A row
-- is personal: every read and write filters by (organization_id, user_id).
-- `image` holds the decoded PNG or JPEG payload the service sniffed itself
-- and capped at 524288 bytes (512 KiB); the CHECK repeats that cap so the
-- table cannot carry a blob the service refuses. No foreign keys: the owner
-- relationship is enforced in service code (ADR 0008, migration rules).
CREATE TABLE saved_signatures (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  label           TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  image           BYTEA NOT NULL,
  created_by      TEXT NOT NULL,
  created_by_kind TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT saved_signatures_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT saved_signatures_image_size_check
    CHECK (octet_length(image) BETWEEN 1 AND 524288)
);
