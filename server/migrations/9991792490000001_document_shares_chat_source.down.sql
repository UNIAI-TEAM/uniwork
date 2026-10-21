ALTER TABLE document_shares
  DROP CONSTRAINT IF EXISTS document_shares_prior_manual_level_check,
  DROP CONSTRAINT IF EXISTS document_shares_chat_source_room_check,
  DROP CONSTRAINT IF EXISTS document_shares_source_kind_check,
  DROP COLUMN IF EXISTS prior_manual_level,
  DROP COLUMN IF EXISTS source_message_id,
  DROP COLUMN IF EXISTS source_room_id,
  DROP COLUMN IF EXISTS source_kind;
