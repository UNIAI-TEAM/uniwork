-- UNI-2012 (D2a): mark chat-origin document_shares rows so leaving or being
-- removed from a chat room revokes only chat-granted access and restores any
-- lower manual share the chat grant raised. Manual shares and pre-existing
-- chat shares carry NULL source_kind and are never auto-revoked.
ALTER TABLE document_shares
  ADD COLUMN source_kind TEXT,
  ADD COLUMN source_room_id TEXT,
  ADD COLUMN source_message_id TEXT,
  ADD COLUMN prior_manual_level TEXT,
  ADD CONSTRAINT document_shares_source_kind_check
    CHECK (source_kind IS NULL OR source_kind IN ('chat')),
  ADD CONSTRAINT document_shares_chat_source_room_check
    CHECK (source_kind IS NULL OR source_room_id IS NOT NULL),
  ADD CONSTRAINT document_shares_prior_manual_level_check
    CHECK (prior_manual_level IS NULL OR prior_manual_level IN ('view', 'comment', 'edit', 'manage'));
