-- Ngôn ngữ mail. Service chuẩn hoá về vi|en; không CHECK để thêm locale
-- không cần migration.
ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'vi';
