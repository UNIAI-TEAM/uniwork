-- Office change feed cold start (G5-01a, UNI-1344; spec G5/G6/G7 §4.1).
-- A cold start (no cursor) materialises the documents the caller may read in
-- one workspace, at one PostgreSQL MVCC snapshot, so every later page reads
-- the same membership and the same values no matter what writers do between
-- pages. Rows carry ids, kinds, revisions and version pointers only - never a
-- title, path or content.
--
-- high_water is pg_current_snapshot()::text taken by the REPEATABLE READ
-- transaction that wrote the items: exactly the commits the snapshot saw.
-- It is the position the incremental feed (G5-01b) continues from: a commit
-- not visible in it (pg_visible_in_snapshot) is after the snapshot, so no
-- commit is lost or delivered twice. ULIDs and created_at are not commit
-- ordered and cannot play that role.
--
-- Snapshots live a short TTL (expires_at); DocumentChangeSnapshotSweeper
-- deletes the snapshot row and its items in one transaction, so a page never
-- sees half a snapshot. No FK (ADR 0001): items name their snapshot by id.
CREATE TABLE document_change_snapshots (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  created_by_kind TEXT NOT NULL,
  high_water      TEXT NOT NULL,
  item_count      INTEGER NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT document_change_snapshots_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system'))
);

CREATE TABLE document_change_snapshot_items (
  snapshot_id     TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  document_id     TEXT NOT NULL,
  kind            TEXT NOT NULL,
  revision        BIGINT NOT NULL,
  current_version INTEGER NOT NULL,
  file_version_id TEXT,

  PRIMARY KEY (snapshot_id, document_id)
);
