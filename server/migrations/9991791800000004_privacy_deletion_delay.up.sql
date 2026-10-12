-- C-06: a deletion waits five days. The organization stays readable by its
-- owner; the schedule is what the membership gate reads.
ALTER TABLE data_subject_requests ADD COLUMN cancelled_at TIMESTAMPTZ;
ALTER TABLE data_subject_requests ADD COLUMN erase_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN deletion_scheduled_at TIMESTAMPTZ;
