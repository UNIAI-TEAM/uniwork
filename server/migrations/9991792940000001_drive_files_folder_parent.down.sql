ALTER TABLE drive_files
  DROP COLUMN IF EXISTS drive_folder_name,
  DROP COLUMN IF EXISTS drive_folder_id;
