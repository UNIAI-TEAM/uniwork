-- Document edit lock (UNI-1645, addendum 2026-10-15 §1.2): one row per
-- tenure of the one editor of a document. The live tenure is the row with
-- ended_at IS NULL; it is live while now() < expires_at (heartbeat TTL) or
-- now() < offline_hold_until (the D1 manual offline hold). Ended rows stay 7
-- days so a late heartbeat or save learns why the lock was lost; the long
-- history is audit_events. No FK (ADR 0001); the state lives here, never in
-- memory, so a restart or deploy releases nothing.
--
-- The holder is always a human (edge 15), so there is no created_by and no
-- holder kind; who ended a tenure is ended_by (NULL = a system worker) and
-- the audit row's actor.
CREATE TABLE document_edit_locks (
  id                      TEXT PRIMARY KEY,
  organization_id         TEXT NOT NULL,
  document_id             TEXT NOT NULL,
  user_id                 TEXT NOT NULL,
  session_id              TEXT NOT NULL DEFAULT '',
  editor_id               TEXT NOT NULL DEFAULT '',
  client                  TEXT NOT NULL DEFAULT '',
  base_revision           BIGINT NOT NULL,
  acquired_at             TIMESTAMPTZ NOT NULL,
  heartbeat_at            TIMESTAMPTZ NOT NULL,
  expires_at              TIMESTAMPTZ NOT NULL,
  offline_hold_until      TIMESTAMPTZ,
  hold_device_session_id  TEXT,
  hold_chain_started_at   TIMESTAMPTZ,
  hold_renewals           INTEGER NOT NULL DEFAULT 0,
  granted_via             TEXT NOT NULL,
  previous_lock_id        TEXT,
  ended_at                TIMESTAMPTZ,
  end_reason              TEXT,
  ended_by                TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT document_edit_locks_client_check
    CHECK (client IN ('web_page', 'web_office', 'desktop', '')),
  CONSTRAINT document_edit_locks_granted_via_check
    CHECK (granted_via IN ('acquire', 'take_over', 'handover', 'move_here')),
  CONSTRAINT document_edit_locks_end_reason_check
    CHECK (end_reason IS NULL OR end_reason IN (
      'released', 'expired', 'taken_over', 'handed_over', 'moved_here',
      'session_revoked', 'access_lost', 'member_deactivated', 'organization_suspended',
      'document_archived', 'document_deleted'))
);

-- Edit requests (UNI-1645, D3): a member at edit asks the holder for the
-- lock. One pending request per requester per document; it expires.
-- 'expired' is also what a pending row past expires_at reads as; the sweeper
-- writes it so the pending unique index frees the slot. Rows are deleted 7
-- days after they close; the history is audit_events.
CREATE TABLE document_edit_requests (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  document_id      TEXT NOT NULL,
  lock_id          TEXT NOT NULL,
  requester_id     TEXT NOT NULL,
  holder_id        TEXT NOT NULL,
  status           TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  answered_at      TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT document_edit_requests_status_check
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'superseded', 'expired'))
);
