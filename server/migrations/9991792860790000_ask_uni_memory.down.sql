DROP TABLE IF EXISTS ai_memory_proposals;
DROP TABLE IF EXISTS ai_memories;
ALTER TABLE users DROP COLUMN IF EXISTS ask_uni_memory_off;
ALTER TABLE ai_messages DROP COLUMN IF EXISTS memory_ids;
