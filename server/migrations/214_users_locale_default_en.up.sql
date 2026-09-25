-- Tiếng Anh là ngôn ngữ mặc định của sản phẩm: tài khoản mới không gửi locale
-- thì nhận en. Tài khoản cũ giữ nguyên lựa chọn đang lưu.
ALTER TABLE users ALTER COLUMN locale SET DEFAULT 'en';
