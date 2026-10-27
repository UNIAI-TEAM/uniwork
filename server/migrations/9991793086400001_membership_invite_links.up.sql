-- Shareable invite links for a workspace or an organization (UNI-2226).
-- Unlike invitations (one email, one use), a link admits many people while
-- Active. workspace_id set = workspace link; NULL = organization link whose
-- workspaces live in membership_invite_link_workspaces. No foreign keys:
-- services resolve org/workspace and skip deleted workspaces on join.
CREATE TABLE IF NOT EXISTS membership_invite_links (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  workspace_id      TEXT,
  secret_hash       TEXT NOT NULL,
  org_role          TEXT NOT NULL DEFAULT 'member',
  workspace_role    TEXT NOT NULL DEFAULT 'member',
  expires_at        TIMESTAMPTZ NOT NULL,
  revoked_at        TIMESTAMPTZ,
  revoked_by        TEXT,
  created_by        TEXT NOT NULL,
  created_by_kind   TEXT NOT NULL DEFAULT 'human',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS membership_invite_link_workspaces (
  link_id           TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  organization_id   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (link_id, workspace_id)
);
