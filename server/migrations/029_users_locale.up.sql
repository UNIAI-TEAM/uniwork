-- Ngôn ngữ mail. Service chuẩn hoá về vi|en; không CHECK để thêm locale
-- không cần migration.
ALTER TABLE users ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'vi';
