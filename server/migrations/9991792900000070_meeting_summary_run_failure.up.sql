-- UNI-1995 demo bug #12: a clerk's summary run no longer lives inside the
-- request that started it, so its failure reaches the panel through the run
-- row instead of the HTTP answer. A failed run keeps its row with the lease
-- given back (expires_at = now()) and says when and with which refusal code
-- it failed; a stored summary deletes the row, the next claim clears both.
ALTER TABLE meeting_summary_runs
  ADD COLUMN failed_at TIMESTAMPTZ,
  ADD COLUMN failure_code TEXT NOT NULL DEFAULT '';
