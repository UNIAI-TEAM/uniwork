-- Organization document settings (C-01 §5.3; UNI-676 G1-02b). One row per
-- organization that has touched the settings; no row reads as the defaults.
-- public_links_enabled is the organization's own switch for anonymous view
-- links: every public read checks it (with the entitlement, expiry and
-- revoke), so turning it off closes every live link on the next request
-- without revoking them. No FK (post-004 rule).
CREATE TABLE document_settings (
  organization_id       TEXT NOT NULL PRIMARY KEY,
  public_links_enabled  BOOLEAN NOT NULL DEFAULT false,
  updated_by            TEXT NOT NULL,
  updated_by_kind       TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT document_settings_updated_by_kind_check
    CHECK (updated_by_kind IN ('human', 'agent', 'system'))
);
