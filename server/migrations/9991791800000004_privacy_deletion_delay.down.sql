ALTER TABLE organizations DROP COLUMN deletion_scheduled_at;
ALTER TABLE data_subject_requests DROP COLUMN erase_at;
ALTER TABLE data_subject_requests DROP COLUMN cancelled_at;
