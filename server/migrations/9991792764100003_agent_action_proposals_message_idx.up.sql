CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_action_proposals_message
  ON agent_action_proposals (message_id, position);
