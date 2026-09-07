-- Organization member profiles (F-03). Every read joins the membership row so
-- the directory can show role and status beside the profile, and LEFT JOINs
-- the profile itself so a member added before their profile row still appears.

-- name: UpsertMemberProfile :one
INSERT INTO organization_member_profiles (organization_id, user_id, search_text, updated_by)
VALUES ($1, $2, $3, $4)
ON CONFLICT (organization_id, user_id) DO UPDATE SET search_text = EXCLUDED.search_text, updated_at = now()
RETURNING *;

-- name: UpdateMemberProfile :one
-- Every field is optional: sqlc.narg NULL leaves the column as it was, so one
-- statement serves both the self-edit subset and the admin's full form.
UPDATE organization_member_profiles SET
  title         = COALESCE(sqlc.narg(title)::text, title),
  department_id = CASE WHEN sqlc.arg(set_department)::boolean THEN sqlc.narg(department_id)::text ELSE department_id END,
  manager_id    = CASE WHEN sqlc.arg(set_manager)::boolean THEN sqlc.narg(manager_id)::text ELSE manager_id END,
  employee_code = CASE WHEN sqlc.arg(set_employee_code)::boolean THEN sqlc.narg(employee_code)::text ELSE employee_code END,
  phone         = COALESCE(sqlc.narg(phone)::text, phone),
  phone_visible = COALESCE(sqlc.narg(phone_visible)::boolean, phone_visible),
  location      = COALESCE(sqlc.narg(location)::text, location),
  bio           = COALESCE(sqlc.narg(bio)::text, bio),
  joined_on     = CASE WHEN sqlc.arg(set_joined_on)::boolean THEN sqlc.narg(joined_on)::date ELSE joined_on END,
  search_text   = COALESCE(sqlc.narg(search_text)::text, search_text),
  updated_by    = sqlc.arg(updated_by),
  updated_at    = now()
WHERE organization_id = sqlc.arg(organization_id) AND user_id = sqlc.arg(user_id)
RETURNING *;

-- name: SetMemberProfileSearchText :exec
UPDATE organization_member_profiles SET search_text = $3, updated_at = now()
WHERE organization_id = $1 AND user_id = $2;

-- name: GetPerson :one
SELECT m.user_id, m.role, m.deactivated_at, m.created_at,
       u.email, u.display_name, u.avatar_url, u.timezone,
       p.title, p.department_id, p.manager_id, p.employee_code, p.phone, p.phone_visible,
       p.location, p.bio, p.joined_on,
       d.name AS department_name
FROM organization_members m
JOIN users u ON u.id = m.user_id
LEFT JOIN organization_member_profiles p ON p.organization_id = m.organization_id AND p.user_id = m.user_id
LEFT JOIN departments d ON d.id = p.department_id
WHERE m.organization_id = $1 AND m.user_id = $2;

-- name: SearchPeople :many
-- Keyset paged on (display_name, user_id): the directory is a live list and an
-- offset would skip or repeat a row the moment somebody is renamed.
SELECT m.user_id, m.role, m.deactivated_at, m.created_at,
       u.email, u.display_name, u.avatar_url, u.timezone,
       p.title, p.department_id, p.manager_id, p.employee_code, p.phone, p.phone_visible,
       p.location, p.bio, p.joined_on,
       d.name AS department_name
FROM organization_members m
JOIN users u ON u.id = m.user_id
LEFT JOIN organization_member_profiles p ON p.organization_id = m.organization_id AND p.user_id = m.user_id
LEFT JOIN departments d ON d.id = p.department_id
WHERE m.organization_id = sqlc.arg(organization_id)
  AND (
    sqlc.arg(status)::text = 'all'
    OR (sqlc.arg(status)::text = 'active' AND m.deactivated_at IS NULL)
    OR (sqlc.arg(status)::text = 'deactivated' AND m.deactivated_at IS NOT NULL)
  )
  AND (sqlc.narg(query)::text IS NULL OR p.search_text LIKE '%' || sqlc.narg(query)::text || '%')
  AND (sqlc.narg(department_id)::text IS NULL OR p.department_id = sqlc.narg(department_id)::text)
  AND (sqlc.narg(manager_id)::text IS NULL OR p.manager_id = sqlc.narg(manager_id)::text)
  AND (sqlc.narg(role)::text IS NULL OR m.role = sqlc.narg(role)::text)
  AND (sqlc.narg(cursor_name)::text IS NULL
       OR (u.display_name, m.user_id) > (sqlc.narg(cursor_name)::text, sqlc.narg(cursor_user_id)::text))
ORDER BY u.display_name, m.user_id
LIMIT sqlc.arg(row_limit);

-- name: ListDirectReports :many
SELECT m.user_id, u.display_name, u.avatar_url
FROM organization_member_profiles p
JOIN organization_members m ON m.organization_id = p.organization_id AND m.user_id = p.user_id
JOIN users u ON u.id = p.user_id
WHERE p.organization_id = $1 AND p.manager_id = $2 AND m.deactivated_at IS NULL
ORDER BY u.display_name;

-- name: ListProfileSearchSources :many
-- The columns search_text is folded from, for the two commands that have to
-- rebuild it in bulk: a person renaming themselves, and a department renaming.
SELECT p.organization_id, p.user_id, u.display_name, u.email, p.title, d.name AS department_name
FROM organization_member_profiles p
JOIN users u ON u.id = p.user_id
LEFT JOIN departments d ON d.id = p.department_id
WHERE (sqlc.narg(user_id)::text IS NULL OR p.user_id = sqlc.narg(user_id)::text)
  AND (sqlc.narg(department_id)::text IS NULL OR p.department_id = sqlc.narg(department_id)::text)
  AND (sqlc.narg(organization_id)::text IS NULL OR p.organization_id = sqlc.narg(organization_id)::text);

-- name: CountActivePeople :one
SELECT count(*) FROM organization_members
WHERE organization_id = $1 AND deactivated_at IS NULL;

-- name: ListPeopleForExport :many
-- The CSV is a full snapshot in directory order, capped by the caller.
SELECT m.user_id, m.role, m.deactivated_at,
       u.email, u.display_name,
       p.title, p.employee_code, p.phone, p.location, p.joined_on,
       d.name AS department_name,
       mu.display_name AS manager_name
FROM organization_members m
JOIN users u ON u.id = m.user_id
LEFT JOIN organization_member_profiles p ON p.organization_id = m.organization_id AND p.user_id = m.user_id
LEFT JOIN departments d ON d.id = p.department_id
LEFT JOIN users mu ON mu.id = p.manager_id
WHERE m.organization_id = $1
ORDER BY u.display_name, m.user_id
LIMIT $2;
