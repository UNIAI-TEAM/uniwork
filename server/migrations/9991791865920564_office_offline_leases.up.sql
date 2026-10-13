-- Office offline lease (G5-08s, UNI-1350; decision G5-D1, DOC-005 §6.2).
-- A lease is the server's signed, revocable grant that lets one desktop
-- device read one document's downloaded snapshot while offline. The signed
-- token only carries what the app shows offline; the server always checks
-- the signature AND this row, and every field it decides on comes from here.
--
-- One row per (device_session_id, document_id): a renewal updates the row in
-- place (same id, generation + 1); a fresh grant after a revoke or expiry
-- replaces it under a new id, so a token minted for the old id stays dead.
-- revoked_at/revoke_reason mark a revoke (device/session revoke, lost access,
-- policy epoch, admin); OfficeLeaseSweeper deletes rows 7 days after expiry
-- or revoke, the history stays in audit_events. No FK (ADR 0001).
CREATE TABLE office_offline_leases (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  document_id       TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  device_session_id TEXT NOT NULL,
  deployment_id     TEXT NOT NULL,
  version_id        TEXT NOT NULL DEFAULT '',
  version           INTEGER NOT NULL,
  revision          BIGINT NOT NULL,
  level             TEXT NOT NULL,
  policy_epoch      BIGINT NOT NULL,
  generation        INTEGER NOT NULL DEFAULT 1,
  issued_at         TIMESTAMPTZ NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  revoked_at        TIMESTAMPTZ,
  revoke_reason     TEXT,
  created_by        TEXT NOT NULL,
  created_by_kind   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT office_offline_leases_level_check
    CHECK (level IN ('view', 'edit')),
  CONSTRAINT office_offline_leases_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT office_offline_leases_revoke_reason_check
    CHECK (revoke_reason IS NULL OR revoke_reason IN (
      'device_revoked', 'session_revoked', 'member_deactivated', 'member_removed',
      'share_revoked', 'document_deleted', 'document_moved', 'policy_epoch', 'admin'))
);

-- The organization's offline policy epoch (G5-D1 row 8). A lease carries
-- the epoch it was granted under; suspending the organization or the
-- uniwork-admin org-wide revoke bumps it, and a renewal of a lease from an
-- older epoch answers offline_lease_revoked. No row reads as epoch 0.
CREATE TABLE office_offline_policy (
  organization_id TEXT NOT NULL PRIMARY KEY,
  epoch           BIGINT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
