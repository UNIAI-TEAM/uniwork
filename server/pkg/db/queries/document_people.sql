-- The people a document list names (UNI-2045 SV-3, SV-6): the last editor and
-- the granter of a share. A name leaves the server only for a person who is a
-- member of the caller's organization, so the join to organization_members is
-- the filter itself - a stranger, an agent id or a removed account matches no
-- row and the list shows no name for it. The membership row counts even when
-- deactivated: the person is still in the organization and keeps their
-- history (F-03). Only the display name and the avatar columns are read.
-- name: ListOrganizationPeopleByIDs :many
SELECT u.id, u.display_name, u.avatar_url, u.avatar_file_id
FROM organization_members m
JOIN users u ON u.id = m.user_id
WHERE m.organization_id = sqlc.arg(organization_id)
  AND m.user_id = ANY(sqlc.arg(user_ids)::text[]);
