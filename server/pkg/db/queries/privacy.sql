-- name: InsertDataSubjectRequest :one
INSERT INTO data_subject_requests (
  id, organization_id, requested_by, requested_by_kind, kind
) VALUES ($1, $2, $3, $4, 'export')
RETURNING *;

-- name: GetDataSubjectRequest :one
SELECT * FROM data_subject_requests WHERE id = $1 AND organization_id = $2;

-- name: CountOpenDataSubjectRequests :one
SELECT count(*)::bigint AS running
FROM data_subject_requests
WHERE organization_id = $1 AND completed_at IS NULL AND failed_at IS NULL AND cancelled_at IS NULL;

-- name: StartDataSubjectRequest :exec
-- tenant: system
UPDATE data_subject_requests SET started_at = now() WHERE id = $1 AND started_at IS NULL;

-- name: CompleteDataSubjectRequestWithFile :one
-- tenant: system
UPDATE data_subject_requests SET
  completed_at = now(), file_id = $2, row_count = $3, expires_at = now() + interval '24 hours'
WHERE id = $1 AND completed_at IS NULL AND failed_at IS NULL
RETURNING id;

-- name: FailDataSubjectRequest :exec
-- tenant: system
UPDATE data_subject_requests SET failed_at = now(), error = $2
WHERE id = $1 AND completed_at IS NULL AND failed_at IS NULL;

-- name: ListDataSubjectRequests :many
SELECT * FROM data_subject_requests
WHERE organization_id = $1
ORDER BY created_at DESC
LIMIT $2;

-- name: ListExpiredDataSubjectRequestFiles :many
-- tenant: system
SELECT id, file_id FROM data_subject_requests
WHERE file_id IS NOT NULL AND expires_at IS NOT NULL AND expires_at <= now();

-- name: ReleaseDataSubjectRequestFile :execrows
-- tenant: system
UPDATE data_subject_requests SET file_id = NULL WHERE id = $1 AND file_id = $2;

-- name: DataSubjectRequestHeldFileIDs :many
-- tenant: system
SELECT file_id FROM data_subject_requests WHERE file_id = ANY(sqlc.arg('file_ids')::text[]);

-- name: InsertDataSubjectDeletion :one
INSERT INTO data_subject_requests (
  id, organization_id, requested_by, requested_by_kind, kind, erase_at
) VALUES ($1, $2, $3, $4, 'delete', $5)
RETURNING *;

-- name: CompleteDataSubjectDeletion :one
-- tenant: system
UPDATE data_subject_requests SET completed_at = now(), row_count = $2
WHERE id = $1 AND completed_at IS NULL AND failed_at IS NULL AND cancelled_at IS NULL
RETURNING id;

-- name: GetOpenDataSubjectDeletion :one
SELECT * FROM data_subject_requests
WHERE organization_id = $1 AND kind = 'delete'
  AND completed_at IS NULL AND failed_at IS NULL AND cancelled_at IS NULL
ORDER BY created_at DESC
LIMIT 1;

-- name: CancelDataSubjectDeletion :one
UPDATE data_subject_requests SET cancelled_at = now()
WHERE id = $1 AND organization_id = $2 AND kind = 'delete'
  AND started_at IS NULL AND cancelled_at IS NULL
  AND completed_at IS NULL AND failed_at IS NULL
RETURNING id;

-- name: StartDataSubjectDeletion :execrows
-- tenant: system
UPDATE data_subject_requests SET started_at = now()
WHERE id = $1 AND started_at IS NULL AND cancelled_at IS NULL
  AND completed_at IS NULL AND failed_at IS NULL;

-- name: ScheduleOrganizationDeletion :exec
UPDATE organizations SET deletion_scheduled_at = $2, updated_at = now()
WHERE id = $1;

-- name: ClearOrganizationDeletionSchedule :exec
UPDATE organizations SET deletion_scheduled_at = NULL, updated_at = now()
WHERE id = $1;

-- name: ClearDataSubjectRequestFiles :exec
UPDATE data_subject_requests SET file_id = NULL
WHERE organization_id = $1 AND file_id IS NOT NULL;

-- name: ClearAuditExportFiles :exec
UPDATE audit_exports SET file_id = NULL
WHERE organization_id = $1 AND file_id IS NOT NULL;

-- name: ListOrganizationFileIDs :many
SELECT id FROM files WHERE organization_id = $1 AND deleted_at IS NULL;

-- name: ScrubOrganizationMemberProfiles :exec
UPDATE organization_member_profiles SET
  title = '', phone = '', phone_visible = false, location = '', bio = '',
  employee_code = NULL, department_id = NULL, manager_id = NULL,
  search_text = '', updated_at = now()
WHERE organization_id = $1;

-- name: DeactivateOrganizationMembersForPrivacy :exec
UPDATE organization_members SET
  deactivated_at = now(), deactivated_by = $2, updated_at = now()
WHERE organization_id = $1 AND deactivated_at IS NULL;

-- name: CancelOrganizationSubscriptions :exec
UPDATE subscriptions SET
  status = 'canceled',
  canceled_at = COALESCE(canceled_at, now()),
  updated_at = now(),
  updated_by = $2,
  updated_by_kind = 'system'
WHERE organization_id = $1 AND status <> 'canceled';

-- name: AnonymizeOrganization :exec
UPDATE organizations SET
  name = $2,
  slug = $3,
  status = 'archived',
  suspended_at = COALESCE(suspended_at, now()),
  suspended_reason = 'organization_deleted',
  deletion_scheduled_at = NULL,
  updated_at = now()
WHERE id = $1;
