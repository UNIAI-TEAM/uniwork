-- T1b (UNI-739) - requested by T3 so a permanent refusal (file_too_large,
-- file_type_rejected) is the stored result of its idempotency key: the same
-- command replayed answers the same code from this column without reading the
-- body again (T1-Q8, FS-C1 section 4). Only a canceled session carries one.
ALTER TABLE file_upload_sessions
  ADD COLUMN failure_code TEXT,
  ADD CONSTRAINT file_upload_sessions_failure_code_check
    CHECK (failure_code IS NULL
        OR (status = 'canceled' AND failure_code IN ('file_too_large', 'file_type_rejected')));

COMMENT ON COLUMN file_upload_sessions.failure_code IS
  'FS-C1 section 7 code of the permanent refusal this upload ended with (file_too_large | file_type_rejected), replayed for the same idempotency key without re-reading the body. NULL on every session that was not refused, including a plain cancel.';
