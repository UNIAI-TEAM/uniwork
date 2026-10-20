-- Document access requests (DOC-07, UNI-1631). No FK (ADR 0001): document,
-- requester, decider and share are resolved in service code; purge deletes
-- a document's rows in its own transaction.
CREATE TABLE document_access_requests (
  id               TEXT PRIMARY KEY,               -- util.NewID() ULID
  organization_id  TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  document_id      TEXT NOT NULL,
  created_by       TEXT NOT NULL,                  -- the requester
  created_by_kind  TEXT NOT NULL,
  requested_level  TEXT NOT NULL,
  message          TEXT NOT NULL DEFAULT '',
  source_kind      TEXT,
  source_id        TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  granted_level    TEXT,
  share_id         TEXT,
  decided_by       TEXT,
  decided_by_kind  TEXT,
  decided_at       TIMESTAMPTZ,                    -- the 1h re-request cooldown counts from here (declined)
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_access_requests_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT document_access_requests_decided_by_kind_check
    CHECK (decided_by_kind IS NULL OR decided_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT document_access_requests_level_check
    CHECK (requested_level IN ('view', 'comment', 'edit')
       AND (granted_level IS NULL OR granted_level IN ('view', 'comment', 'edit'))),
  CONSTRAINT document_access_requests_status_check
    CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  CONSTRAINT document_access_requests_source_pair_check
    CHECK ((source_kind IS NULL) = (source_id IS NULL)
       AND (source_kind IS NULL OR source_kind IN ('task', 'meeting'))),
  CONSTRAINT document_access_requests_message_len_check
    CHECK (char_length(message) <= 500)
);
