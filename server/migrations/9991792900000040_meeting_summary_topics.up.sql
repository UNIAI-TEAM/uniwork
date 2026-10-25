-- meeting_summary@7 (UNI-1995 benchmark #8): a summary row also keeps its
-- topics ([{title, start, points: [{text, evidence}]}], start a transcript
-- segment reference or null) and its open questions ([{text, evidence}]),
-- both JSON like decisions. Rows written before @7 read as none.
ALTER TABLE meeting_summaries ADD COLUMN IF NOT EXISTS topics TEXT NOT NULL DEFAULT '[]';
ALTER TABLE meeting_summaries ADD COLUMN IF NOT EXISTS open_questions TEXT NOT NULL DEFAULT '[]';
