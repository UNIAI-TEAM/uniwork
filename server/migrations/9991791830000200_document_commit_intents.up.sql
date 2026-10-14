-- Logical commit intents (G5-07, UNI-1345; spec G5/G6/G7 §5.2 "Hợp đồng
-- resume"). One row per Idempotency-Key of the file version commit
-- (documents.versions.commit): the key, the payload fingerprint it is bound
-- to, the attempt that holds it and until when, and - once committed - the
-- version it produced. The row is what GET .../versions/commit answers from:
-- committed, in_flight (a live claim), not_committed (the claim expired and no
-- attempt can commit any more) or, once swept, 410 commit_intent_unknown.
--
-- Fencing: every POST that reaches the commit claims the row first, in its
-- own transaction, bumping attempt when a previous claim expired. The commit
-- transaction locks the row again and commits only while its own attempt
-- still holds a live claim on the database clock, so an attempt whose claim
-- expired cannot late-commit, and a lookup that takes the same lock never
-- reports not_committed for a commit that is about to land.
--
-- It is not idempotency_keys plus columns: that ledger row is written inside
-- the commit transaction (invisible until it lands, gone on rollback), so it
-- cannot carry an in-flight claim, and it has no document or retention of its
-- own. The ledger keeps replaying commits exactly as before.
CREATE TABLE document_commit_intents (
  id                  TEXT PRIMARY KEY,
  organization_id     TEXT NOT NULL,
  workspace_id        TEXT NOT NULL,
  document_id         TEXT NOT NULL,
  idempotency_key     TEXT NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  created_by          TEXT NOT NULL,
  created_by_kind     TEXT NOT NULL,
  state               TEXT NOT NULL DEFAULT 'claimed',
  attempt             INTEGER NOT NULL DEFAULT 1,
  claim_expires_at    TIMESTAMPTZ NOT NULL,
  version_id          TEXT,
  version             INTEGER,
  revision            BIGINT,
  committed_at        TIMESTAMPTZ,
  retain_until        TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT document_commit_intents_actor_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT document_commit_intents_state_check
    CHECK (state IN ('claimed', 'committed')),
  CONSTRAINT document_commit_intents_attempt_check
    CHECK (attempt >= 1),
  CONSTRAINT document_commit_intents_ids_nonempty
    CHECK (organization_id <> '' AND workspace_id <> '' AND document_id <> ''
       AND idempotency_key <> '' AND payload_fingerprint <> '' AND created_by <> ''),
  CONSTRAINT document_commit_intents_committed_shape
    CHECK ((state = 'committed') = (version_id IS NOT NULL AND version IS NOT NULL
                                    AND revision IS NOT NULL AND committed_at IS NOT NULL))
);
