-- OPEN_QUESTIONS X2: platform staff are a column on users, not a table.
-- NULL is everyone; 'admin' may change any organization's plan by hand.
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_role TEXT CHECK (platform_role IN ('admin', 'support'));
