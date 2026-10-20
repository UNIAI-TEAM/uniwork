-- The uploaded group avatar (UNI-1898), a file of purpose chat_room_avatar.
-- No foreign key (migration lint): FileService holds the file while this
-- column names it, through ChatRoomAvatarProvider.
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS avatar_file_id TEXT;
