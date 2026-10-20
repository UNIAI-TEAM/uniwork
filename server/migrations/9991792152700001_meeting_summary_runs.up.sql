-- UNI-1853 (review): single flight for AI meeting summaries without holding
-- a pooled connection through the model call. A run claims its meeting's row
-- here - a lease with an expiry - in one short statement before it gathers
-- the sources and asks the model, and deletes the row once it has stored the
-- summary or failed. A second run of the same meeting, on any node, finds a
-- live lease and is refused instead of paying the model twice. A lease left
-- by a node that died expires, and the next run takes the row over. The
-- primary key carries organization_id, so the claim's upsert names its
-- tenant; there is no FOREIGN KEY, the service resolves the meeting first.
CREATE TABLE meeting_summary_runs (
  organization_id  TEXT        NOT NULL,
  meeting_id       TEXT        NOT NULL,
  run_id           TEXT        NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,

  PRIMARY KEY (organization_id, meeting_id)
);
