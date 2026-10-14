-- UniWork AI run store (G6-03b, G6-D1 A3/A12; design §3.1). One run is one
-- server-issued id that counts what a single question may spend across every
-- pod: model_calls against the cap of 10 and tool_rounds against the cap of 8
-- (design §4). The counters must outlive one process - a second pod must not
-- count from zero again - and must live with the conversation they answer in,
-- which is why this is a table rather than in-process state.
--
-- Tenant: organization_id TEXT NOT NULL (ADR 0008). A run is bound to one
-- conversation, and the conversation is the tenant root the queries scope by:
-- AiUniworkStartRun only inserts from a conversation of the same organization
-- (design §3.3), and AiUniworkGetRun filters id + conversation + organization,
-- so a run of one tenant is not found for another (design §3.5).
--
-- Attribution is the pair of ADR 0007 (created_by + created_by_kind); the
-- service only ever builds a Human actor for a run.
--
-- No foreign key and no cascade (ADR 0001): the conversation store deletes a
-- conversation and its turns in one transaction, and the TTL sweep deletes the
-- runs that outlive it, so a run outlives its conversation by one sweep at
-- most - and is unreachable in the meantime, because every turn resumes the
-- conversation first (design §3.4).
--
-- expires_at is the run's live window: the earlier of the last turn + idle TTL
-- (30 min) and the conversation's created_at + absolute TTL (24 h), so a run
-- never outlives the conversation that owns it (design §3.4).
CREATE TABLE ai_uniwork_runs (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  model_calls     INTEGER NOT NULL DEFAULT 0,
  tool_rounds     INTEGER NOT NULL DEFAULT 0,
  credits         BIGINT NOT NULL DEFAULT 0,
  created_by      TEXT NOT NULL,
  created_by_kind TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,

  CONSTRAINT ai_uniwork_runs_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system'))
);
