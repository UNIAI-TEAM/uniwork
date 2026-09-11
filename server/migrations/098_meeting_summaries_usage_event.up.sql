-- Links a summary to the gateway call that produced it, so its cost is
-- explainable from the meeting side (spec F-09 §4).
ALTER TABLE meeting_summaries ADD COLUMN IF NOT EXISTS usage_event_id TEXT;
