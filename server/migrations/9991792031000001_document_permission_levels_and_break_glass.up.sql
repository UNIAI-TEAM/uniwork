-- G8-18 / DOC-05 (UNI-1413, UNI-1628): four-level document permissions
-- (add 'comment' to document_shares.level) and emergency view access for
-- admins on restricted documents (add 'break_glass' to document_access_logs.via
-- and create document_break_glass_grants).

ALTER TABLE document_shares DROP CONSTRAINT document_shares_level_check;
ALTER TABLE document_shares ADD CONSTRAINT document_shares_level_check
    CHECK (level IN ('view', 'comment', 'edit', 'manage'));

ALTER TABLE document_access_logs DROP CONSTRAINT document_access_logs_via_check;
ALTER TABLE document_access_logs ADD CONSTRAINT document_access_logs_via_check
    CHECK (via IN ('member', 'share', 'link', 'owner', 'ai_context', 'break_glass'));

CREATE TABLE IF NOT EXISTS document_break_glass_grants (
    id              TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    workspace_id    TEXT NOT NULL,
    document_id     TEXT NOT NULL,
    actor_id        TEXT NOT NULL,
    actor_kind      TEXT NOT NULL,
    level           TEXT NOT NULL,
    reason          TEXT NOT NULL,
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    revoked_by      TEXT,
    CONSTRAINT document_break_glass_grants_actor_kind_check
        CHECK (actor_kind IN ('human', 'agent', 'system')),
    CONSTRAINT document_break_glass_grants_level_check
        CHECK (level IN ('view'))
);
