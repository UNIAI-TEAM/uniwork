ALTER TABLE organizations
  DROP COLUMN IF EXISTS mobile_screen_capture_blocked_by,
  DROP COLUMN IF EXISTS mobile_screen_capture_blocked_at,
  DROP COLUMN IF EXISTS mobile_app_lock_required_by,
  DROP COLUMN IF EXISTS mobile_app_lock_required_at;
