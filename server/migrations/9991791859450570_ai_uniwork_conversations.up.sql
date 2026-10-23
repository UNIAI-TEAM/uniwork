-- UniWork AI conversation store (G6-03a, G6-D1 A9; copy catalogue spec §8.3).
-- The Office assistant's transcript lives on the server, encrypted, and the
-- client never supplies history (security rule 7): one row per conversation
-- and one row per turn, sealed with secretbox AES-256-GCM under
-- AI_CONVERSATION_KEY. No foreign key and no cascade (ADR 0001): the store
-- deletes a conversation and its turns in one transaction, and every index is
-- built CONCURRENTLY in its own file.
--
-- Tenant: organization_id TEXT NOT NULL (ADR 0008). A conversation is bound
-- to the (user, organization, document, module, device) it was created for; a
-- request whose key differs gets a new conversation, never someone else's
-- transcript (OQ-P2). document_id/device_id are NULL when the route has none
-- (the org route has no document; a desktop session may have no device id).
--
-- expires_at is the one "live until" instant: the earlier of
-- last_used_at + idle TTL (30 min) and created_at + absolute TTL (24 h),
-- refreshed on every append (the store computes it; LEAST keeps the absolute
-- horizon). The TTL worker deletes what expires_at has passed; a request that
-- resumes a past-expiry conversation answers conversation_expired (409).
CREATE TABLE ai_uniwork_conversations (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT,
  user_id         TEXT NOT NULL,
  document_id     TEXT,
  module          TEXT NOT NULL DEFAULT '',
  device_id       TEXT,
  created_by      TEXT NOT NULL,
  created_by_kind TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,

  CONSTRAINT ai_uniwork_conversations_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system'))
);

CREATE TABLE ai_uniwork_turns (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  run_id          TEXT NOT NULL DEFAULT '',
  seq             INTEGER NOT NULL,
  role            TEXT NOT NULL,
  ciphertext      BYTEA NOT NULL,
  usage_event_id  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ai_uniwork_turns_role_check
    CHECK (role IN ('user', 'assistant', 'tool'))
);
