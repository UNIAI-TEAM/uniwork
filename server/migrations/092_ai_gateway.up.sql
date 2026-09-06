-- AI Gateway (spec F-09 §4). No FK anywhere: a usage row outlives the
-- conversation, the workspace or the rate it was priced with, because it is
-- the cost ledger. Nothing here stores prompt text, source excerpts or the
-- model's answer except ai_messages, which the owner can delete.

-- Versioned price list. A price change is a new row with a later
-- effective_at; rows are never updated, so a usage row's rate_id always
-- explains its cost. Global catalogue, shared by every tenant.
CREATE TABLE IF NOT EXISTS ai_model_rates (
  id                     TEXT PRIMARY KEY,
  provider               TEXT NOT NULL,
  model                  TEXT NOT NULL,
  input_micros_per_mtok  BIGINT NOT NULL,
  output_micros_per_mtok BIGINT NOT NULL,
  currency               TEXT NOT NULL DEFAULT 'USD',
  effective_at           TIMESTAMPTZ NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per gateway call, written as 'pending' before the provider is
-- asked (no row, no call) and finished afterwards. It doubles as the audit
-- row (spec §3.8): who, which capability, which model, which tools, how many
-- sources — never the content.
CREATE TABLE IF NOT EXISTS ai_usage_events (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT,
  actor_id        TEXT NOT NULL,
  actor_kind      TEXT NOT NULL CHECK (actor_kind IN ('human', 'agent', 'system')),
  capability      TEXT NOT NULL,
  prompt_id       TEXT NOT NULL,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  rate_id         TEXT,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_micros     BIGINT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'rejected')),
  reason_code     TEXT,
  latency_ms      INTEGER,
  tool_calls      TEXT NOT NULL DEFAULT '[]',
  source_count    INTEGER NOT NULL DEFAULT 0,
  truncated       BOOLEAN NOT NULL DEFAULT false,
  correlation_id  TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

-- Ask UNI conversations: kept so a person can reread and delete them. Never
-- used as a source of facts for a later answer (OPEN_QUESTIONS G3).
CREATE TABLE IF NOT EXISTS ai_conversations (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  citations       TEXT NOT NULL DEFAULT '[]',
  usage_event_id  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- List prices in USD micros per 1M tokens for the models policy.go can pick.
-- Reviewed by the product owner; a change is a new row, not an UPDATE.
INSERT INTO ai_model_rates (id, provider, model, input_micros_per_mtok, output_micros_per_mtok, effective_at) VALUES
  ('01K4AIRATE00000000000000A1', 'anthropic', 'claude-opus-5',               15000000, 75000000, '2026-09-01T00:00:00Z'),
  ('01K4AIRATE00000000000000A2', 'anthropic', 'claude-sonnet-5',              3000000, 15000000, '2026-09-01T00:00:00Z'),
  ('01K4AIRATE00000000000000A3', 'anthropic', 'claude-haiku-4-5-20251001',    1000000,  5000000, '2026-09-01T00:00:00Z'),
  ('01K4AIRATE00000000000000B1', 'openai',    'gpt-4o',                       2500000, 10000000, '2026-09-01T00:00:00Z'),
  ('01K4AIRATE00000000000000B2', 'openai',    'gpt-4o-mini',                   150000,   600000, '2026-09-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;
