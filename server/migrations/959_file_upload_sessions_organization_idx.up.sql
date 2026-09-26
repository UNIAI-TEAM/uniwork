-- Tenant teardown cancels every open session in the organization.
CREATE INDEX CONCURRENTLY idx_file_upload_sessions_organization
  ON file_upload_sessions (organization_id);
