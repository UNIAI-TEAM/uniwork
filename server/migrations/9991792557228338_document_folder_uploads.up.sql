-- Folder upload (UNI-2052). One PLAN creates the whole folder tree and one
-- batch row; each file of the plan gets one row that carries its upload target
-- until COMPLETE turns it into a document (or a per-file failure).
--
-- document_folder_uploads.status is open | completed | canceled | expired.
-- mode is folder (the plan created a root folder and its tree) or files (a
-- plain multi-file upload: no folder is created, the files land directly in
-- parent_id, and root_folder_id / root_title stay empty).
-- folders is the {path: document id} map of the folders the plan created
-- ("" is the root folder). expires_at is created_at + 24 h; the sweep expires
-- open batches past it and deletes settled rows after a week.
--
-- document_folder_upload_files.folder_id is the folder the document lands in:
-- the batch's parent_id in files mode (NULL = the workspace root).
-- document_folder_upload_files.file_key is the client's own key (1-64
-- [A-Za-z0-9_-]), unique in its batch; id is the server's ULID. upload_ref is
-- the FileService file id of a presigned PUT, or the file_multipart_uploads id
-- of a large file; NULL until the target is minted (the server content route
-- of a store that cannot presign fills it when the bytes arrive). The probe
-- columns keep what a large file's PLAN sent, so a later target mint can open
-- its multipart session without asking the client again.
-- No FOREIGN KEY (migration lint): documents, files and sessions are joined in
-- service code.
CREATE TABLE document_folder_uploads (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL,
  workspace_id          TEXT NOT NULL,
  created_by            TEXT NOT NULL,
  created_by_kind       TEXT NOT NULL DEFAULT 'human',
  parent_id             TEXT,
  mode                  TEXT NOT NULL DEFAULT 'folder',
  root_folder_id        TEXT NOT NULL DEFAULT '',
  root_title            TEXT NOT NULL DEFAULT '',
  share_with_workspace  BOOLEAN NOT NULL DEFAULT false,
  status                TEXT NOT NULL DEFAULT 'open',
  file_count            INTEGER NOT NULL,
  total_bytes           BIGINT NOT NULL,
  folders               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at            TIMESTAMPTZ NOT NULL,
  finished_at           TIMESTAMPTZ,

  CONSTRAINT document_folder_uploads_status_check
    CHECK (status IN ('open', 'completed', 'canceled', 'expired')),
  CONSTRAINT document_folder_uploads_mode_check
    CHECK (mode IN ('folder', 'files') AND (mode = 'files' OR (root_folder_id <> '' AND root_title <> ''))),
  CONSTRAINT document_folder_uploads_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT document_folder_uploads_counts_check
    CHECK (file_count >= 0 AND total_bytes >= 0),
  CONSTRAINT document_folder_uploads_ids_nonempty
    CHECK (id <> '' AND organization_id <> '' AND workspace_id <> '' AND created_by <> '')
);

CREATE TABLE document_folder_upload_files (
  id                 TEXT PRIMARY KEY,
  file_key           TEXT NOT NULL,
  organization_id    TEXT NOT NULL,
  workspace_id       TEXT NOT NULL,
  batch_id           TEXT NOT NULL,
  folder_id          TEXT,
  path               TEXT NOT NULL,
  filename           TEXT NOT NULL,
  size_bytes         BIGINT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending',
  target_kind        TEXT NOT NULL,
  upload_ref         TEXT,
  probe_head_sha256  TEXT,
  probe_tail_sha256  TEXT,
  cd_offset          BIGINT,
  cd_size            BIGINT,
  document_id        TEXT,
  error_code         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT document_folder_upload_files_status_check
    CHECK (status IN ('pending', 'done', 'failed')),
  CONSTRAINT document_folder_upload_files_target_kind_check
    CHECK (target_kind IN ('put', 'multipart')),
  CONSTRAINT document_folder_upload_files_file_key_check
    CHECK (file_key ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT document_folder_upload_files_size_check
    CHECK (size_bytes >= 0),
  CONSTRAINT document_folder_upload_files_cd_pair_check
    CHECK ((cd_offset IS NULL) = (cd_size IS NULL)),
  CONSTRAINT document_folder_upload_files_ids_nonempty
    CHECK (id <> '' AND organization_id <> '' AND workspace_id <> '' AND batch_id <> '' AND (folder_id IS NULL OR folder_id <> ''))
);
