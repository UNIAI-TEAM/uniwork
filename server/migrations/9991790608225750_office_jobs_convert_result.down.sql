ALTER TABLE office_jobs
  DROP COLUMN IF EXISTS result,
  DROP COLUMN IF EXISTS target_format;
