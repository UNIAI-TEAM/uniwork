CREATE TABLE calendar_connections (
  id                       TEXT PRIMARY KEY,
  organization_id          TEXT NOT NULL,
  workspace_id             TEXT NOT NULL,
  user_id                  TEXT NOT NULL,
  provider                 TEXT NOT NULL CHECK (provider IN ('google', 'outlook')),
  account_email            TEXT NOT NULL,
  access_token_enc         TEXT NOT NULL,
  refresh_token_enc        TEXT NOT NULL,
  access_token_expires_at  TIMESTAMPTZ NOT NULL,
  selected_calendar_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at          TIMESTAMPTZ
);
