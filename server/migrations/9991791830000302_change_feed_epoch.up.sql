-- Office change feed, epoch of the position column (G5-01b, UNI-1346;
-- contract-p0 reserved range 9991791830000300..0000399).
--
-- audit_events.xact_id was added by 9991791830000300 and is NULL on every row
-- written before it, so a feed cursor whose high-water mark predates the column
-- can never see a commit made between the mark and the column's default: those
-- rows carry no position. The feed answers 410 for such a mark (one cold start,
-- never a feed with a hole), and this row is how it knows: xact_id is the id of
-- the transaction that recorded the epoch, which runs after the ALTER that
-- added the column, so a mark that cannot see it is older than the column.
--
-- One row, written once. id is a key literal, not a business id, and the row
-- says nothing about any organization - it is not tenant data, so the table is
-- listed in the migration lint's tenantExemptTables with this reason.
CREATE TABLE IF NOT EXISTS change_feed_epoch (
  id TEXT PRIMARY KEY,
  xact_id xid8 NOT NULL DEFAULT pg_current_xact_id(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO change_feed_epoch (id) VALUES ('audit_events.xact_id')
ON CONFLICT (id) DO NOTHING;
