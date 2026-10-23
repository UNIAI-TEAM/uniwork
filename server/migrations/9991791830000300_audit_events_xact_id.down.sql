-- G5-01b rollback: drop the change-feed position column. Its index is dropped
-- by 9991791830000301's down file first (the runner rolls back newest first).
ALTER TABLE audit_events DROP COLUMN IF EXISTS xact_id;
