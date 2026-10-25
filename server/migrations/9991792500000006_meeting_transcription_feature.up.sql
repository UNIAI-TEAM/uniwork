-- meeting.transcription (UNI-2023, spec D9): live transcription minutes per
-- month, spoken seconds after VAD as the agent reports them, metered into the
-- plan's own usage counters (not AI credits). Starter gets a taste, the paid
-- tiers a budget priced against the vendor's session-time billing (S0 §1.5b).
INSERT INTO features (key, name, kind, unit, category, meter_mode, sort_order) VALUES
  ('meeting.transcription', 'Phút ghi lời cuộc họp', 'quota', 'minutes', 'meetings', 'accumulate', 55)
ON CONFLICT (key) DO NOTHING;

INSERT INTO plan_features (plan_id, feature_key, enabled, quota_limit)
SELECT p.id, 'meeting.transcription', true, v.quota_limit
FROM plans p
JOIN (VALUES ('starter', 60::bigint), ('team', 1200::bigint), ('business', 6000::bigint)) AS v(code, quota_limit)
  ON v.code = p.code
ON CONFLICT (plan_id, feature_key) DO NOTHING;
