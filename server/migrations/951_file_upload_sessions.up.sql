-- Upload coordination (T1b; spec 2026-09-22 §4.3). One row per logical
-- upload - one idempotency key - carrying the actor pair, the verified scope,
-- the purpose and the claim deadline. This is the temporary grant for a file
-- before any business object claims it: after claim it is audit/ops data
-- only and is never a permanent ACL.
CREATE TABLE file_upload_sessions (
  id                    TEXT PRIMARY KEY,
  file_id               TEXT NOT NULL,
  created_by            TEXT NOT NULL,
  created_by_kind       TEXT NOT NULL,
  purpose               TEXT NOT NULL,
  organization_id       TEXT,
  workspace_id          TEXT,
  user_id               TEXT,
  idempotency_key       TEXT NOT NULL,
  command_fingerprint   TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'receiving',
  provider_operation_id TEXT,
  generation            INTEGER NOT NULL DEFAULT 1,
  claim_expires_at      TIMESTAMPTZ,
  lease_owner           TEXT,
  lease_expires_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at             TIMESTAMPTZ,

  CONSTRAINT file_upload_sessions_actor_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT file_upload_sessions_purpose_check
    CHECK (purpose IN ('user_avatar', 'task_attachment', 'task_description_image',
                       'task_comment_attachment', 'chat_attachment', 'chat_voice',
                       'chat_call_recording', 'meeting_recording', 'audit_export',
                       'document_file', 'document_asset')),
  CONSTRAINT file_upload_sessions_status_check
    CHECK (status IN ('receiving', 'staged', 'claimed', 'canceled', 'expired')),
  CONSTRAINT file_upload_sessions_ids_nonempty
    CHECK (file_id <> '' AND created_by <> ''
       AND idempotency_key <> '' AND command_fingerprint <> ''),
  CONSTRAINT file_upload_sessions_scope_fields_nonempty
    CHECK ((organization_id IS NULL OR organization_id <> '')
       AND (workspace_id IS NULL OR workspace_id <> '')
       AND (user_id IS NULL OR user_id <> '')),
  -- T1-Q10/ADR 0023: a NULL tenant is legal only on the user_avatar branch,
  -- and that branch must carry its user. Every other purpose needs the tenant;
  -- the org+workspace purposes also need the workspace, and audit_export is
  -- tenant-only. This mirrors files.ScopeShape in server/internal/files.
  CONSTRAINT file_upload_sessions_scope_matches_purpose
    CHECK (
         (purpose = 'user_avatar'
          AND organization_id IS NULL AND workspace_id IS NULL AND user_id IS NOT NULL)
      OR (purpose = 'audit_export'
          AND organization_id IS NOT NULL AND workspace_id IS NULL)
      OR (purpose IN ('task_attachment', 'task_description_image',
                      'task_comment_attachment', 'meeting_recording',
                      'document_file', 'document_asset')
          AND organization_id IS NOT NULL AND workspace_id IS NOT NULL)
      OR (purpose IN ('chat_attachment', 'chat_voice', 'chat_call_recording')
          AND organization_id IS NOT NULL)
    ),
  CONSTRAINT file_upload_sessions_generation_positive
    CHECK (generation > 0),
  CONSTRAINT file_upload_sessions_lease_pair
    CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  -- The 24h claim deadline (T1-Q5) is stamped when the file readies into
  -- staged; a session canceled before staging never had one.
  CONSTRAINT file_upload_sessions_claim_deadline
    CHECK (status IN ('receiving', 'canceled') OR claim_expires_at IS NOT NULL),
  CONSTRAINT file_upload_sessions_closed_at_terminal
    CHECK ((status IN ('claimed', 'canceled', 'expired')) = (closed_at IS NOT NULL))
);

COMMENT ON TABLE file_upload_sessions IS
  'FileService upload coordination: one row per logical upload (one idempotency key). Carries the actor pair, the backend-verified scope, the purpose, the claim deadline and the write lease. Temporary grant before a business object claims the file; after claim it is retention/audit data, not an ACL.';
COMMENT ON COLUMN file_upload_sessions.id IS
  'Opaque ULID of the upload session; returned to the uploader as upload_session_id.';
COMMENT ON COLUMN file_upload_sessions.file_id IS
  'The file row this session is currently bound to. A technical retry after an uncertain write points it at the new attempt file and bumps generation; the superseded file stays for reconcile (spec 9.4).';
COMMENT ON COLUMN file_upload_sessions.created_by IS
  'Actor id who opened the upload (ADR 0007 pair with created_by_kind). This is the temporary grant identity, not a business owner.';
COMMENT ON COLUMN file_upload_sessions.created_by_kind IS
  'human | agent | system - kind of the uploading actor (ADR 0007).';
COMMENT ON COLUMN file_upload_sessions.purpose IS
  'FS-C1 upload purpose chosen by the calling module; never client-supplied. Binds the session to the purpose registry policy and scope shape.';
COMMENT ON COLUMN file_upload_sessions.organization_id IS
  'Verified tenant scope of the upload. NULL only on the user_avatar branch (ADR 0023); required and non-empty for every other purpose.';
COMMENT ON COLUMN file_upload_sessions.workspace_id IS
  'Verified workspace scope where the purpose requires one; NULL on user, org-only and optionally-workspace purposes.';
COMMENT ON COLUMN file_upload_sessions.user_id IS
  'Verified user scope for user-scope purposes (user_avatar). NULL elsewhere.';
COMMENT ON COLUMN file_upload_sessions.idempotency_key IS
  'Client key for one logical upload (T1-Q8). Kept across retries of the same attempt; a new upload or changed file uses a new key.';
COMMENT ON COLUMN file_upload_sessions.command_fingerprint IS
  'Fingerprint of the command parameters the idempotency key was bound to (actor, scope, purpose, filename, ...). The same key with a different fingerprint is idempotency_conflict.';
COMMENT ON COLUMN file_upload_sessions.status IS
  'Session lifecycle: receiving -> staged -> claimed, with canceled and expired as terminal exits. A session never leaves a terminal state.';
COMMENT ON COLUMN file_upload_sessions.provider_operation_id IS
  'The external writer operation id (LiveKit egress id, Office job id) for provider outputs; unique when set so a retried operation finds the same file.';
COMMENT ON COLUMN file_upload_sessions.generation IS
  'Write generation, bumped when a technical retry repoints the session at a new attempt file. Stale completions carry an older generation and are refused.';
COMMENT ON COLUMN file_upload_sessions.claim_expires_at IS
  'Claim deadline (T1-Q5): file ready_at + 24h, stamped when the session turns staged. Claim and fresh URLs through the session are refused past it even before the daily sweep marks expired.';
COMMENT ON COLUMN file_upload_sessions.lease_owner IS
  'Writer lease holder while bytes are being written (an upload attempt or a provider operation). Always paired with lease_expires_at.';
COMMENT ON COLUMN file_upload_sessions.lease_expires_at IS
  'Write-lease expiry, including the provider write deadline for RegisterProviderOutput. An expired lease is not proof the writer stopped - reconcile must still confirm or quarantine (spec 9.4).';
COMMENT ON COLUMN file_upload_sessions.created_at IS
  'Session open time.';
COMMENT ON COLUMN file_upload_sessions.updated_at IS
  'Last write to the session row.';
COMMENT ON COLUMN file_upload_sessions.closed_at IS
  'Terminal mark: set exactly when the session turns claimed, canceled or expired; NULL while receiving or staged.';
