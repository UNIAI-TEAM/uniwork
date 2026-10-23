-- An organization's floor under the phone's own privacy choices (audit
-- "Security & privacy", privacy-defaults-off): an owner or admin can require
-- the UniChat app lock (Face ID, a fingerprint or the passcode) and block
-- screenshots and screen recording (which also blanks the app switcher) on
-- every member's phone. The app treats each as a minimum the person cannot
-- lower. NULL means not required, the default.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS mobile_app_lock_required_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mobile_app_lock_required_by TEXT,
  ADD COLUMN IF NOT EXISTS mobile_screen_capture_blocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mobile_screen_capture_blocked_by TEXT;
