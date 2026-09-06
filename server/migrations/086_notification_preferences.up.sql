-- One row per (user, kind); a missing row means the Go defaults (spec §2 #6).
-- Exception to "state is a timestamp": these booleans are a setting, not a
-- lifecycle state, so true/false is the honest shape.
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  in_app      BOOLEAN NOT NULL DEFAULT true,
  push        BOOLEAN NOT NULL DEFAULT false,
  email       BOOLEAN NOT NULL DEFAULT false,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);
