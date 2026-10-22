-- Shared chat room wallpaper (preset id + optional uploaded image file).
-- No foreign key: FileService holds wallpaper_file_id while the room names it.
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS wallpaper_preset TEXT NOT NULL DEFAULT 'default';
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS wallpaper_file_id TEXT;
