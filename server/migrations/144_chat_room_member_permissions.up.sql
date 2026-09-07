ALTER TABLE chat_rooms
  ADD COLUMN IF NOT EXISTS member_permissions JSONB NOT NULL DEFAULT '{
    "allow_change_profile": true,
    "allow_pin_content": true,
    "allow_create_notes": true,
    "allow_create_polls": true,
    "allow_send_messages": true
  }'::jsonb;
