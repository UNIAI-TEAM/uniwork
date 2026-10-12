-- OQ-P1 (a1, contract-p0 §7.1): the revision at which a document's content
-- last changed. A commit (or restore) is accepted when its base lies between
-- content_revision and revision, so a move, unarchive or rename that bumps
-- only `revision` no longer turns an unchanged-content save into a
-- document_version_conflict. Every content write sets it to the new revision
-- in the same statement; metadata-only writes leave it.
--
-- One file on purpose: the runner sends it as one implicit transaction, so
-- the column, the backfill and NOT NULL land together or not at all (see
-- 9991790915600001_tenant_backfill_organization_id).
--
-- DEFAULT 0 is kept for the deploy window: the previous binary's
-- InsertDocument does not name the column. 0 is safe for a fresh row - its
-- content has not changed since it was created, so any base up to revision
-- describes the same content. The new binary inserts content_revision =
-- revision explicitly.
SET LOCAL lock_timeout = '5s';

ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_revision BIGINT NOT NULL DEFAULT 0;

UPDATE documents SET content_revision = revision WHERE content_revision <> revision;
