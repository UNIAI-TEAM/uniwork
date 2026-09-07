-- IANA zone the daily digest is scheduled in (08:00 local). The product is
-- Vietnamese first, so the default is Ho Chi Minh rather than UTC.
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh';
