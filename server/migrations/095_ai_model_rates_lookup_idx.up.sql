-- Backs AiLatestRate: newest effective row for (provider, model) at call time.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_model_rates_lookup
  ON ai_model_rates (provider, model, effective_at DESC);
