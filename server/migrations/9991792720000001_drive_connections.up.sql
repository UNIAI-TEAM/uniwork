-- Google Drive connections per user in an organization (UNI-2172, spec §6.1).
-- A user may connect multiple Google accounts in an organization, one row per
-- (organization_id, user_id, google_sub) across all states; reconnecting the
-- same google_sub revives the row in place so drive_files/drive_file_access
-- references keep their connection_id. Tokens are AES-256-GCM ciphertext
-- sealed with DRIVE_CREDENTIAL_KEY. No FOREIGN KEY (migration lint).
CREATE TABLE drive_connections (
  id                  TEXT PRIMARY KEY,
  organization_id     TEXT NOT NULL,
  user_id             TEXT NOT NULL,
  provider            TEXT NOT NULL DEFAULT 'google',
  google_sub          TEXT NOT NULL,
  google_email        TEXT NOT NULL,
  refresh_token_enc   TEXT NOT NULL DEFAULT '',
  access_token_enc    TEXT NOT NULL DEFAULT '',
  access_expires_at   TIMESTAMPTZ,
  credential_version  BIGINT NOT NULL DEFAULT 0,
  scopes              TEXT NOT NULL DEFAULT '',
  auth_failed_at      TIMESTAMPTZ,
  auth_failed_reason  TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at     TIMESTAMPTZ,

  CONSTRAINT drive_connections_provider_check
    CHECK (provider IN ('google')),
  CONSTRAINT drive_connections_ids_nonempty
    CHECK (id <> '' AND organization_id <> '' AND user_id <> '' AND google_sub <> '' AND google_email <> '')
);
