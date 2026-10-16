DROP TABLE IF EXISTS document_break_glass_grants;

ALTER TABLE document_access_logs DROP CONSTRAINT document_access_logs_via_check;
DELETE FROM document_access_logs WHERE via = 'break_glass';
ALTER TABLE document_access_logs ADD CONSTRAINT document_access_logs_via_check
    CHECK (via IN ('member', 'share', 'link', 'owner', 'ai_context'));

ALTER TABLE document_shares DROP CONSTRAINT document_shares_level_check;
DELETE FROM document_shares WHERE level = 'comment';
ALTER TABLE document_shares ADD CONSTRAINT document_shares_level_check
    CHECK (level IN ('view', 'edit', 'manage'));
