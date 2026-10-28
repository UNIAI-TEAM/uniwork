-- Folder bulk access batches (UNI-2244 §5). A background batch is created when
-- PUT /api/v1/documents/{folderID}/contents-access sees more than
-- FolderContentsAccessSyncMax live subtree documents.
--
-- status is queued | running | completed | failed.
-- mode is merge | replace.
-- items is the validated principal grant array ([{principal_type, principal_id, level}]).
-- document_ids is the sorted snapshot of subtree document ids taken at click time,
-- and cursor_id is the last processed document id so a restarted worker resumes
-- from the next chunk without double writes (§4).
-- notified_levels maps user_id -> highest raised level across processed chunks so
-- the completion step sends one grouped notification per added/raised user (§6).
-- No FOREIGN KEY (migration lint): relationships are resolved in service code.
CREATE TABLE document_access_batches (
  id                       TEXT PRIMARY KEY,
  organization_id          TEXT NOT NULL,
  workspace_id             TEXT NOT NULL,
  folder_id                TEXT NOT NULL,
  created_by               TEXT NOT NULL,
  created_by_kind          TEXT NOT NULL DEFAULT 'human',
  mode                     TEXT NOT NULL,
  items                    JSONB NOT NULL DEFAULT '[]'::jsonb,
  document_ids             TEXT[] NOT NULL DEFAULT '{}',
  notified_levels          JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                   TEXT NOT NULL DEFAULT 'queued',
  total                    INTEGER NOT NULL DEFAULT 0,
  processed                INTEGER NOT NULL DEFAULT 0,
  changed                  INTEGER NOT NULL DEFAULT 0,
  unchanged                INTEGER NOT NULL DEFAULT 0,
  skipped_not_manageable   INTEGER NOT NULL DEFAULT 0,
  skipped_locked           INTEGER NOT NULL DEFAULT 0,
  cursor_id                TEXT NOT NULL DEFAULT '',
  error_code               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at              TIMESTAMPTZ,

  CONSTRAINT document_access_batches_status_check
    CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  CONSTRAINT document_access_batches_mode_check
    CHECK (mode IN ('merge', 'replace')),
  CONSTRAINT document_access_batches_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT document_access_batches_counts_check
    CHECK (total >= 0 AND processed >= 0 AND changed >= 0 AND unchanged >= 0
           AND skipped_not_manageable >= 0 AND skipped_locked >= 0),
  CONSTRAINT document_access_batches_ids_nonempty
    CHECK (id <> '' AND organization_id <> '' AND workspace_id <> ''
           AND folder_id <> '' AND created_by <> '')
);
