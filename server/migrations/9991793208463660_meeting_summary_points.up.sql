-- meeting_summary@8 (UNI-2285): a summary row also keeps its paragraph as
-- 2-6 cited sentences ([{text, evidence}], JSON like decisions); the
-- paragraph is those sentences joined. Rows written before @8 read as none.
ALTER TABLE meeting_summaries ADD COLUMN IF NOT EXISTS summary_points TEXT NOT NULL DEFAULT '[]';
