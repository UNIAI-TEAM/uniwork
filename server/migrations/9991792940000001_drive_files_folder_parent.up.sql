-- Add Google Drive parent folder reference columns to drive_files (UNI-2221).
ALTER TABLE drive_files
  ADD COLUMN IF NOT EXISTS drive_folder_id TEXT,
  ADD COLUMN IF NOT EXISTS drive_folder_name TEXT;
