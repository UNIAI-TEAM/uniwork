-- UNI-1903 S-4: shelve ends a live tenure with document_shelved.
-- Drop and re-add the closed CHECK so the new reason is legal.
ALTER TABLE document_edit_locks
  DROP CONSTRAINT document_edit_locks_end_reason_check;

ALTER TABLE document_edit_locks
  ADD CONSTRAINT document_edit_locks_end_reason_check
  CHECK (end_reason IS NULL OR end_reason IN (
    'released', 'expired', 'taken_over', 'handed_over', 'moved_here',
    'session_revoked', 'access_lost', 'member_deactivated', 'organization_suspended',
    'document_archived', 'document_deleted', 'document_shelved'));
