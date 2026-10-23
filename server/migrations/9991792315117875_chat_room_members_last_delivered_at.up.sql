-- The delivered cursor (UNI-1908 F4): the newest moment a member's device
-- acknowledged holding the room's messages. It only moves forward; a read
-- moves it too (UpdateChatRoomMemberLastRead), so read implies delivered.
-- No index: it is read beside last_read_at on rows found by room and user.
ALTER TABLE chat_room_members ADD COLUMN IF NOT EXISTS last_delivered_at TIMESTAMPTZ;
