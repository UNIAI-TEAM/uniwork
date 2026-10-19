-- Claude 5.5 list prices (USD micros per 1M tokens), plus corrected prices for
-- Opus 5 and Sonnet 5. The table keeps history, so a correction is a new row
-- with a later effective_at, not an UPDATE.
INSERT INTO ai_model_rates (id, provider, model, input_micros_per_mtok, output_micros_per_mtok, effective_at) VALUES
  ('01K4AIRATE00000000000000A4', 'anthropic', 'claude-opus-5-5',    4000000, 20000000, '2026-10-19T00:00:00Z'),
  ('01K4AIRATE00000000000000A5', 'anthropic', 'claude-sonnet-5-5',  2000000, 10000000, '2026-10-19T00:00:00Z'),
  ('01K4AIRATE00000000000000A6', 'anthropic', 'claude-haiku-5-5',    100000,   500000, '2026-10-19T00:00:00Z'),
  ('01K4AIRATE00000000000000A7', 'anthropic', 'claude-opus-5',      5000000, 25000000, '2026-10-19T00:00:00Z'),
  ('01K4AIRATE00000000000000A8', 'anthropic', 'claude-sonnet-5',    2000000, 10000000, '2026-10-19T00:00:00Z')
ON CONFLICT (id) DO NOTHING;
