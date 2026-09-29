-- Q7 conversion jobs (G2-07b / UNI-690). A convert job names the OOXML target
-- it produces, and a completed job keeps the engine's operation result - the
-- fidelity level and the change list a caller shows before it accepts the
-- conversion copy. Both stay NULL for open/edit/serialize jobs. The result is
-- stored verbatim; Go never derives authority from it.
ALTER TABLE office_jobs
  ADD COLUMN target_format TEXT,
  ADD COLUMN result JSONB;
