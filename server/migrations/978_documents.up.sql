-- Documents (C-01 §3.1 + §13.3 + §14.3; UNI-675). One table holds both
-- kinds: `page` (working copy in `content`, server-sanitized ProseMirror
-- JSON) and `file` (bytes live in FileService; `file_version_id` points at
-- the document_versions row holding the current blob). `current_version` is
-- the ordinal of the newest version and `file_version_id` the blob pointer -
-- keep both, they answer different questions. No FK anywhere (ADR 0001):
-- parent, owner, source and file relationships are enforced in service code.
CREATE TABLE documents (
  id                     TEXT PRIMARY KEY,
  organization_id        TEXT NOT NULL,
  workspace_id           TEXT NOT NULL,
  parent_id              TEXT,
  kind                   TEXT NOT NULL,
  title                  TEXT NOT NULL,
  icon                   TEXT,
  visibility             TEXT NOT NULL DEFAULT 'workspace',
  content                JSONB,
  content_text           TEXT NOT NULL DEFAULT '',
  search_text            TEXT NOT NULL DEFAULT '',
  content_bytes          INTEGER NOT NULL DEFAULT 0,
  current_version        INTEGER NOT NULL DEFAULT 0,
  file_version_id        TEXT,
  revision               BIGINT NOT NULL DEFAULT 1,
  position               DOUBLE PRECISION NOT NULL DEFAULT 0,
  owner_kind             TEXT,
  owner_id               TEXT,
  acl_owner_id           TEXT,
  source_document_id     TEXT,
  source_version_id      TEXT,
  source_revision        BIGINT,
  source_format          TEXT,
  source_engine          TEXT,
  target_format          TEXT,
  source_checksum_sha256 TEXT,
  conversion_reason      TEXT,
  created_by             TEXT NOT NULL,
  created_by_kind        TEXT NOT NULL,
  updated_by             TEXT NOT NULL,
  updated_by_kind        TEXT NOT NULL,
  content_saved_at       TIMESTAMPTZ,
  last_version_at        TIMESTAMPTZ,
  archived_at            TIMESTAMPTZ,
  archived_by            TEXT,
  purge_after            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT documents_kind_check
    CHECK (kind IN ('page', 'file')),
  CONSTRAINT documents_visibility_check
    CHECK (visibility IN ('workspace', 'restricted')),
  -- A file never carries page JSON; a page may be created empty.
  CONSTRAINT documents_content_kind_check
    CHECK ((kind = 'page') OR (content IS NULL)),
  CONSTRAINT documents_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT documents_updated_by_kind_check
    CHECK (updated_by_kind IN ('human', 'agent', 'system')),
  -- §13.3: an owned document carries both halves of the owner pair and never
  -- stands in the workspace tree.
  CONSTRAINT documents_owner_pair_check
    CHECK ((owner_kind IS NULL AND owner_id IS NULL)
        OR (owner_kind IS NOT NULL AND owner_id IS NOT NULL)),
  CONSTRAINT documents_owner_kind_check
    CHECK (owner_kind IS NULL OR owner_kind IN ('work_product')),
  CONSTRAINT documents_owned_no_parent_check
    CHECK (owner_kind IS NULL OR parent_id IS NULL),
  -- §14.3: conversion provenance is a pair as well.
  CONSTRAINT documents_source_pair_check
    CHECK ((source_document_id IS NULL) = (source_version_id IS NULL)),
  CONSTRAINT documents_conversion_reason_check
    CHECK (conversion_reason IS NULL
        OR conversion_reason IN ('convert', 'lossy_same_format'))
);
