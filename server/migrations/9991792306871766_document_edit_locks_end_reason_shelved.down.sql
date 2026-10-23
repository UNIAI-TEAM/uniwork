-- Map document_shelved back to document_archived first so the restored
-- CHECK accepts every remaining row. document_archived is the trash twin
-- of the same "document left the live editor set" story; leaving the new
-- reason in place would fail the old constraint.
UPDATE document_edit_locks
SET end_reason = 'document_archived'
WHERE end_reason = 'document_shelved';

ALTER TABLE document_edit_locks
  DROP CONSTRAINT document_edit_locks_end_reason_check;

ALTER TABLE document_edit_locks
  ADD CONSTRAINT document_edit_locks_end_reason_check
  CHECK (end_reason IS NULL OR end_reason IN (
    'released', 'expired', 'taken_over', 'handed_over', 'moved_here',
    'session_revoked', 'access_lost', 'member_deactivated', 'organization_suspended',
    'document_archived', 'document_deleted'));
