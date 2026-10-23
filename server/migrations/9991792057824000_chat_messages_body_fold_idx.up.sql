-- Trigram search over the folded body of text messages (UNI-1694). Room search
-- compares uw_fold_search(body) with the term folded by foldForSearch, so "hop"
-- finds "Họp"; this index lets a term of three or more characters read only the
-- candidate rows instead of every text message in the room. The partial
-- predicate matches SearchChatMessagesByRoom. One statement, its own file: a
-- concurrent build cannot run inside a transaction (CLAUDE.md).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_body_fold ON chat_messages USING gin (uw_fold_search(body) gin_trgm_ops) WHERE kind = 'text' AND deleted_at IS NULL;
