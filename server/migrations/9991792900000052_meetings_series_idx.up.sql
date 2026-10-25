-- follow-4: carry-over reads a series' meetings by series_id.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meetings_series ON meetings (series_id) WHERE series_id IS NOT NULL;
