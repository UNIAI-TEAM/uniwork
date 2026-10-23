-- The workspaces an organization-level invitation grants on accept (UNI-1582).
-- An invitation from a workspace keeps its single invitations.workspace_id;
-- this table holds the zero, one or several workspaces an admin picked when
-- inviting someone to the organization itself. No foreign keys: the accept
-- joins workspaces and skips a row whose workspace is gone, and the tenant
-- deletion job removes these rows with the rest of the organization's.
-- The primary key leads with invitation_id, which is every read's key.
CREATE TABLE IF NOT EXISTS invitation_workspaces (
  invitation_id   TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (invitation_id, workspace_id)
);
